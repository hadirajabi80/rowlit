using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the ClickHouse monitor (golden-tested).</summary>
public static class ClickHouseMonitorSql
{
    public const string Version = "SELECT version() AS version";

    public const string Metrics =
        "SELECT metric AS name, value FROM system.metrics WHERE metric IN ('Query', 'TCPConnection', 'HTTPConnection', 'MySQLConnection', " +
        "'PostgreSQLConnection', 'MemoryTracking', 'Merge', 'BackgroundMergesAndMutationsPoolTask', 'ReplicatedFetch')";

    public const string Events =
        "SELECT event AS name, value FROM system.events WHERE event IN ('Query', 'SelectQuery', 'InsertQuery', 'FailedQuery', 'InsertedRows', " +
        "'SelectedRows', 'InsertedBytes', 'SelectedBytes', 'MergedRows', 'MarkCacheHits', 'MarkCacheMisses')";

    public const string Uptime = "SELECT value FROM system.asynchronous_metrics WHERE metric = 'Uptime'";

    public const string Sizes = """
        SELECT database AS name, sum(bytes_on_disk) AS size_bytes
        FROM system.parts
        WHERE active
        GROUP BY database
        ORDER BY size_bytes DESC
        LIMIT 20
        """;

    public const string Needs = "GRANT SELECT ON system.* TO <user>;";
}

/// <summary>ClickHouse: system.metrics (levels), system.events (cumulative counters), system.asynchronous_metrics, system.parts.</summary>
public sealed class ClickHouseMetricsReader(ISqlRunnerFactory runners) : IMetricsReader
{
    public string ProviderId => "clickhouse";

    private static readonly TileDef Active = TileDef.G("sessions.active", "Running queries", Count, Sessions), Total = TileDef.G("sessions.total", "Connections", Count, Sessions),
        Queries = TileDef.C("queries", "Queries", Count, Throughput), Selects = TileDef.C("queries.select", "SELECT queries", Count, Throughput),
        Inserts = TileDef.C("queries.insert", "INSERT queries", Count, Throughput), Failed = TileDef.C("queries.failed", "Failed queries", Count, Throughput),
        Inserted = TileDef.C("rows.written", "Rows inserted", Count, Throughput), Selected = TileDef.C("rows.read", "Rows read", Count, Throughput),
        Merges = TileDef.G("merges.running", "Running merges", Count, Io), MergeQueue = TileDef.G("merges.pool", "Merge / mutation tasks", Count, Io),
        Merged = TileDef.C("rows.merged", "Rows merged", Count, Io), Fetches = TileDef.G("replication.fetches", "Replicated fetches", Count, Io),
        Mem = TileDef.G("memory.tracked", "Tracked memory", Bytes, Memory), Cache = TileDef.G("cache.hitRatio", "Mark cache hit ratio (since start)", Percent, Memory),
        Uptime = TileDef.G("uptime", "Uptime", Seconds, Server);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        bag.Version = MetricsQueries.FirstText(await MetricsQueries.TryAsync(runner, ClickHouseMonitorSql.Version, bag, "Version", null, ct).ConfigureAwait(false), "version");

        var metrics = await MetricsQueries.TryAsync(runner, ClickHouseMonitorSql.Metrics, bag, "system.metrics", ClickHouseMonitorSql.Needs, ct, Active, Total, Merges, MergeQueue, Fetches, Mem).ConfigureAwait(false);
        if (metrics is not null)
        {
            var m = MetricsQueries.NameValue(metrics, "name", "value");
            bag.Gauge(Active.Id, Active.Label, MetricsQueries.Get(m, "Query") is { } q ? Math.Max(0, q - 1) : null, Count, Sessions); // minus the monitor's own query
            bag.Gauge(Total.Id, Total.Label, MetricsQueries.Sum(m, "TCPConnection", "HTTPConnection", "MySQLConnection", "PostgreSQLConnection"), Count, Sessions);
            bag.Gauge(Merges.Id, Merges.Label, MetricsQueries.Get(m, "Merge"), Count, Io);
            bag.Gauge(MergeQueue.Id, MergeQueue.Label, MetricsQueries.Get(m, "BackgroundMergesAndMutationsPoolTask"), Count, Io);
            bag.Gauge(Fetches.Id, Fetches.Label, MetricsQueries.Get(m, "ReplicatedFetch"), Count, Io);
            bag.Gauge(Mem.Id, Mem.Label, MetricsQueries.Get(m, "MemoryTracking"), Bytes, Memory);
        }

        var events = await MetricsQueries.TryAsync(runner, ClickHouseMonitorSql.Events, bag, "system.events", ClickHouseMonitorSql.Needs, ct,
            Queries, Selects, Inserts, Failed, Inserted, Selected, Merged, Cache).ConfigureAwait(false);
        if (events is not null) ApplyEvents(bag, MetricsQueries.NameValue(events, "name", "value"));

        var up = await MetricsQueries.TryAsync(runner, ClickHouseMonitorSql.Uptime, bag, "Uptime", null, ct, Uptime).ConfigureAwait(false);
        if (up is not null) bag.Gauge(Uptime.Id, Uptime.Label, MetricsQueries.First(up, "value"), Seconds, Server);

        MetricsQueries.AddSizes(bag, await MetricsQueries.TryAsync(runner, ClickHouseMonitorSql.Sizes, bag, "Database sizes", ClickHouseMonitorSql.Needs, ct).ConfigureAwait(false));
        return MetricsQueries.Build(ProviderId, bag);
    }

    public static void ApplyEvents(MetricBag bag, Dictionary<string, double> e)
    {
        void C(TileDef t, double? v) { if (v is { } x) bag.Counter(t.Id, t.Label, x, t.Unit, t.Group); }
        C(Queries, MetricsQueries.Get(e, "Query"));
        C(Selects, MetricsQueries.Get(e, "SelectQuery"));
        C(Inserts, MetricsQueries.Get(e, "InsertQuery"));
        C(Failed, MetricsQueries.Get(e, "FailedQuery"));
        C(Inserted, MetricsQueries.Get(e, "InsertedRows"));
        C(Selected, MetricsQueries.Get(e, "SelectedRows"));
        C(Merged, MetricsQueries.Get(e, "MergedRows"));
        if (MetricBag.Ratio(MetricsQueries.Get(e, "MarkCacheHits"), MetricsQueries.Get(e, "MarkCacheMisses")) is { } ratio)
            bag.Gauge(Cache.Id, Cache.Label, ratio, Percent, Memory);
    }
}
