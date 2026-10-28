using System.Diagnostics;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using StackExchange.Redis;

namespace DbStudio.Sources.Redis;

/// <summary>
/// Redis source (docs/PLAN-M2.md 5.1): standalone, cluster and sentinel through StackExchange.Redis, TLS, ACL user,
/// database index. <see cref="OpenAsync"/> returns the shared <see cref="RedisClient"/> of a connection.
/// </summary>
public sealed class RedisProvider : IDataSourceProvider
{
    public string Id => "redis";
    public string DisplayName => "Redis";
    public SourceKind Kind => SourceKind.KeyValue;
    public ConnectionFormSpec FormSpec { get; } = Core.Services.Tunnels.SshFormFields.Append(Spec, "Connect through an SSH server (bastion / jump host). Standalone mode only: Cluster and Sentinel hand out node addresses the tunnel cannot reach."); // WP-SSH

    private static Dictionary<string, string> When(string mode) => new() { ["mode"] = mode };

    public static ConnectionFormSpec Spec { get; } = new(
    [
        new FormField("mode", "Mode", "select", Default: JsonValue.Create("standalone"),
            Options: [new FormOption("standalone", "Standalone"), new FormOption("cluster", "Cluster"), new FormOption("sentinel", "Sentinel")]),
        new FormField("host", "Host", "text", Required: true, Placeholder: "localhost", VisibleWhen: When("standalone")),
        new FormField("port", "Port", "number", Default: JsonValue.Create(6379), VisibleWhen: When("standalone")),
        new FormField("nodes", "Cluster nodes", "list", Placeholder: "host1:6379,host2:6379", VisibleWhen: When("cluster")),
        new FormField("sentinels", "Sentinels", "list", Placeholder: "host1:26379,host2:26379", VisibleWhen: When("sentinel")),
        new FormField("serviceName", "Service name", "text", Default: JsonValue.Create("mymaster"), VisibleWhen: When("sentinel")),
        new FormField("user", "User", "text", Help: "ACL user (empty = default user)."),
        new FormField("password", "Password", "password"),
        new FormField("db", "Database", "number", Default: JsonValue.Create(0), Help: "Standalone and sentinel only."),
        new FormField("tls", "Use TLS", "bool", Default: JsonValue.Create(false)),
        new FormField("tlsSkipVerify", "Skip certificate verification", "bool", Default: JsonValue.Create(false)),
        new FormField("keyDelimiter", "Key delimiter", "text", Default: JsonValue.Create(":")),
        new FormField("scanCount", "SCAN count", "number", Default: JsonValue.Create(500)),
        new FormField("connectTimeout", "Connect timeout (s)", "number", Default: JsonValue.Create(5)),
    ]);

    public async Task<TestConnectionResult> TestAsync(ConnectionProfile profile, string? password, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await using var client = await ConnectAsync(profile, password, ct).ConfigureAwait(false);
            return new TestConnectionResult(true, client.Server, sw.ElapsedMilliseconds, null);
        }
        catch (EngineException ex)
        {
            return new TestConnectionResult(false, null, sw.ElapsedMilliseconds, new ErrorInfo(ex.Code, ex.Message));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new TestConnectionResult(false, null, sw.ElapsedMilliseconds, new ErrorInfo(ErrorCodes.SourceUnavailable, RedisErrors.Clean(ex.Message)));
        }
    }

    public async Task<IDataSourceClient> OpenAsync(ConnectionProfile profile, string? password, CancellationToken ct) =>
        await ConnectAsync(profile, password, ct).ConfigureAwait(false);

    /// <summary>Connects and reads the server facts; throws EngineException (VALIDATION / SOURCE_UNAVAILABLE / PRIVILEGE).</summary>
    public static async Task<RedisClient> ConnectAsync(ConnectionProfile profile, string? password, CancellationToken ct)
    {
        var settings = RedisSettings.From(profile, password);
        var options = settings.BuildConfiguration();
        var budget = Stopwatch.StartNew();
        ConnectionMultiplexer mux;
        try
        {
            mux = await ConnectionMultiplexer.ConnectAsync(options).WaitAsync(ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (RedisErrors.Map(ex) is { } mapped)
        {
            throw mapped;
        }
        try
        {
            if (!mux.IsConnected)
            {
                // AbortOnConnectFail=false: surface the reason now instead of on the first command. The connect above already
                // waited up to the connect timeout; only a short grace is added, so an unreachable host fails after about
                // one timeout, not two.
                var grace = TimeSpan.FromSeconds(settings.ConnectTimeoutSeconds) - budget.Elapsed;
                if (grace < TimeSpan.FromMilliseconds(500)) grace = TimeSpan.FromMilliseconds(500);
                try
                {
                    await RedisErrors.Guard(() => mux.GetDatabase().PingAsync().WaitAsync(grace, ct), "ping")
                        .ConfigureAwait(false);
                }
                catch (TimeoutException)
                {
                    throw EngineException.SourceUnavailable($"Could not connect to {settings.Describe()} within {settings.ConnectTimeoutSeconds} s.");
                }
            }
            var isCluster = mux.GetServers().Any(s => s.ServerType == ServerType.Cluster);
            var primary = mux.GetServers().FirstOrDefault(s => s.IsConnected && !s.IsReplica) ?? mux.GetServers().First();
            var info = await RedisErrors.Guard(() => primary.ExecuteAsync("INFO", "server"), "info").ConfigureAwait(false);
            var server = InfoParser.Parse(info.ToString() ?? "").GetValueOrDefault("server") ?? new Dictionary<string, string>();
            var versionText = server.GetValueOrDefault("redis_version");
            var version = RedisClient.ParseVersion(versionText);
            var databases = 16;
            if (isCluster) databases = 1;
            else
            {
                try
                {
                    var cfg = await primary.ExecuteAsync("CONFIG", "GET", "databases").ConfigureAwait(false);
                    var parts = (RedisResult[]?)cfg;
                    if (parts is { Length: >= 2 } && int.TryParse((string?)parts[1], out var n) && n > 0) databases = n;
                }
                catch (RedisServerException)
                {
                    // CONFIG may be renamed or denied by ACL (managed services): keep 16.
                }
            }
            // StackExchange.Redis carries on as the default user when AUTH is rejected and that user needs no password, so
            // a wrong ACL user or password would "connect" (and Test would say OK). Ask the server who we are.
            if (settings.User is not null && version >= new Version(6, 0))
            {
                string? who = null;
                try
                {
                    who = (string?)await primary.ExecuteAsync("ACL", "WHOAMI").ConfigureAwait(false);
                }
                catch (RedisServerException)
                {
                    // ACL denied or renamed: nothing to verify against
                }
                if (who is not null && !string.Equals(who, settings.User, StringComparison.Ordinal))
                    throw EngineException.SourceUnavailable($"Authentication failed: WRONGPASS invalid username-password pair or user '{settings.User}' is disabled (the server treats this connection as '{who}').");
            }
            var db = isCluster ? 0 : settings.Database;
            if (db >= databases)
                throw EngineException.Validation($"Database {db} does not exist (the server has {databases}).", new { field = "db" });
            var product = server.GetValueOrDefault("redis_mode") is { } m && m != "standalone" ? $"Redis {versionText} ({m})" : $"Redis {versionText}";
            var serverInfo = new ServerInfo(product, versionText, RedisClient.Format(primary.EndPoint), settings.User ?? "default",
                isCluster ? null : db.ToString(System.Globalization.CultureInfo.InvariantCulture));
            return new RedisClient(profile.Id, profile, settings, mux, serverInfo, version, isCluster, databases);
        }
        catch
        {
            await mux.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}
