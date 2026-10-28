using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the SQL Server monitor (golden-tested).</summary>
public static class SqlServerMonitorSql
{
    /// <summary>No DMV needed: product version, the connection limit and the start time (tempdb is recreated at every start).</summary>
    public const string Server = """
        SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(50)) AS product_version,
               CAST(SERVERPROPERTY('Edition') AS nvarchar(100)) AS edition,
               @@MAX_CONNECTIONS AS max_connections,
               (SELECT DATEDIFF(SECOND, create_date, SYSDATETIME()) FROM sys.databases WHERE name = 'tempdb') AS uptime_s
        """;

    public const string Sessions = """
        SELECT (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS total,
               (SELECT COUNT(*) FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
                 WHERE s.is_user_process = 1 AND r.session_id <> @@SPID) AS active,
               (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id > 0) AS blocked
        """;

    /// <summary>The "/sec" counters are cumulative values (rates are taken between two snapshots); the ratio needs its base counter.</summary>
    public const string Counters = """
        SELECT RTRIM(object_name) AS object_name, RTRIM(counter_name) AS counter_name, RTRIM(instance_name) AS instance_name, cntr_value
        FROM sys.dm_os_performance_counters
        WHERE (object_name LIKE '%:SQL Statistics%' AND counter_name IN ('Batch Requests/sec', 'SQL Compilations/sec', 'SQL Re-Compilations/sec'))
           OR (object_name LIKE '%:Buffer Manager%' AND counter_name IN ('Page life expectancy', 'Buffer cache hit ratio', 'Buffer cache hit ratio base', 'Page reads/sec', 'Page writes/sec'))
           OR (object_name LIKE '%:General Statistics%' AND counter_name = 'User Connections')
           OR (object_name LIKE '%:Databases%' AND counter_name = 'Transactions/sec' AND instance_name = '_Total')
           OR (object_name LIKE '%:Locks%' AND counter_name = 'Number of Deadlocks/sec' AND instance_name = '_Total')
           OR (object_name LIKE '%:Memory Manager%' AND counter_name IN ('Total Server Memory (KB)', 'Target Server Memory (KB)'))
        """;

    public const string Sizes = """
        SELECT TOP 20 DB_NAME(database_id) AS name, SUM(CAST(size AS bigint)) * 8192 AS size_bytes
        FROM sys.master_files
        GROUP BY database_id
        ORDER BY 2 DESC
        """;

    public const string Needs = "GRANT VIEW SERVER STATE TO <login>;";
}

/// <summary>SQL Server / Azure SQL: sys.dm_os_performance_counters, dm_exec_sessions / dm_exec_requests, master_files.</summary>
public sealed class SqlServerMetricsReader(ISqlRunnerFactory runners) : IMetricsReader
{
    public string ProviderId => "sqlserver";

    private static readonly TileDef Total = TileDef.G("sessions.total", "Sessions", Count, Sessions), Active = TileDef.G("sessions.active", "Active requests", Count, Sessions),
        Blocked = TileDef.G("sessions.blocked", "Blocked", Count, Sessions), Max = TileDef.G("connections.max", "Max connections", Count, Sessions),
        Batches = TileDef.C("queries", "Batch requests", Count, Throughput), Xacts = TileDef.C("transactions", "Transactions", Count, Throughput),
        Compiles = TileDef.C("compilations", "Compilations", Count, Throughput), Recompiles = TileDef.C("recompilations", "Re-compilations", Count, Throughput),
        Deadlocks = TileDef.C("deadlocks", "Deadlocks", Count, Throughput), Ple = TileDef.G("memory.pageLifeExpectancy", "Page life expectancy", Seconds, Memory),
        Cache = TileDef.G("cache.hitRatio", "Buffer cache hit ratio", Percent, Memory), Used = TileDef.G("memory.server", "Server memory", Bytes, Memory),
        Target = TileDef.G("memory.target", "Target server memory", Bytes, Memory), Reads = TileDef.C("pages.read", "Page reads", Count, Io),
        Writes = TileDef.C("pages.written", "Page writes", Count, Io), Uptime = TileDef.G("uptime", "Uptime", Seconds, Server);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        var server = await MetricsQueries.TryAsync(runner, SqlServerMonitorSql.Server, bag, "Server information", null, ct, Max, Uptime).ConfigureAwait(false);
        if (server is { Rows.Count: > 0 })
        {
            var r = server.Rows[0];
            bag.Version = $"{server.Str(r, "edition")} {server.Str(r, "product_version")}".Trim();
            bag.Gauge(Max.Id, Max.Label, server.Double(r, "max_connections"), Count, Sessions);
            bag.Gauge(Uptime.Id, Uptime.Label, server.Double(r, "uptime_s"), Seconds, Server);
        }

