using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Sources.Kafka.Deserializers;
using DbStudio.Sources.Kafka.Services;

namespace DbStudio.Sources.Kafka;

/// <summary>
/// The long-lived Kafka client of one connection profile (D2): the gateway (shared admin client, cached producers),
/// the Schema Registry client with its parsed-schema cache, and the librdkafka client log (<see cref="LogBuffer"/>, read by
/// the Logs view of package M2-L). Obtain it with <c>(KafkaClientHandle)await clients.GetAsync(cid, ct)</c>.
/// </summary>
public sealed class KafkaClientHandle : IDataSourceClient
{
    public KafkaClientHandle(string connectionId, ConnectionProfile profile, KafkaSettings settings, IKafkaGateway gateway,
        ISchemaRegistry? registry, KafkaLogBuffer log, ServerInfo server)
    {
        ConnectionId = connectionId;
        Profile = profile;
        Settings = settings;
        Gateway = gateway;
        Registry = registry;
        LogBuffer = log;
        Server = server;
        Codec = new MessageCodec(new SchemaCache(registry));
    }

    public string ConnectionId { get; }
    public ConnectionProfile Profile { get; }
    public KafkaSettings Settings { get; }
    public IKafkaGateway Gateway { get; }
    public ISchemaRegistry? Registry { get; }
    public MessageCodec Codec { get; }
    public SchemaCache Schemas => Codec.Schemas;

    /// <summary>librdkafka log / error callbacks of every client of this connection (M2-L reads it).</summary>
    public KafkaLogBuffer LogBuffer { get; }

    public ServerInfo Server { get; private set; }
    public DateTimeOffset LastUsed { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>When the broker version was last looked up lazily (see <see cref="TryResolveVersionAsync"/>).</summary>
    private long _versionTriedAt;

    /// <summary>
    /// The one-time broker-version lookup at open time has a 5 s budget; on a loaded or slow cluster it can end without an
    /// answer and <see cref="ServerInfo.ProductVersion"/> stays null. Try again, at most once a minute, whenever someone asks.
    /// </summary>
    public async Task TryResolveVersionAsync(KClusterInfo cluster, CancellationToken ct)
    {
        if (Server.ProductVersion is not null) return;
        var now = Environment.TickCount64;
        var last = Interlocked.Read(ref _versionTriedAt);
        if (last != 0 && now - last < 60_000) return;
        Interlocked.Exchange(ref _versionTriedAt, now);
        var version = await KafkaProvider.BrokerVersionAsync(Gateway, cluster, ct).ConfigureAwait(false);
        if (version is null) return;
        var text = Server.Version.StartsWith("Kafka (", StringComparison.Ordinal) ? $"Kafka {version} (" + Server.Version["Kafka (".Length..] : Server.Version;
        Server = Server with { Version = text, ProductVersion = version };
    }

    /// <summary>Fetch jobs currently running on this connection (Activity in the Logs view).</summary>
    public int ActiveFetches;

    /// <summary>403 READ_ONLY naming the action (docs/PLAN-M2.md 2.2: no produce/create/delete/offset reset).</summary>
    public void EnsureWritable(string action)
    {
        if (Profile.ReadOnly) throw EngineException.ReadOnly(Profile.Name, action);
    }

    public async Task<bool> PingAsync(CancellationToken ct)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            await Gateway.DescribeClusterAsync(timeout.Token).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is KafkaGatewayException or OperationCanceledException)
        {
            return false;
        }
    }

    public ValueTask DisposeAsync()
    {
        Gateway.Dispose();
        (Registry as IDisposable)?.Dispose();
        return ValueTask.CompletedTask;
    }
}
