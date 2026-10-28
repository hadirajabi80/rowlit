using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using DbStudio.Core.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>
/// WP-SSH: SSH tunnels for connection profiles (SSH.NET). One tunnel per (connection, SSH settings, database endpoint):
/// a listener on 127.0.0.1:&lt;random&gt; that every driver connection of the profile uses, each accepted socket piped
/// through the SSH session's <c>direct-tcpip</c> forward to the database server.
/// <list type="bullet">
/// <item>The local port stays the same for the tunnel's life, so driver pools and long-lived clients (Redis, MongoDB) keep
/// working when the SSH session drops: the next accepted socket reconnects the session.</item>
/// <item>A tunnel counts its open sockets; one without any for <see cref="IdleTimeout"/> closes (pools cleared by the
/// <see cref="ResourceManager"/> idle policy close their sockets, so the tunnel follows). A tunnel whose settings were
/// edited is superseded: the next open uses a new one and the old one closes once its sockets are gone.</item>
/// <item>Host keys: trust on first use (<see cref="SshKnownHosts"/>).</item>
/// </list>
/// </summary>
public sealed class SshTunnelService : ITunnelResolver, IAsyncDisposable
{
    public static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(30);

    private readonly ConcurrentDictionary<string, SshTunnel> _tunnels = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SshKnownHosts _knownHosts;
    private readonly ILogger _log;
    private readonly TimeProvider _time;
    private readonly Timer? _sweeper;
    private bool _disposed;

    public SshTunnelService(SshKnownHosts knownHosts, ILogger<SshTunnelService>? log = null, TimeProvider? time = null,
        TimeSpan? idleTimeout = null, TimeSpan? sweepInterval = null)
    {
        _knownHosts = knownHosts;
        _log = (ILogger?)log ?? NullLogger.Instance;
        _time = time ?? TimeProvider.System;
        IdleTimeout = idleTimeout ?? DefaultIdleTimeout;
        var every = sweepInterval ?? TimeSpan.FromSeconds(30);
        if (every != Timeout.InfiniteTimeSpan) _sweeper = new Timer(_ => _ = SweepAsync(), null, every, every);
    }

    public TimeSpan IdleTimeout { get; }

    /// <summary>Open tunnels (tests, diagnostics).</summary>
    public IReadOnlyList<SshTunnel> Tunnels => _tunnels.Values.ToList();

    public async Task<ConnectionProfile> ResolveAsync(ConnectionProfile profile, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!SshSettings.IsEnabled(profile)) return profile;
        var settings = SshSettings.From(profile);
        var endpoint = TunnelTargets.Target(profile);
        var key = Key(profile.Id, settings, endpoint);

