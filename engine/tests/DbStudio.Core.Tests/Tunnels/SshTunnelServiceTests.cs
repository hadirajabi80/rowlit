using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Services.Tunnels;

namespace DbStudio.Core.Tests.Tunnels;

/// <summary>
/// WP-SSH end to end against an in-process SSH server (<see cref="InProcessSshServer"/>): SSH.NET connects, authenticates
/// (password, RSA PEM key, encrypted PKCS#8 key), and the tunnel carries bytes to a TCP "database" behind it.
/// </summary>
public sealed class SshTunnelServiceTests : IAsyncLifetime
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "rowlit-ssh-" + Guid.NewGuid().ToString("N"));
    private InProcessSshServer _ssh = null!;
    private EchoServer _db = null!;
    private SshKnownHosts _known = null!;
    private SshTunnelService _tunnels = null!;

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(_dir);
        _ssh = new InProcessSshServer();
        _db = new EchoServer();
        _known = new SshKnownHosts(Path.Combine(_dir, "ssh-known-hosts.json"));
        _tunnels = new SshTunnelService(_known, sweepInterval: Timeout.InfiniteTimeSpan);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await _tunnels.DisposeAsync();
        await _ssh.DisposeAsync();
        await _db.DisposeAsync();
        try { Directory.Delete(_dir, true); } catch (IOException) { /* best effort */ }
    }

    private ConnectionProfile Profile(string id = "c_pg", string user = InProcessSshServer.User, string? password = InProcessSshServer.Password, int? sshPort = null)
    {
        var p = new ConnectionProfile { Id = id, Name = "pg via ssh", ProviderId = "postgresql" };
        p.Props["host"] = "127.0.0.1"; // as the SSH server sees it
        p.Props["port"] = _db.Port;
        p.Props["user"] = "shop";
        p.Props[SshFormFields.Enabled] = true;
        p.Props[SshFormFields.Host] = "127.0.0.1";
        p.Props[SshFormFields.Port] = sshPort ?? _ssh.Port;
        p.Props[SshFormFields.User] = user;
        if (password is not null) p.Props[SshFormFields.Password] = password;
        p.Props["connectTimeout"] = 5;
        return p;
    }

    private static int LocalPort(ConnectionProfile resolved)
    {
        Assert.Equal(TunnelTargets.LocalHost, resolved.GetString("host"));
        return resolved.GetInt("port", 0);
    }

    [Fact]
    public async Task Password_tunnel_carries_bytes_and_is_reused()
    {
        var resolved = await _tunnels.ResolveAsync(Profile(), CancellationToken.None);
        var port = LocalPort(resolved);
        Assert.NotEqual(_db.Port, port);
        Assert.Equal("HELLO THROUGH SSH", await EchoServer.RoundTripAsync(port, "hello through ssh"));
        Assert.Equal("SECOND", await EchoServer.RoundTripAsync(port, "second"));

        var again = await _tunnels.ResolveAsync(Profile(), CancellationToken.None);
        Assert.Equal(port, LocalPort(again));
        Assert.Single(_tunnels.Tunnels);
        Assert.Equal(1, _ssh.PasswordLogins);
        Assert.Equal(2, _db.Accepted);
        // trust on first use: the host key is remembered
        Assert.NotNull(_known.Find("127.0.0.1", _ssh.Port));
    }

    [Fact]
    public async Task Concurrent_connections_are_counted_and_idle_tunnels_close()
    {
        var tunnels = new SshTunnelService(_known, idleTimeout: TimeSpan.Zero, sweepInterval: Timeout.InfiniteTimeSpan);
        await using var _ = tunnels;
        var port = LocalPort(await tunnels.ResolveAsync(Profile(), CancellationToken.None));
        using (var held = new TcpClient())
        {
            await held.ConnectAsync("127.0.0.1", port);
            var replies = await Task.WhenAll(Enumerable.Range(0, 8).Select(i => EchoServer.RoundTripAsync(port, $"conn {i}")));
            Assert.Equal(Enumerable.Range(0, 8).Select(i => $"CONN {i}"), replies);
            await WaitUntil(() => tunnels.Tunnels.Single().ActiveSockets == 1);
            await tunnels.SweepAsync();
            Assert.Single(tunnels.Tunnels); // an open socket keeps the tunnel
        }
        await WaitUntil(() => tunnels.Tunnels.Single().ActiveSockets == 0);
        await tunnels.SweepAsync();
        Assert.Empty(tunnels.Tunnels);
        await Assert.ThrowsAsync<SocketException>(async () => await EchoServer.RoundTripAsync(port, "closed"));
    }

    [Fact]
    public async Task Dropped_ssh_session_reconnects_on_the_same_local_port()
    {
        var port = LocalPort(await _tunnels.ResolveAsync(Profile(), CancellationToken.None));
        Assert.Equal("A", await EchoServer.RoundTripAsync(port, "a"));
        await _ssh.DropSessionsAsync();
        await WaitUntil(() => !_tunnels.Tunnels.Single().IsConnected);

        // a pooled driver connection reconnects to the same address: the tunnel reopens the SSH session itself
        Assert.Equal("B", await EchoServer.RoundTripAsync(port, "b"));
        Assert.Equal(2, _tunnels.Tunnels.Single().Connects);
        Assert.Equal(port, LocalPort(await _tunnels.ResolveAsync(Profile(), CancellationToken.None)));
    }

    [Fact]
    public async Task Edited_settings_open_a_new_tunnel_and_the_old_one_is_swept()
    {
        var first = LocalPort(await _tunnels.ResolveAsync(Profile(), CancellationToken.None));
        var edited = Profile();
        edited.Props[SshFormFields.KeepAlive] = false;
        var second = LocalPort(await _tunnels.ResolveAsync(edited, CancellationToken.None));
        Assert.NotEqual(first, second);
        Assert.Equal(2, _tunnels.Tunnels.Count);
        await _tunnels.SweepAsync(); // the superseded one has no sockets
        Assert.Equal(second, _tunnels.Tunnels.Single().LocalPort);
        await _tunnels.CloseAsync("c_pg");
        Assert.Empty(_tunnels.Tunnels);
    }

    [Fact]
    public async Task Wrong_password_is_an_ssh_hop_error()
    {
        var ex = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(Profile(password: "nope"), CancellationToken.None));
        AssertSshError(ex, "auth");
        Assert.Contains("SSH authentication failed for rowlit@127.0.0.1", ex.Message);
        Assert.Empty(_tunnels.Tunnels);
    }

    [Fact]
    public async Task Unreachable_ssh_server_is_an_ssh_hop_error()
    {
        var ex = await Assert.ThrowsAsync<EngineException>(() =>
            _tunnels.ResolveAsync(Profile(sshPort: InProcessSshServer.FreePort()), CancellationToken.None));
        AssertSshError(ex, "unreachable");
        Assert.Contains("is not reachable", ex.Message);
    }

    [Fact]
    public async Task Changed_host_key_is_refused()
    {
        Assert.Equal(SshKnownHosts.Verdict.New, _known.Check("127.0.0.1", _ssh.Port, "ssh-ed25519", "AAAAother", out _));
        var ex = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(Profile(), CancellationToken.None));
        AssertSshError(ex, "hostKey");
        Assert.Contains("host key of 127.0.0.1", ex.Message);
        Assert.Contains("ssh-known-hosts.json", ex.Message);

        Assert.True(_known.Forget("127.0.0.1", _ssh.Port));
        Assert.NotNull(await _tunnels.ResolveAsync(Profile(), CancellationToken.None));
    }

    [Fact]
    public async Task Private_key_logins_pem_and_encrypted_openssh()
    {
        // ECDSA: the in-process test server (DevTunnels) cannot verify RSA client keys; OpenSSH servers take both
        using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var pem = Path.Combine(_dir, "id ecdsa.pem"); // a space in the path (Windows profiles)
        await File.WriteAllTextAsync(pem, ec.ExportECPrivateKeyPem());
        var p = KeyProfile(pem, null);
        Assert.Equal("Z", await EchoServer.RoundTripAsync(LocalPort(await _tunnels.ResolveAsync(p, CancellationToken.None)), "z"));
        Assert.Equal(1, _ssh.KeyLogins);

        // an encrypted key in the OpenSSH format, as ssh-keygen writes it (Windows ships ssh-keygen with the OpenSSH client)
        var enc = Path.Combine(_dir, "id_enc");
        if (Keygen(enc, "pass phrase"))
        {
            var missing = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(KeyProfile(enc, null, "c_enc"), CancellationToken.None));
            AssertSshError(missing, "key");
            Assert.Contains("enter its passphrase", missing.Message);
            var wrong = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(KeyProfile(enc, "wrong", "c_enc"), CancellationToken.None));
            AssertSshError(wrong, "key");
            var withPass = await _tunnels.ResolveAsync(KeyProfile(enc, "pass phrase", "c_enc"), CancellationToken.None);
            Assert.Equal("Y", await EchoServer.RoundTripAsync(LocalPort(withPass), "y"));
        }

        var ppk = Path.Combine(_dir, "key.ppk");
        await File.WriteAllTextAsync(ppk, "PuTTY-User-Key-File-3: ssh-rsa\nEncryption: none\n");
        var putty = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(KeyProfile(ppk, null, "c_ppk"), CancellationToken.None));
        Assert.Contains("PuTTY", putty.Message);

        var none = await Assert.ThrowsAsync<EngineException>(() => _tunnels.ResolveAsync(KeyProfile(Path.Combine(_dir, "nope"), null, "c_none"), CancellationToken.None));
        Assert.Contains("does not exist", none.Message);
    }

    /// <summary>ssh-keygen -t ecdsa (encrypted, OpenSSH format); false when no ssh-keygen is installed.</summary>
    private static bool Keygen(string path, string passphrase)
    {
        var exe = OperatingSystem.IsWindows() ? Path.Combine(Environment.SystemDirectory, "OpenSSH", "ssh-keygen.exe") : "/usr/bin/ssh-keygen";
        if (!File.Exists(exe)) return false;
        var psi = new System.Diagnostics.ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-q", "-t", "ecdsa", "-b", "256", "-N", passphrase, "-f", path }) psi.ArgumentList.Add(a);
        using var proc = System.Diagnostics.Process.Start(psi)!;
        proc.WaitForExit(30_000);
        return proc.ExitCode == 0 && File.Exists(path);
    }

    private ConnectionProfile KeyProfile(string keyPath, string? passphrase, string id = "c_key")
    {
        var p = Profile(id, InProcessSshServer.KeyUser, password: null);
        p.Props[SshFormFields.Auth] = SshFormFields.AuthKey;
        p.Props[SshFormFields.KeyPath] = keyPath;
        if (passphrase is not null) p.Props[SshFormFields.Passphrase] = passphrase;
        return p;
    }

    [Fact]
    public async Task Ephemeral_lease_closes_with_the_test()
    {
        int port;
        await using (var lease = await _tunnels.OpenEphemeralAsync(Profile(), CancellationToken.None))
        {
            port = LocalPort(lease.Profile);
            Assert.Equal("rowlit@127.0.0.1:" + _ssh.Port, lease.Via);
            Assert.Equal("OK", await EchoServer.RoundTripAsync(port, "ok"));
            Assert.Empty(_tunnels.Tunnels); // not shared
        }
        await Assert.ThrowsAsync<SocketException>(async () => await EchoServer.RoundTripAsync(port, "closed"));
    }

    // ------------------------------------------------------------------ Test connection: which hop failed

    /// <summary>A provider whose Test opens a TCP connection to host:port and expects the echo.</summary>
    private sealed class EchoProvider : IDataSourceProvider
    {
        public string Id => "postgresql";
        public string DisplayName => "Echo";
        public Dialect? Dialect => null;
        public SourceKind Kind => SourceKind.KeyValue;
        public ConnectionFormSpec FormSpec => SshFormFields.Append(new ConnectionFormSpec([new FormField("host", "Host", "text"), new FormField("port", "Port", "number")]));

        public async Task<TestConnectionResult> TestAsync(ConnectionProfile profile, string? password, CancellationToken ct)
        {
            try
            {
                var reply = await EchoServer.RoundTripAsync(profile.GetInt("port", 0), "ping");
                return reply == "PING"
                    ? new TestConnectionResult(true, new ServerInfo("Echo 1", null, null, null, null), 1, null)
                    : new TestConnectionResult(false, null, 1, new ErrorInfo(ErrorCodes.ProviderError, "The server closed the connection."));
            }
            catch (Exception ex)
            {
                return new TestConnectionResult(false, null, 1, new ErrorInfo(ErrorCodes.ProviderError, ex.Message));
            }
        }

        public Task<IDataSourceClient> OpenAsync(ConnectionProfile profile, string? password, CancellationToken ct) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Test_reports_the_failing_hop()
    {
        var provider = new EchoProvider();
        var ok = await TunnelConnectionTest.RunAsync(provider, _tunnels, Profile(), null, CancellationToken.None, CancellationToken.None);
        Assert.True(ok.Ok, ok.Error?.Message);
        Assert.Null(ok.Hop);
        Assert.Equal("rowlit@127.0.0.1:" + _ssh.Port, ok.Via);

        var badSsh = await TunnelConnectionTest.RunAsync(provider, _tunnels, Profile(password: "x"), null, CancellationToken.None, CancellationToken.None);
        Assert.False(badSsh.Ok);
        Assert.Equal("ssh", badSsh.Hop);
        Assert.Equal(ErrorCodes.SshTunnel, badSsh.Error!.Code);

        var noDb = Profile();
        noDb.Props["port"] = InProcessSshServer.FreePort(); // nothing listens behind the bastion
        var badDb = await TunnelConnectionTest.RunAsync(provider, _tunnels, noDb, null, CancellationToken.None, CancellationToken.None);
        Assert.False(badDb.Ok);
        Assert.Equal("db", badDb.Hop);
        Assert.Contains("could not reach 127.0.0.1", badDb.Error!.Detail);

        var cluster = new ConnectionProfile { Id = "", Name = "r", ProviderId = "redis", Props = Profile().Props };
        cluster.Props["mode"] = "cluster";
        var refused = await TunnelConnectionTest.RunAsync(provider, _tunnels, cluster, null, CancellationToken.None, CancellationToken.None);
        Assert.Equal(("ssh", ErrorCodes.NotSupported), (refused.Hop, refused.Error!.Code));
        Assert.Contains("Redis Cluster", refused.Error.Message);
        Assert.Empty(_tunnels.Tunnels);
    }

    // ------------------------------------------------------------------ ConnectionStore: secrets and the one open path

    [Fact]
    public async Task Store_keeps_ssh_secrets_out_of_the_file_and_resolves_through_the_tunnel()
    {
        var provider = new EchoProvider();
        var registry = new SourceRegistry(new ProviderRegistry([]), [provider]);
        var store = new ConnectionStore(new AppPaths(_dir), new InMemorySecretStore(), registry).UseTunnels(_tunnels);
        var created = store.Create(Profile(id: ""), "dbpass");

        var file = await File.ReadAllTextAsync(Path.Combine(_dir, "connections.json"));
        Assert.DoesNotContain(InProcessSshServer.Password, file);
        Assert.Contains("ssh.host", file);
        Assert.Equal(InProcessSshServer.Password, store.GetSecret(created.Id, SshFormFields.Password));
        Assert.Null(store.CurrentForOpen(created)); // no tunnel yet: nothing pooled through one

        var resolved = await store.ResolveForOpenAsync(created.Id);
        Assert.Equal("Q", await EchoServer.RoundTripAsync(LocalPort(resolved), "q"));
        Assert.Equal(resolved.GetInt("port", 0), store.CurrentForOpen(created)!.GetInt("port", 0));
        Assert.Equal(_db.Port, store.Get(created.Id).GetInt("port", 0)); // the stored profile is untouched

        var noTunnels = new ConnectionStore(new AppPaths(_dir), new InMemorySecretStore(), registry);
        var ex = await Assert.ThrowsAsync<EngineException>(() => noTunnels.ResolveForOpenAsync(created));
        Assert.Equal(ErrorCodes.NotSupported, ex.Code);
    }

    [Fact]
    public void Store_refuses_to_save_a_tunnel_the_provider_cannot_use()
    {
        var registry = new SourceRegistry(new ProviderRegistry([]), [new EchoProvider()]);
        var store = new ConnectionStore(new AppPaths(_dir), new InMemorySecretStore(), registry);
        var p = Profile(id: "");
        p.Props["host"] = "a,b";
        var ex = Assert.Throws<EngineException>(() => store.Create(p, null));
        Assert.Contains("one host", ex.Message);
        p.Props.Remove(SshFormFields.Host);
        Assert.Contains("SSH host", Assert.Throws<EngineException>(() => store.Create(p, null)).Message);
    }

    private static void AssertSshError(EngineException ex, string reason)
    {
        Assert.Equal(ErrorCodes.SshTunnel, ex.Code);
        var detail = JsonSerializer.SerializeToNode(ex.Detail)!.AsObject();
        Assert.Equal("ssh", detail["hop"]!.GetValue<string>());
        Assert.Equal(reason, detail["reason"]!.GetValue<string>());
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        var until = DateTime.UtcNow.AddSeconds(10);
        while (!condition())
        {
            if (DateTime.UtcNow > until) throw new TimeoutException("condition not met");
            await Task.Delay(25);
        }
    }

}
