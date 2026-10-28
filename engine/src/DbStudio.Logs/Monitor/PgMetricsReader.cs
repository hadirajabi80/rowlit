using DbStudio.Logs.Sql;
using static DbStudio.Logs.Monitor.MetricGroups;
using static DbStudio.Logs.Monitor.MetricUnits;

namespace DbStudio.Logs.Monitor;

/// <summary>The SQL of the PostgreSQL monitor (golden-tested).</summary>
public static class PgMonitorSql
{
    public const string Server = """
        SELECT version() AS version,
               current_setting('max_connections')::int AS max_connections,
               floor(extract(epoch FROM now() - pg_postmaster_start_time()))::bigint AS uptime_s,
               pg_is_in_recovery() AS in_recovery,
               CASE WHEN pg_is_in_recovery() THEN extract(epoch FROM now() - pg_last_xact_replay_timestamp()) END AS replay_lag_s
        """;

    public const string Sessions = """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE state = 'active') AS active,
               count(*) FILTER (WHERE wait_event_type = 'Lock') AS blocked,
               count(*) FILTER (WHERE state LIKE 'idle in transaction%') AS idle_in_tx
        FROM pg_stat_activity
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        """;

    public const string Database = """
        SELECT COALESCE(sum(xact_commit + xact_rollback), 0) AS xacts,
               COALESCE(sum(blks_hit), 0) AS blks_hit,
               COALESCE(sum(blks_read), 0) AS blks_read,
               COALESCE(sum(tup_returned + tup_fetched), 0) AS tup_read,
               COALESCE(sum(tup_inserted + tup_updated + tup_deleted), 0) AS tup_written,
               COALESCE(sum(deadlocks), 0) AS deadlocks,
               COALESCE(sum(temp_bytes), 0) AS temp_bytes
        FROM pg_stat_database
        """;

    public const string Sizes = """
        SELECT datname AS name, pg_database_size(datname) AS size_bytes
        FROM pg_database
        WHERE NOT datistemplate AND datallowconn
        ORDER BY 2 DESC
        LIMIT 20
        """;

    /// <summary>PostgreSQL 17 moved the checkpoint counters out of pg_stat_bgwriter.</summary>
    public const string Checkpointer = "SELECT num_timed + num_requested AS checkpoints FROM pg_stat_checkpointer";
    public const string Bgwriter = "SELECT checkpoints_timed + checkpoints_req AS checkpoints FROM pg_stat_bgwriter";

    public const string Replication = """
        SELECT count(*) AS replicas, COALESCE(max(extract(epoch FROM replay_lag)), 0) AS max_lag_s
        FROM pg_stat_replication
        """;

    public const string Needs = "GRANT pg_monitor TO <login>;";
}

/// <summary>PostgreSQL: pg_stat_activity, pg_stat_database, pg_stat_bgwriter / pg_stat_checkpointer, pg_stat_replication.</summary>
public sealed class PgMetricsReader(ISqlRunnerFactory runners) : IMetricsReader
{
    public string ProviderId => "postgresql";

    private static readonly TileDef Total = TileDef.G("sessions.total", "Sessions", Count, Sessions), Active = TileDef.G("sessions.active", "Active", Count, Sessions),
        Blocked = TileDef.G("sessions.blocked", "Blocked", Count, Sessions), IdleTx = TileDef.G("sessions.idleInTx", "Idle in transaction", Count, Sessions),
        Max = TileDef.G("connections.max", "Max connections", Count, Sessions),
        Xacts = TileDef.C("transactions", "Transactions", Count, Throughput), Read = TileDef.C("rows.read", "Rows read", Count, Throughput),
        Written = TileDef.C("rows.written", "Rows written", Count, Throughput), Deadlocks = TileDef.C("deadlocks", "Deadlocks", Count, Throughput),
        Cache = TileDef.G("cache.hitRatio", "Cache hit ratio (since stats reset)", Percent, Memory), Temp = TileDef.C("temp.bytes", "Temp files written", Bytes, Io),
        Checkpoints = TileDef.C("checkpoints", "Checkpoints", Count, Io), Uptime = TileDef.G("uptime", "Uptime", Seconds, Server);

