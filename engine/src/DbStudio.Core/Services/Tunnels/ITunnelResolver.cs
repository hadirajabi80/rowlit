using DbStudio.Core.Models;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>
/// WP-SSH: turns a profile into the profile a driver should open. Today one implementation, <see cref="SshTunnelService"/>;
/// an HTTP/SOCKS proxy resolver would sit next to it (the same rewrite of the server address to a local endpoint).
/// Callers go through <see cref="ConnectionStore.ResolveForOpenAsync(ConnectionProfile, CancellationToken)"/>.
/// </summary>
public interface ITunnelResolver
{
    /// <summary>
    /// <paramref name="profile"/> (secrets already restored) pointed at the local end of its tunnel, opening or reconnecting
    /// the tunnel when needed. Throws <see cref="EngineException"/> (code <see cref="ErrorCodes.SshTunnel"/> or
    /// <see cref="ErrorCodes.NotSupported"/>, detail <c>hop = "ssh"</c>) when the SSH hop fails.
    /// </summary>
    Task<ConnectionProfile> ResolveAsync(ConnectionProfile profile, CancellationToken ct);

    /// <summary>The rewritten profile when its tunnel is open now, without connecting; null when there is none.</summary>
    ConnectionProfile? Current(ConnectionProfile profile);

    /// <summary>A private tunnel for one connection test (not shared, closed with the lease).</summary>
    Task<ITunnelLease> OpenEphemeralAsync(ConnectionProfile profile, CancellationToken ct);

    /// <summary>Closes every tunnel of a connection (deleted, or closed by the person).</summary>
    Task CloseAsync(string connectionId);
}

/// <summary>A tunnel held for one use; disposing closes it.</summary>
public interface ITunnelLease : IAsyncDisposable
{
    /// <summary>The profile pointed at the tunnel's local end.</summary>
    ConnectionProfile Profile { get; }

    /// <summary>"user@bastion:port".</summary>
    string Via { get; }

    /// <summary>The last error the SSH server reported when it opened the forwarded connection ("connect failed"), or null.</summary>
    string? LastForwardError { get; }
}