        var sessions = await MetricsQueries.TryAsync(runner, SqlServerMonitorSql.Sessions, bag, "Sessions", SqlServerMonitorSql.Needs, ct, Total, Active, Blocked).ConfigureAwait(false);
        if (sessions is { Rows.Count: > 0 })
        {
            var r = sessions.Rows[0];
            bag.Gauge(Total.Id, Total.Label, sessions.Double(r, "total"), Count, Sessions);
            bag.Gauge(Active.Id, Active.Label, sessions.Double(r, "active"), Count, Sessions);
            bag.Gauge(Blocked.Id, Blocked.Label, sessions.Double(r, "blocked"), Count, Sessions);
        }

        var counters = await MetricsQueries.TryAsync(runner, SqlServerMonitorSql.Counters, bag, "Performance counters", SqlServerMonitorSql.Needs, ct,
            Batches, Xacts, Compiles, Recompiles, Deadlocks, Ple, Cache, Used, Target, Reads, Writes).ConfigureAwait(false);
        if (counters is not null) ApplyCounters(bag, counters);

        MetricsQueries.AddSizes(bag, await MetricsQueries.TryAsync(runner, SqlServerMonitorSql.Sizes, bag, "Database sizes", SqlServerMonitorSql.Needs, ct).ConfigureAwait(false));
        return MetricsQueries.Build(ProviderId, bag);
    }

    /// <summary>Maps the performance-counter rows ("SQLServer:Buffer Manager" / "Page life expectancy") onto tiles.</summary>
    public static void ApplyCounters(MetricBag bag, SqlRowSet rows)
    {
        var map = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows.Rows)
        {
            var obj = rows.Str(r, "object_name") ?? "";
            var group = obj[(obj.LastIndexOf(':') + 1)..].Trim();
            if (rows.Str(r, "counter_name") is { } name && rows.Double(r, "cntr_value") is { } v) map[$"{group}|{name.Trim()}"] = v;
        }
        double? G(string key) => map.TryGetValue(key, out var v) ? v : null;
        void C(TileDef t, string key) { if (G(key) is { } v) bag.Counter(t.Id, t.Label, v, t.Unit, t.Group); }
        C(Batches, "SQL Statistics|Batch Requests/sec");
        C(Compiles, "SQL Statistics|SQL Compilations/sec");
        C(Recompiles, "SQL Statistics|SQL Re-Compilations/sec");
        C(Xacts, "Databases|Transactions/sec");
        C(Deadlocks, "Locks|Number of Deadlocks/sec");
        C(Reads, "Buffer Manager|Page reads/sec");
        C(Writes, "Buffer Manager|Page writes/sec");
        if (G("Buffer Manager|Page life expectancy") is { } ple) bag.Gauge(Ple.Id, Ple.Label, ple, Seconds, Memory);
        if (G("Buffer Manager|Buffer cache hit ratio") is { } hit && G("Buffer Manager|Buffer cache hit ratio base") is { } bas && bas > 0)
            bag.Gauge(Cache.Id, Cache.Label, Math.Round(hit / bas * 100, 2), Percent, Memory);
        if (G("Memory Manager|Total Server Memory (KB)") is { } used) bag.Gauge(Used.Id, Used.Label, used * 1024, Bytes, Memory);
        if (G("Memory Manager|Target Server Memory (KB)") is { } tgt) bag.Gauge(Target.Id, Target.Label, tgt * 1024, Bytes, Memory);
    }
}