    public async Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct)
    {
        var runner = await runners.GetAsync(target, ct).ConfigureAwait(false);
        var bag = new MetricBag();
        var server = await MetricsQueries.TryAsync(runner, PgMonitorSql.Server, bag, "Server information", null, ct, Max, Uptime).ConfigureAwait(false);
        var inRecovery = false;
        if (server is { Rows.Count: > 0 })
        {
            var r = server.Rows[0];
            bag.Version = server.Str(r, "version");
            bag.Gauge(Max.Id, Max.Label, server.Double(r, "max_connections"), Count, Sessions);
            bag.Gauge(Uptime.Id, Uptime.Label, server.Double(r, "uptime_s"), Seconds, Server);
            inRecovery = server.Bool(r, "in_recovery");
            if (inRecovery && server.Double(r, "replay_lag_s") is { } lag)
                bag.Gauge("replication.lagSeconds", "Replay lag", Math.Max(0, lag), Seconds, Server);
        }

        var sessions = await MetricsQueries.TryAsync(runner, PgMonitorSql.Sessions, bag, "Sessions", PgMonitorSql.Needs, ct, Total, Active, Blocked, IdleTx).ConfigureAwait(false);
        if (sessions is { Rows.Count: > 0 })
        {
            var r = sessions.Rows[0];
            bag.Gauge(Total.Id, Total.Label, sessions.Double(r, "total"), Count, Sessions);
            bag.Gauge(Active.Id, Active.Label, sessions.Double(r, "active"), Count, Sessions);
            bag.Gauge(Blocked.Id, Blocked.Label, sessions.Double(r, "blocked"), Count, Sessions);
            bag.Gauge(IdleTx.Id, IdleTx.Label, sessions.Double(r, "idle_in_tx"), Count, Sessions);
        }

        var db = await MetricsQueries.TryAsync(runner, PgMonitorSql.Database, bag, "Database statistics", PgMonitorSql.Needs, ct, Xacts, Read, Written, Deadlocks, Cache, Temp).ConfigureAwait(false);
        if (db is { Rows.Count: > 0 })
        {
            var r = db.Rows[0];
            bag.Counter(Xacts.Id, Xacts.Label, db.Double(r, "xacts"), Count, Throughput);
            bag.Counter(Read.Id, Read.Label, db.Double(r, "tup_read"), Count, Throughput);
            bag.Counter(Written.Id, Written.Label, db.Double(r, "tup_written"), Count, Throughput);
            bag.Counter(Deadlocks.Id, Deadlocks.Label, db.Double(r, "deadlocks"), Count, Throughput);
            bag.Gauge(Cache.Id, Cache.Label, MetricBag.Ratio(db.Double(r, "blks_hit"), db.Double(r, "blks_read")), Percent, Memory);
            bag.Counter(Temp.Id, Temp.Label, db.Double(r, "temp_bytes"), Bytes, Io);
        }

        // The first attempt fails on PostgreSQL before 17 (no pg_stat_checkpointer): its failure is not worth a note.
        var cp = await MetricsQueries.TryAsync(runner, PgMonitorSql.Checkpointer, new MetricBag(), "Checkpoints", null, ct).ConfigureAwait(false)
            ?? await MetricsQueries.TryAsync(runner, PgMonitorSql.Bgwriter, bag, "Checkpoints", null, ct, Checkpoints).ConfigureAwait(false);
        if (cp is not null) bag.Counter(Checkpoints.Id, Checkpoints.Label, MetricsQueries.First(cp, "checkpoints"), Count, Io);

        if (!inRecovery)
        {
            var repl = await MetricsQueries.TryAsync(runner, PgMonitorSql.Replication, bag, "Replication", PgMonitorSql.Needs, ct).ConfigureAwait(false);
            if (repl is { Rows.Count: > 0 } && repl.Double(repl.Rows[0], "replicas") is > 0 and var n)
            {
                bag.Gauge("replication.replicas", "Replicas", n, Count, Server);
                bag.Gauge("replication.lagSeconds", "Replay lag", repl.Double(repl.Rows[0], "max_lag_s"), Seconds, Server);
            }
        }

        MetricsQueries.AddSizes(bag, await MetricsQueries.TryAsync(runner, PgMonitorSql.Sizes, bag, "Database sizes", null, ct).ConfigureAwait(false));
        return MetricsQueries.Build(ProviderId, bag);
    }
}
