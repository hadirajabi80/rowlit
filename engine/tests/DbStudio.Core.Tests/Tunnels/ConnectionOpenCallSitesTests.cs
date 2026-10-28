namespace DbStudio.Core.Tests.Tunnels;

/// <summary>
/// WP-SSH guard: a driver connection opened from a profile that skipped <c>ConnectionStore.ResolveForOpen(Async)</c> would
/// bypass the SSH tunnel ("works in the console, fails in the designer"). Code that reads a connection's password is code
/// that opens a connection, so it must resolve the profile too; <c>WithSecrets</c> (secrets without the tunnel) is only
/// for the places listed here, which do not open a driver connection with the result.
/// </summary>
public sealed class ConnectionOpenCallSitesTests
{
    /// <summary>Files allowed to call WithSecrets( directly, and why.</summary>
    private static readonly Dictionary<string, string> WithSecretsAllowed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["DbStudio.Core/Services/ConnectionStore.cs"] = "defines it; ResolveForOpen builds on it",
        ["DbStudio.Host/Endpoints/ConnectionEndpoints.cs"] = "Test: the tunnel is a private one (TunnelConnectionTest)",
        ["DbStudio.Import/ImportService.cs"] = "Capabilities reads flags only",
    };

    /// <summary>Files that read passwords but legitimately never resolve a tunnel.</summary>
    private static readonly Dictionary<string, string> PasswordWithoutResolveAllowed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["DbStudio.Core/Services/ConnectionStore.cs"] = "defines it",
        ["DbStudio.Host/Endpoints/ConnectionEndpoints.cs"] = "Test (TunnelConnectionTest)",
        ["DbStudio.Providers.Snowflake/SnowflakeModule.cs"] = "Snowflake has no SSH tunnel (HTTPS cloud service)",
    };

    [Fact]
    public void Every_connection_open_goes_through_the_resolver()
    {
        var src = FindEngineSrc();
        var problems = new List<string>();
        foreach (var file in Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, file).Replace('\\', '/');
            if (rel.Contains("/obj/") || rel.Contains("/bin/")) continue;
            var text = File.ReadAllText(file);
            var resolves = text.Contains("ResolveForOpen", StringComparison.Ordinal) || text.Contains("CurrentForOpen", StringComparison.Ordinal);
            if (text.Contains(".WithSecrets(", StringComparison.Ordinal) && !WithSecretsAllowed.ContainsKey(rel))
                problems.Add($"{rel}: calls WithSecrets( - use ConnectionStore.ResolveForOpen(Async) so SSH tunnels apply");
            var readsPassword = text.Contains("GetPassword(", StringComparison.Ordinal) || text.Contains(".GetPassword,", StringComparison.Ordinal)
                                || text.Contains(".GetPassword)", StringComparison.Ordinal);
            if (readsPassword && !resolves && !PasswordWithoutResolveAllowed.ContainsKey(rel))
                problems.Add($"{rel}: reads a connection password but never resolves the profile for opening (SSH tunnel bypassed)");
        }
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems));
    }

    private static string FindEngineSrc()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "DbStudio.slnx"))) dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "src");
    }
}
