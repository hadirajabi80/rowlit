using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the Snowflake monitor (golden-tested).</summary>
public static class SnowflakeMonitorSql
{
    public const string Version = "SELECT CURRENT_VERSION() AS VERSION";

    public const string Warehouses = "SHOW WAREHOUSES";

    /// <summary>Statements that ended in the last five minutes (needs a current database for the table function).</summary>
    public const string Recent = """
        SELECT COUNT(*) AS TOTAL,
               COUNT_IF(EXECUTION_STATUS LIKE 'FAILED%') AS FAILED,
               AVG(TOTAL_ELAPSED_TIME) AS AVG_ELAPSED_MS
        FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(END_TIME_RANGE_START => DATEADD('minute', -5, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
        """;

    public const string Needs = "GRANT MONITOR ON WAREHOUSE <warehouse> TO ROLE <role>;";
}

/// <summary>
/// Snowflake has no server counters: the tiles show warehouse load (SHOW WAREHOUSES: running and queued statements) and the
/// last five minutes of QUERY_HISTORY. Everything is a gauge.
/// </summary>
public sealed class SnowflakeMetricsReader(ISqlRunnerFactory runners) : IMetricsReader
{
    public string ProviderId => "snowflake";

    private static readonly TileDef Running = TileDef.G("sessions.active", "Running statements", Count, Sessions), Queued = TileDef.G("sessions.blocked", "Queued statements", Count, Sessions),
        Started = TileDef.G("warehouses.started", "Warehouses started", Count, Sessions), Clusters = TileDef.G("warehouses.clusters", "Clusters started", Count, Sessions),
        Recent = TileDef.G("queries.recent", "Statements (last 5 min)", Count, Throughput), Failed = TileDef.G("queries.failed", "Failed (last 5 min)", Count, Throughput),
        Avg = TileDef.G("queries.avgMs", "Average duration (last 5 min)", Millis, Throughput);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        bag.Version = MetricsQueries.FirstText(await MetricsQueries.TryAsync(runner, SnowflakeMonitorSql.Version, bag, "Version", null, ct).ConfigureAwait(false), "VERSION");

        var wh = await MetricsQueries.TryAsync(runner, SnowflakeMonitorSql.Warehouses, bag, "Warehouses", SnowflakeMonitorSql.Needs, ct, Running, Queued, Started, Clusters).ConfigureAwait(false);
        if (wh is not null) ApplyWarehouses(bag, wh);

        var recent = await MetricsQueries.TryAsync(runner, SnowflakeMonitorSql.Recent, bag, "Query history", SnowflakeMonitorSql.Needs, ct, Recent, Failed, Avg).ConfigureAwait(false);
        if (recent is { Rows.Count: > 0 })
        {
            var r = recent.Rows[0];
            bag.Gauge(Recent.Id, Recent.Label, recent.Double(r, "TOTAL"), Count, Throughput);
            bag.Gauge(Failed.Id, Failed.Label, recent.Double(r, "FAILED"), Count, Throughput);
            bag.Gauge(Avg.Id, Avg.Label, recent.Double(r, "AVG_ELAPSED_MS") is { } a ? Math.Round(a) : null, Millis, Throughput);
        }
        return MetricsQueries.Build(ProviderId, bag);
    }

    public static void ApplyWarehouses(MetricBag bag, SqlRowSet wh)
    {
        double running = 0, queued = 0, clusters = 0;
        var started = 0;
        foreach (var r in wh.Rows)
        {
            running += wh.Double(r, "running") ?? 0;
            queued += wh.Double(r, "queued") ?? 0;
            clusters += wh.Double(r, "started_clusters") ?? 0;
            if ((wh.Str(r, "state") ?? "").StartsWith("STARTED", StringComparison.OrdinalIgnoreCase) || (wh.Str(r, "state") ?? "").StartsWith("RESIZING", StringComparison.OrdinalIgnoreCase)) started++;
        }
        bag.Gauge(Running.Id, Running.Label, running, Count, Sessions);
        bag.Gauge(Queued.Id, Queued.Label, queued, Count, Sessions);
        bag.Gauge(Started.Id, Started.Label, started, Count, Sessions);
        bag.Gauge(Clusters.Id, Clusters.Label, clusters, Count, Sessions);
    }
}
