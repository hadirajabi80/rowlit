using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using Microsoft.DevTunnels.Ssh;
using Microsoft.DevTunnels.Ssh.Algorithms;
using Microsoft.DevTunnels.Ssh.Events;
using Microsoft.DevTunnels.Ssh.Tcp;

namespace DbStudio.Core.Tests.Tunnels;

/// <summary>
/// WP-SSH test double: a real SSH server in the test process (Microsoft.DevTunnels.Ssh, MIT) that accepts password and
/// public-key logins and forwards <c>direct-tcpip</c> channels to local ports, which is what an OpenSSH bastion does
/// for <c>ssh -L</c>. SSH.NET talks the actual protocol to it (key exchange, host key, auth, channels).
/// </summary>
internal sealed class InProcessSshServer : IAsyncDisposable
{
    public const string User = "rowlit", Password = "s3cret", KeyUser = "keyuser";

    private readonly SshServer _server;
    private readonly Task _accept;

    public InProcessSshServer(int? port = null, IKeyPair? hostKey = null)
    {
        Port = port ?? FreePort();
        HostKey = hostKey ?? SshAlgorithms.PublicKey.ECDsaSha2Nistp256.GenerateKeyPair();
        var config = new SshSessionConfiguration();
        config.AddService(typeof(PortForwardingService));
        _server = new SshServer(config, new TraceSource("ssh-test") { Switch = { Level = SourceLevels.Off } })
        {
            Credentials = new SshServerCredentials(HostKey),
        };
        _server.SessionAuthenticating += OnAuthenticating;
        _server.ExceptionRaised += (_, ex) => Errors.Add(ex);
        _server.SessionOpened += (_, session) => Sessions.Add(session);
        _accept = _server.AcceptSessionsAsync(Port, IPAddress.Loopback);
    }

    public int Port { get; }
    public IKeyPair HostKey { get; }
    public List<SshServerSession> Sessions { get; } = [];
    public List<Exception> Errors { get; } = [];
    public int PasswordLogins { get; private set; }
    public int KeyLogins { get; private set; }

    private void OnAuthenticating(object? sender, SshAuthenticatingEventArgs e)
    {
        switch (e.AuthenticationType)
        {
            case SshAuthenticationType.ClientPassword when e.Username == User && e.Password == Password:
                PasswordLogins++;
                e.AuthenticationTask = Task.FromResult<ClaimsPrincipal?>(new ClaimsPrincipal(new ClaimsIdentity("ssh")));
                break;
            case SshAuthenticationType.ClientPublicKeyQuery when e.Username == KeyUser:
                e.AuthenticationTask = Task.FromResult<ClaimsPrincipal?>(new ClaimsPrincipal(new ClaimsIdentity("ssh")));
                break;
            case SshAuthenticationType.ClientPublicKey when e.Username == KeyUser:
                KeyLogins++;
                e.AuthenticationTask = Task.FromResult<ClaimsPrincipal?>(new ClaimsPrincipal(new ClaimsIdentity("ssh")));
                break;
        }
    }

    /// <summary>Drops every SSH session (the bastion restarted, the NAT forgot the flow).</summary>
    public async Task DropSessionsAsync()
    {
        foreach (var s in Sessions.ToList()) await s.CloseAsync(SshDisconnectReason.ConnectionLost);
        Sessions.Clear();
    }

    public static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public async ValueTask DisposeAsync()
    {
        _server.Dispose();
        try { await _accept.WaitAsync(TimeSpan.FromSeconds(5)); } catch (Exception) { /* stopped */ }
    }
}

/// <summary>A TCP server that echoes what it receives, upper-cased (the "database" behind the bastion).</summary>
internal sealed class EchoServer : IAsyncDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;

    public EchoServer()
    {
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _loop = Task.Run(async () =>
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient c;
                try { c = await _listener.AcceptTcpClientAsync(_cts.Token); } catch (Exception) { return; }
                Accepted++;
                _ = Task.Run(async () =>
                {
                    using var client = c;
                    var s = client.GetStream();
                    var buf = new byte[4096];
                    try
                    {
                        int n;
                        while ((n = await s.ReadAsync(buf, _cts.Token)) > 0)
                        {
                            for (var i = 0; i < n; i++) buf[i] = (byte)char.ToUpperInvariant((char)buf[i]);
                            await s.WriteAsync(buf.AsMemory(0, n), _cts.Token);
                        }
                    }
                    catch (Exception) { /* closed */ }
                });
            }
        });
    }

    public int Port { get; }
    public int Accepted { get; private set; }

    /// <summary>Connects to <paramref name="port"/>, sends <paramref name="text"/>, returns the reply.</summary>
    public static async Task<string> RoundTripAsync(int port, string text)
    {
        using var c = new TcpClient();
        await c.ConnectAsync(IPAddress.Loopback, port);
        var s = c.GetStream();
        var bytes = System.Text.Encoding.ASCII.GetBytes(text);
        await s.WriteAsync(bytes);
        var buf = new byte[bytes.Length];
        var read = 0;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (read < buf.Length)
        {
            var n = await s.ReadAsync(buf.AsMemory(read), timeout.Token);
            if (n == 0) break;
            read += n;
        }
        return System.Text.Encoding.ASCII.GetString(buf, 0, read);
    }

    public async ValueTask DisposeAsync()
    {
        await _cts.CancelAsync();
        _listener.Stop();
        try { await _loop; } catch (Exception) { /* stopped */ }
    }
}
