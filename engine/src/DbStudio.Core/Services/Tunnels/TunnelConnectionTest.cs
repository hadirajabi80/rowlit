using System.Diagnostics;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>
/// WP-SSH: "Test connection" for a profile with a tunnel. Runs the whole chain on a private tunnel (closed afterwards) and
/// reports the hop that failed: "ssh" (SSH server unreachable, authentication, host key, a configuration the tunnel cannot
/// carry) or "db" (the server behind it), adding the SSH server's own reason when it could not reach the database.
/// </summary>
public static class TunnelConnectionTest
{
    public static async Task<TestConnectionResult> RunAsync(IDataSourceProvider provider, ITunnelResolver? tunnels, ConnectionProfile profile,
        string? password, CancellationToken timeoutToken, CancellationToken requestToken)
    {
        var started = Stopwatch.StartNew();
        string? via = null;
        try
        {
            via = SshSettings.From(profile).Label;
            var endpoint = TunnelTargets.Target(profile);
            if (tunnels is null) throw TunnelTargets.Unsupported("SSH tunnels are not available in this engine.");
            await using var lease = await tunnels.OpenEphemeralAsync(profile, timeoutToken).ConfigureAwait(false);
            TestConnectionResult result;
            try
            {
                result = await provider.TestAsync(lease.Profile, password, timeoutToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!requestToken.IsCancellationRequested)
            {
                result = new TestConnectionResult(false, null, started.ElapsedMilliseconds, new ErrorInfo(ErrorCodes.ProviderError, "The connection test timed out."));
            }
            if (result.Ok) return result with { Via = lease.Via };
            var error = result.Error ?? new ErrorInfo(ErrorCodes.ProviderError, "The connection failed.");
            if (lease.LastForwardError is { Length: > 0 } forward)
                error = error with { Detail = $"The SSH server {lease.Via} could not reach {endpoint.Host}:{endpoint.Port}: {forward}" };
            return result with { Error = error, Hop = "db", Via = lease.Via };
        }
        catch (EngineException ex)
        {
            return new TestConnectionResult(false, null, started.ElapsedMilliseconds, new ErrorInfo(ex.Code, ex.Message), "ssh", via);
        }
        catch (OperationCanceledException) when (!requestToken.IsCancellationRequested)
        {
            return new TestConnectionResult(false, null, started.ElapsedMilliseconds,
                new ErrorInfo(ErrorCodes.SshTunnel, "The SSH connection timed out."), "ssh", via);
        }
    }
}
