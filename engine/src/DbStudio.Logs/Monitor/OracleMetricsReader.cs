using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the Oracle monitor (golden-tested). No trailing semicolons: the driver rejects them.</summary>
public static class OracleMonitorSql
{
    public const string Instance = """
        SELECT version, instance_name, (SYSDATE - startup_time) * 86400 AS uptime_s FROM v$instance
        """;

    public const string Sessions = """
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
               SUM(CASE WHEN blocking_session IS NOT NULL THEN 1 ELSE 0 END) AS blocked
        FROM v$session WHERE type = 'USER'
        """;

    public const string MaxSessions = "SELECT TO_NUMBER(value) AS max_sessions FROM v$parameter WHERE name = 'sessions'";

    public const string Stats =
        "SELECT name, value FROM v$sysstat WHERE name IN ('user commits', 'user rollbacks', 'execute count', 'user calls', 'parse count (total)', " +
        "'physical reads', 'physical writes', 'db block gets', 'consistent gets', 'redo size')";

    public const string Sizes = """
        SELECT tablespace_name AS name, SUM(bytes) AS size_bytes
        FROM dba_data_files
        GROUP BY tablespace_name
        ORDER BY 2 DESC
        FETCH FIRST 20 ROWS ONLY
        """;

    public const string Needs = "GRANT SELECT ANY DICTIONARY TO <user>;";
}

/// <summary>Oracle: v$instance, v$session, v$sysstat, v$parameter, dba_data_files.</summary>
public sealed class OracleMetricsReader(ISqlRunnerFactory runners) : IMetricsReader
{
    public string ProviderId => "oracle";

    private static readonly TileDef Total = TileDef.G("sessions.total", "User sessions", Count, Sessions), Active = TileDef.G("sessions.active", "Active", Count, Sessions),
        Blocked = TileDef.G("sessions.blocked", "Blocked", Count, Sessions), Max = TileDef.G("connections.max", "Max sessions", Count, Sessions),
        Xacts = TileDef.C("transactions", "Transactions (commits + rollbacks)", Count, Throughput), Execs = TileDef.C("queries", "Executions", Count, Throughput),
        Calls = TileDef.C("calls", "User calls", Count, Throughput), Parses = TileDef.C("parses", "Parses", Count, Throughput),
        Cache = TileDef.G("cache.hitRatio", "Buffer cache hit ratio (since start)", Percent, Memory), Reads = TileDef.C("physical.reads", "Physical reads", Count, Io),
        Writes = TileDef.C("physical.writes", "Physical writes", Count, Io), Redo = TileDef.C("redo.bytes", "Redo generated", Bytes, Io),
        Uptime = TileDef.G("uptime", "Uptime", Seconds, Server);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        var inst = await MetricsQueries.TryAsync(runner, OracleMonitorSql.Instance, bag, "Instance", OracleMonitorSql.Needs, ct, Uptime).ConfigureAwait(false);
        if (inst is { Rows.Count: > 0 })
        {
            bag.Version = inst.Str(inst.Rows[0], "version");
            bag.Gauge(Uptime.Id, Uptime.Label, Math.Floor(inst.Double(inst.Rows[0], "uptime_s") ?? 0), Seconds, Server);
        }

        var sessions = await MetricsQueries.TryAsync(runner, OracleMonitorSql.Sessions, bag, "Sessions", OracleMonitorSql.Needs, ct, Total, Active, Blocked).ConfigureAwait(false);
        if (sessions is { Rows.Count: > 0 })
        {
            var r = sessions.Rows[0];
            bag.Gauge(Total.Id, Total.Label, sessions.Double(r, "total"), Count, Sessions);
            bag.Gauge(Active.Id, Active.Label, sessions.Double(r, "active") is { } a ? Math.Max(0, a - 1) : null, Count, Sessions); // minus the monitor's own
            bag.Gauge(Blocked.Id, Blocked.Label, sessions.Double(r, "blocked") ?? 0, Count, Sessions);
        }

        var max = await MetricsQueries.TryAsync(runner, OracleMonitorSql.MaxSessions, bag, "Session limit", OracleMonitorSql.Needs, ct, Max).ConfigureAwait(false);
        if (max is not null) bag.Gauge(Max.Id, Max.Label, MetricsQueries.First(max, "max_sessions"), Count, Sessions);

        var stats = await MetricsQueries.TryAsync(runner, OracleMonitorSql.Stats, bag, "v$sysstat", OracleMonitorSql.Needs, ct, Xacts, Execs, Calls, Parses, Cache, Reads, Writes, Redo).ConfigureAwait(false);
        if (stats is not null) ApplyStats(bag, MetricsQueries.NameValue(stats, "name", "value"));

        MetricsQueries.AddSizes(bag, await MetricsQueries.TryAsync(runner, OracleMonitorSql.Sizes, bag, "Tablespace sizes", OracleMonitorSql.Needs, ct).ConfigureAwait(false));
        return MetricsQueries.Build(ProviderId, bag);
    }

    public static void ApplyStats(MetricBag bag, Dictionary<string, double> s)
    {
        void C(TileDef t, double? v) { if (v is { } x) bag.Counter(t.Id, t.Label, x, t.Unit, t.Group); }
        C(Xacts, MetricsQueries.Sum(s, "user commits", "user rollbacks"));
        C(Execs, MetricsQueries.Get(s, "execute count"));
        C(Calls, MetricsQueries.Get(s, "user calls"));
        C(Parses, MetricsQueries.Get(s, "parse count (total)"));
        C(Reads, MetricsQueries.Get(s, "physical reads"));
        C(Writes, MetricsQueries.Get(s, "physical writes"));
        C(Redo, MetricsQueries.Get(s, "redo size"));
        var logical = MetricsQueries.Sum(s, "db block gets", "consistent gets");
        if (logical is > 0 && MetricsQueries.Get(s, "physical reads") is { } phys)
            bag.Gauge(Cache.Id, Cache.Label, Math.Round(Math.Max(0, 1 - phys / logical.Value) * 100, 2), Percent, Memory);
    }
}
