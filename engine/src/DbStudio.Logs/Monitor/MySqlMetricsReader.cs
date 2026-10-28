using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the MySQL / MariaDB monitor (golden-tested).</summary>
public static class MySqlMonitorSql
{
    public const string Status =
        "SHOW GLOBAL STATUS WHERE Variable_name IN ('Questions', 'Com_commit', 'Com_rollback', 'Slow_queries', 'Threads_connected', 'Threads_running', " +
        "'Uptime', 'Aborted_connects', 'Bytes_received', 'Bytes_sent', 'Innodb_buffer_pool_reads', 'Innodb_buffer_pool_read_requests', " +
        "'Innodb_rows_read', 'Innodb_rows_inserted', 'Innodb_rows_updated', 'Innodb_rows_deleted')";

    public const string Variables = "SELECT @@max_connections AS max_connections, @@version AS version";

    public const string Blocked = "SELECT COUNT(*) AS blocked FROM information_schema.INNODB_TRX WHERE trx_state = 'LOCK WAIT'";

    public const string Sizes = """
        SELECT table_schema AS name, SUM(COALESCE(data_length, 0) + COALESCE(index_length, 0)) AS size_bytes
        FROM information_schema.tables
        GROUP BY table_schema
        ORDER BY 2 DESC
        LIMIT 20
        """;

    public const string Needs = "GRANT PROCESS ON *.* TO '<user>'@'%';";
}

/// <summary>MySQL and MariaDB: SHOW GLOBAL STATUS / VARIABLES, INNODB_TRX, information_schema.tables.</summary>
public sealed class MySqlMetricsReader(ISqlRunnerFactory runners, string providerId = "mysql") : IMetricsReader
{
    public string ProviderId => providerId;

    private static readonly TileDef Total = TileDef.G("sessions.total", "Connections", Count, Sessions), Active = TileDef.G("sessions.active", "Running threads", Count, Sessions),
        Blocked = TileDef.G("sessions.blocked", "Waiting for a lock", Count, Sessions), Max = TileDef.G("connections.max", "Max connections", Count, Sessions),
        Queries = TileDef.C("queries", "Queries", Count, Throughput), Xacts = TileDef.C("transactions", "Transactions", Count, Throughput),
        Slow = TileDef.C("slowQueries", "Slow queries", Count, Throughput), RowsRead = TileDef.C("rows.read", "InnoDB rows read", Count, Throughput),
        RowsWritten = TileDef.C("rows.written", "InnoDB rows written", Count, Throughput), Cache = TileDef.G("cache.hitRatio", "Buffer pool hit ratio (since start)", Percent, Memory),
        In = TileDef.C("net.in", "Network in", Bytes, Io), Out = TileDef.C("net.out", "Network out", Bytes, Io), Aborted = TileDef.C("aborted", "Aborted connects", Count, Io),
        Uptime = TileDef.G("uptime", "Uptime", Seconds, Server);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        var vars = await MetricsQueries.TryAsync(runner, MySqlMonitorSql.Variables, bag, "Server variables", null, ct, Max).ConfigureAwait(false);
        if (vars is { Rows.Count: > 0 })
        {
            bag.Version = vars.Str(vars.Rows[0], "version");
            bag.Gauge(Max.Id, Max.Label, vars.Double(vars.Rows[0], "max_connections"), Count, Sessions);
        }

        var status = await MetricsQueries.TryAsync(runner, MySqlMonitorSql.Status, bag, "Global status", MySqlMonitorSql.Needs, ct,
            Total, Active, Queries, Xacts, Slow, RowsRead, RowsWritten, Cache, In, Out, Aborted, Uptime).ConfigureAwait(false);
        if (status is not null) ApplyStatus(bag, MetricsQueries.NameValue(status, "Variable_name", "Value"));

        var blocked = await MetricsQueries.TryAsync(runner, MySqlMonitorSql.Blocked, bag, "Lock waits", MySqlMonitorSql.Needs, ct, Blocked).ConfigureAwait(false);
        if (blocked is { Rows.Count: > 0 }) bag.Gauge(Blocked.Id, Blocked.Label, MetricsQueries.First(blocked, "blocked"), Count, Sessions);

        MetricsQueries.AddSizes(bag, await MetricsQueries.TryAsync(runner, MySqlMonitorSql.Sizes, bag, "Database sizes", null, ct).ConfigureAwait(false));
        return MetricsQueries.Build(ProviderId, bag);
    }

    public static void ApplyStatus(MetricBag bag, Dictionary<string, double> s)
    {
        void C(TileDef t, double? v) { if (v is { } x) bag.Counter(t.Id, t.Label, x, t.Unit, t.Group); }
        bag.Gauge(Total.Id, Total.Label, MetricsQueries.Get(s, "Threads_connected"), Count, Sessions);
        // Threads_running includes the monitor's own statement
        bag.Gauge(Active.Id, Active.Label, MetricsQueries.Get(s, "Threads_running") is { } run ? Math.Max(0, run - 1) : null, Count, Sessions);
        C(Queries, MetricsQueries.Get(s, "Questions"));
        C(Xacts, MetricsQueries.Sum(s, "Com_commit", "Com_rollback"));
        C(Slow, MetricsQueries.Get(s, "Slow_queries"));
        C(RowsRead, MetricsQueries.Get(s, "Innodb_rows_read"));
        C(RowsWritten, MetricsQueries.Sum(s, "Innodb_rows_inserted", "Innodb_rows_updated", "Innodb_rows_deleted"));
        C(In, MetricsQueries.Get(s, "Bytes_received"));
        C(Out, MetricsQueries.Get(s, "Bytes_sent"));
        C(Aborted, MetricsQueries.Get(s, "Aborted_connects"));
        if (MetricsQueries.Get(s, "Innodb_buffer_pool_read_requests") is { } req && MetricsQueries.Get(s, "Innodb_buffer_pool_reads") is { } miss && req > 0)
            bag.Gauge(Cache.Id, Cache.Label, Math.Round((1 - miss / req) * 100, 2), Percent, Memory);
        bag.Gauge(Uptime.Id, Uptime.Label, MetricsQueries.Get(s, "Uptime"), Seconds, Server);
    }
}