        if (!_tunnels.TryGetValue(key, out var tunnel))
        {
            await _gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                if (!_tunnels.TryGetValue(key, out tunnel))
                {
                    var fresh = new SshTunnel(key, profile.Id, settings, endpoint, _knownHosts, _log, _time);
                    try
                    {
                        await fresh.ConnectAsync(ct).ConfigureAwait(false);
                    }
                    catch
                    {
                        await fresh.DisposeAsync().ConfigureAwait(false);
                        throw;
                    }
                    _tunnels[key] = fresh;
                    tunnel = fresh;
                    _log.LogInformation("SSH tunnel for {ConnectionId} open: 127.0.0.1:{Port} -> {Via} -> {Host}:{RemotePort}",
                        profile.Id, fresh.LocalPort, settings.Label, endpoint.Host, endpoint.Port);
                }
            }
            finally
            {
                _gate.Release();
            }
        }
        else
        {
            // reconnect now when the SSH session dropped, so the caller gets the SSH error instead of a driver timeout
            await tunnel.ConnectAsync(ct).ConfigureAwait(false);
        }
        tunnel.Touch();
        return TunnelTargets.Rewrite(profile, TunnelTargets.LocalHost, tunnel.LocalPort);
    }

    public ConnectionProfile? Current(ConnectionProfile profile)
    {
        if (!SshSettings.IsEnabled(profile)) return profile;
        try
        {
            var key = Key(profile.Id, SshSettings.From(profile), TunnelTargets.Target(profile));
            return _tunnels.TryGetValue(key, out var t) ? TunnelTargets.Rewrite(profile, TunnelTargets.LocalHost, t.LocalPort) : null;
        }
        catch (EngineException)
        {
            return null;
        }
    }

    public async Task<ITunnelLease> OpenEphemeralAsync(ConnectionProfile profile, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var settings = SshSettings.From(profile);
        var endpoint = TunnelTargets.Target(profile);
        var tunnel = new SshTunnel("test:" + Guid.NewGuid().ToString("N"), profile.Id, settings, endpoint, _knownHosts, _log, _time);
        try
        {
            await tunnel.ConnectAsync(ct).ConfigureAwait(false);
        }
        catch
        {
            await tunnel.DisposeAsync().ConfigureAwait(false);
            throw;
        }
        return new Lease(tunnel, TunnelTargets.Rewrite(profile, TunnelTargets.LocalHost, tunnel.LocalPort));
    }

    public async Task CloseAsync(string connectionId)
    {
        foreach (var (key, t) in _tunnels.ToArray())
        {
            if (!string.Equals(t.ProfileId, connectionId, StringComparison.Ordinal)) continue;
            if (_tunnels.TryRemove(key, out _)) await t.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Closes idle tunnels (no socket for <see cref="IdleTimeout"/>) and superseded ones without sockets.</summary>
    public async Task SweepAsync()
    {
        if (_disposed) return;
        var now = _time.GetUtcNow();
        var newest = _tunnels.Values.GroupBy(t => t.ProfileId).ToDictionary(g => g.Key, g => g.MaxBy(t => t.LastActivity)!.Key);
        foreach (var (key, t) in _tunnels.ToArray())
        {
            if (t.ActiveSockets > 0) continue;
            var superseded = newest.TryGetValue(t.ProfileId, out var latest) && latest != key;
            if (!superseded && now - t.LastActivity < IdleTimeout) continue;
            if (!_tunnels.TryRemove(key, out _)) continue;
            _log.LogInformation("SSH tunnel for {ConnectionId} via {Via} closed ({Reason})", t.ProfileId, t.Settings.Label, superseded ? "settings changed" : "idle");
            await t.DisposeAsync().ConfigureAwait(false);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        if (_sweeper is not null) await _sweeper.DisposeAsync().ConfigureAwait(false);
        foreach (var t in _tunnels.Values) await t.DisposeAsync().ConfigureAwait(false);
        _tunnels.Clear();
    }

    private static string Key(string profileId, SshSettings s, TunnelEndpoint e) => $"{profileId}|{s.Fingerprint}|{e.Host.ToLowerInvariant()}:{e.Port}";

    private sealed class Lease(SshTunnel tunnel, ConnectionProfile profile) : ITunnelLease
    {
        public ConnectionProfile Profile { get; } = profile;
        public string Via => tunnel.Settings.Label;
        public string? LastForwardError => tunnel.LastForwardError;
        public ValueTask DisposeAsync() => tunnel.DisposeAsync();
    }
}

/// <summary>One tunnel: the local listener, the SSH session (reconnected on demand) and the open sockets.</summary>
public sealed class SshTunnel : IAsyncDisposable
{
    private readonly Socket _listener;
    private readonly SshKnownHosts _knownHosts;
    private readonly ILogger _log;
    private readonly TimeProvider _time;
    private readonly SemaphoreSlim _connectGate = new(1, 1);
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<Socket, byte> _sockets = new();
    private SshClient? _client;
    private ForwardedPortLocal? _hop;
    private long _lastActivity;
    private int _active;
    private bool _disposed;

    internal SshTunnel(string key, string profileId, SshSettings settings, TunnelEndpoint endpoint, SshKnownHosts knownHosts, ILogger log, TimeProvider time)
    {
        Key = key;
        ProfileId = profileId;
        Settings = settings;
        Endpoint = endpoint;
        _knownHosts = knownHosts;
        _log = log;
        _time = time;
        _listener = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        _listener.Bind(new IPEndPoint(IPAddress.Loopback, 0));
        _listener.Listen(128);
        LocalPort = ((IPEndPoint)_listener.LocalEndPoint!).Port;
        Touch();
        _ = AcceptLoopAsync();
    }

    public string Key { get; }
    public string ProfileId { get; }
    public SshSettings Settings { get; }
    public TunnelEndpoint Endpoint { get; }
    public int LocalPort { get; }
    public int ActiveSockets => Volatile.Read(ref _active);
    public DateTimeOffset LastActivity => new(Interlocked.Read(ref _lastActivity), TimeSpan.Zero);
    public bool IsConnected => _client is { IsConnected: true } && _hop is { IsStarted: true };

    /// <summary>The last error of a forwarded connection (the SSH server could not reach the database), or null.</summary>
    public string? LastForwardError { get; private set; }

    /// <summary>Times the SSH session was (re)connected.</summary>
    public int Connects { get; private set; }

    internal void Touch() => Interlocked.Exchange(ref _lastActivity, _time.GetUtcNow().UtcTicks);

    /// <summary>Connects the SSH session unless it is connected; returns the port of the SSH.NET forward.</summary>
    public async Task<int> ConnectAsync(CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (IsConnected) return (int)_hop!.BoundPort;
        await _connectGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (IsConnected) return (int)_hop!.BoundPort;
            DropSession();
            var client = await SshConnector.ConnectAsync(Settings, _knownHosts, ct).ConfigureAwait(false);
            ForwardedPortLocal hop;
            try
            {
                hop = new ForwardedPortLocal(IPAddress.Loopback.ToString(), 0, Endpoint.Host, (uint)Endpoint.Port);
                hop.Exception += (_, e) => LastForwardError = ConnectionGuard.RootMessage(e.Exception);
                client.AddForwardedPort(hop);
                hop.Start();
            }
            catch
            {
                client.Dispose();
                throw;
            }
            client.ErrorOccurred += (_, e) => _log.LogWarning("SSH session {Via} of {ConnectionId} failed: {Message}", Settings.Label, ProfileId, e.Exception.Message);
            _client = client;
            _hop = hop;
            Connects++;
            return (int)hop.BoundPort;
        }
        finally
        {
            _connectGate.Release();
        }
    }

    private void DropSession()
    {
        var hop = _hop;
        var client = _client;
        _hop = null;
        _client = null;
        try { hop?.Stop(); } catch (Exception) { /* already stopped */ }
        try { hop?.Dispose(); } catch (Exception) { /* best effort */ }
        try { client?.Dispose(); } catch (Exception) { /* best effort */ }
    }

    private async Task AcceptLoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            Socket local;
            try
            {
                local = await _listener.AcceptAsync(_cts.Token).ConfigureAwait(false);
            }
            catch (Exception) when (_cts.IsCancellationRequested || _disposed)
            {
                return;
            }
            catch (SocketException ex)
            {
                _log.LogDebug(ex, "SSH tunnel accept failed");
                continue;
            }
            _ = ServeAsync(local);
        }
    }

    private async Task ServeAsync(Socket local)
    {
        Interlocked.Increment(ref _active);
        _sockets[local] = 0;
        Touch();
        Socket? remote = null;
        try
        {
            local.NoDelay = true;
            var hopPort = await ConnectAsync(_cts.Token).ConfigureAwait(false);
            remote = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            _sockets[remote] = 0;
            await remote.ConnectAsync(new IPEndPoint(IPAddress.Loopback, hopPort), _cts.Token).ConfigureAwait(false);
            await PumpAsync(local, remote, _cts.Token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // the driver sees its socket close; the SSH reason goes to the log (and to Test through LastForwardError)
            LastForwardError ??= ConnectionGuard.RootMessage(ex);
            _log.LogDebug(ex, "SSH tunnel {Via} of {ConnectionId}: forwarded connection failed", Settings.Label, ProfileId);
        }
        finally
        {
            _sockets.TryRemove(local, out _);
            local.Dispose();
            if (remote is not null)
            {
                _sockets.TryRemove(remote, out _);
                remote.Dispose();
            }
            Interlocked.Decrement(ref _active);
            Touch();
        }
    }

    private static async Task PumpAsync(Socket a, Socket b, CancellationToken ct)
    {
        using var sa = new NetworkStream(a, ownsSocket: false);
        using var sb = new NetworkStream(b, ownsSocket: false);
        await Task.WhenAll(CopyAsync(sa, a, sb, b, ct), CopyAsync(sb, b, sa, a, ct)).ConfigureAwait(false);
    }

    /// <summary>Copies until EOF, then half-closes the other side; on an error closes both so the other direction ends too.</summary>
    private static async Task CopyAsync(NetworkStream from, Socket fromSocket, NetworkStream to, Socket toSocket, CancellationToken ct)
    {
        try
        {
            await from.CopyToAsync(to, 81920, ct).ConfigureAwait(false);
            try { toSocket.Shutdown(SocketShutdown.Send); } catch (Exception) { /* closed meanwhile */ }
        }
        catch (Exception)
        {
            try { fromSocket.Close(); } catch (Exception) { /* closed */ }
            try { toSocket.Close(); } catch (Exception) { /* closed */ }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _cts.CancelAsync().ConfigureAwait(false);
        try { _listener.Dispose(); } catch (Exception) { /* best effort */ }
        foreach (var s in _sockets.Keys)
        {
            try { s.Dispose(); } catch (Exception) { /* best effort */ }
        }
        await _connectGate.WaitAsync().ConfigureAwait(false);
        try
        {
            DropSession();
        }
        finally
        {
            _connectGate.Release();
        }
        _cts.Dispose();
    }
}

/// <summary>Opens an authenticated SSH.NET client for <see cref="SshSettings"/>, mapping failures to clear SSH-hop errors.</summary>
public static class SshConnector
{
    public static async Task<SshClient> ConnectAsync(SshSettings s, SshKnownHosts knownHosts, CancellationToken ct)
    {
        var info = new ConnectionInfo(s.Host, s.Port, s.User, AuthMethods(s)) { Timeout = TimeSpan.FromSeconds(s.ConnectTimeoutSeconds) };
        var client = new SshClient(info);
        if (s.KeepAlive) client.KeepAliveInterval = SshTunnelService.KeepAliveInterval;
        SshKnownHosts.Entry? changedFrom = null;
        string? presented = null;
        client.HostKeyReceived += (_, e) =>
        {
            presented = $"{e.HostKeyName} SHA256:{e.FingerPrintSHA256}";
            var verdict = knownHosts.Check(s.Host, s.Port, e.HostKeyName, e.FingerPrintSHA256, out var known);
            e.CanTrust = verdict != SshKnownHosts.Verdict.Changed;
            if (!e.CanTrust) changedFrom = known;
        };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(s.ConnectTimeoutSeconds + 5));
        try
        {
            await client.ConnectAsync(timeout.Token).ConfigureAwait(false);
            return client;
        }
        catch (Exception ex)
        {
            client.Dispose();
            if (ex is OperationCanceledException && ct.IsCancellationRequested) throw;
            if (changedFrom is not null)
                throw Error($"The SSH host key of {s.Host}:{s.Port} changed: it was {changedFrom.Algorithm} SHA256:{changedFrom.Fingerprint}, the server now presents {presented}. "
                    + $"This can mean someone is intercepting the connection. If the server was reinstalled, remove its entry from {knownHosts.FilePath ?? "the known hosts"} and connect again.",
                    s, "hostKey");
            throw Map(ex, s);
        }
    }

    private static AuthenticationMethod[] AuthMethods(SshSettings s)
    {
        if (s.Auth == SshFormFields.AuthKey)
        {
            PrivateKeyFile key;
            try
            {
                if (!File.Exists(s.KeyPath)) throw Error($"The private key file '{s.KeyPath}' does not exist.", s, "key", SshFormFields.KeyPath);
                key = s.Passphrase is null ? new PrivateKeyFile(s.KeyPath) : new PrivateKeyFile(s.KeyPath, s.Passphrase);
            }
            catch (SshPassPhraseNullOrEmptyException)
            {
                throw Error($"The private key '{Path.GetFileName(s.KeyPath)}' is encrypted: enter its passphrase.", s, "key", SshFormFields.Passphrase);
            }
            catch (Exception ex) when (ex is not EngineException)
            {
                var ppk = File.Exists(s.KeyPath) && File.ReadLines(s.KeyPath!).FirstOrDefault()?.StartsWith("PuTTY-User-Key-File", StringComparison.Ordinal) == true;
                throw Error(ppk
                    ? $"'{Path.GetFileName(s.KeyPath)}' is a PuTTY key (.ppk), which is not supported: export it as an OpenSSH key with PuTTYgen (Conversions > Export OpenSSH key)."
                    : $"Could not read the private key '{Path.GetFileName(s.KeyPath)}': {ConnectionGuard.RootMessage(ex)} (wrong passphrase, or a format other than OpenSSH/PEM).",
                    s, "key", SshFormFields.KeyPath);
            }
            return [new PrivateKeyAuthenticationMethod(s.User, key)];
        }
        var password = s.Password ?? "";
        var interactive = new KeyboardInteractiveAuthenticationMethod(s.User);
        interactive.AuthenticationPrompt += (_, e) =>
        {
            foreach (var prompt in e.Prompts) prompt.Response = password;
        };
        return [new PasswordAuthenticationMethod(s.User, password), interactive];
    }

    private static EngineException Map(Exception ex, SshSettings s) => ex switch
    {
        EngineException e => e,
        SshAuthenticationException => Error($"SSH authentication failed for {s.User}@{s.Host}: {ConnectionGuard.RootMessage(ex)}", s, "auth"),
        SocketException se => Error($"The SSH server {s.Host}:{s.Port} is not reachable: {se.Message}", s, "unreachable"),
        SshOperationTimeoutException or OperationCanceledException or TimeoutException =>
            Error($"The SSH server {s.Host}:{s.Port} did not answer within {s.ConnectTimeoutSeconds} s.", s, "timeout"),
        _ => Error($"SSH connection to {s.Host}:{s.Port} failed: {ConnectionGuard.RootMessage(ex)}", s, "ssh"),
    };

    internal static EngineException Error(string message, SshSettings s, string reason, string? field = null) =>
        new(503, ErrorCodes.SshTunnel, message, new { hop = "ssh", reason, via = s.Label, field });
}
