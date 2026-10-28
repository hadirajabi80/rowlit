using System.Net;
using System.Text.Json;
using DbStudio.Core.Services;
using DbStudio.Logs.Monitor;
using DbStudio.Logs.Sql;
using Microsoft.Extensions.DependencyInjection;
using static DbStudio.Logs.Tests.Rows;

namespace DbStudio.Logs.Tests.Monitor;

/// <summary>Server monitor (WP-12): per-provider readers over a scripted SQL runner, the service and the wire shape.</summary>
public sealed class MonitorTests
{
    private static MonitorMetric M(MonitorSnapshot s, string id) => Assert.Single(s.Metrics, m => m.Id == id);

    private static FakeSqlRunner PgRunner(bool denyDatabaseStats = false)
    {
        var r = new FakeSqlRunner();
        if (denyDatabaseStats) r.OnFail("FROM pg_stat_database", "42501", "permission denied for view pg_stat_database");
        r.On("pg_postmaster_start_time", Set(["version", "max_connections", "uptime_s", "in_recovery", "replay_lag_s"],
            R("PostgreSQL 17.2 on x86_64", 100, 3600, false, null)));
        r.On("FROM pg_stat_activity", Set(["total", "active", "blocked", "idle_in_tx"], R(12, 3, 1, 2)));
        r.On("FROM pg_stat_database", Set(["xacts", "blks_hit", "blks_read", "tup_read", "tup_written", "deadlocks", "temp_bytes"],
            R(5000, 9900, 100, 70000, 1200, 2, 4096)));
        r.OnFail("pg_stat_checkpointer", "42P01", "relation \"pg_stat_checkpointer\" does not exist");
        r.On("pg_stat_bgwriter", Set(["checkpoints"], R(42)));
        r.On("FROM pg_stat_replication", Set(["replicas", "max_lag_s"], R(2, 0.5)));
        r.On("pg_database_size", Set(["name", "size_bytes"], R("shop", 5_000_000L), R("postgres", 9_000_000L)));
        return r;
    }

    [Fact]
    public async Task Postgres_reports_gauges_counters_and_sizes()
    {
        var snap = await new PgMetricsReader(PgRunner()).SnapshotAsync(Target("postgresql"), default);
        Assert.Equal("postgresql", snap.ProviderId);
        Assert.Equal("PostgreSQL 17.2 on x86_64", snap.Version);
        Assert.Equal(12, M(snap, "sessions.total").Value);
        Assert.Equal(3, M(snap, "sessions.active").Value);
        Assert.Equal(1, M(snap, "sessions.blocked").Value);
        Assert.Equal(100, M(snap, "connections.max").Value);
        Assert.Equal(3600, M(snap, "uptime").Value);
        var tx = M(snap, "transactions");
        Assert.Equal(MetricKinds.Counter, tx.Kind);
        Assert.Equal(5000, tx.Value);
        Assert.Equal(99, M(snap, "cache.hitRatio").Value); // 9900 / (9900 + 100)
        Assert.Equal(MetricKinds.Gauge, M(snap, "cache.hitRatio").Kind);
        Assert.Equal(42, M(snap, "checkpoints").Value); // pg_stat_bgwriter fallback below PostgreSQL 17
        Assert.Equal(2, M(snap, "replication.replicas").Value);
        Assert.Equal(0.5, M(snap, "replication.lagSeconds").Value);
        Assert.Equal(["postgres", "shop"], snap.Databases.Select(d => d.Name)); // largest first
        Assert.Empty(snap.Notes); // the pg_stat_checkpointer miss is not worth a note
    }

    [Fact]
    public async Task A_denied_view_degrades_only_its_own_tiles()
    {
        var snap = await new PgMetricsReader(PgRunner(denyDatabaseStats: true)).SnapshotAsync(Target("postgresql"), default);
        var tx = M(snap, "transactions");
        Assert.Null(tx.Value);
        Assert.Contains("permission denied", tx.Hint);
        Assert.Equal("GRANT pg_monitor TO <login>;", tx.Needs);
        Assert.Equal(12, M(snap, "sessions.total").Value); // the rest still works
    }

    [Fact]
    public async Task Sql_server_maps_performance_counters_and_computes_the_cache_ratio()
    {
        var r = new FakeSqlRunner();
        r.On("CAST(SERVERPROPERTY('ProductVersion')", Set(["product_version", "edition", "max_connections", "uptime_s"], R("16.0.4135.4", "Developer Edition (64-bit)", 32767, 7200)));
        r.On("AS blocked", Set(["total", "active", "blocked"], R(20, 4, 1)));
        r.On("dm_os_performance_counters", Set(["object_name", "counter_name", "instance_name", "cntr_value"],
            R("SQLServer:SQL Statistics", "Batch Requests/sec", "", 1000L),
            R("SQLServer:Databases", "Transactions/sec", "_Total", 800L),
            R("SQLServer:Buffer Manager", "Page life expectancy", "", 4200L),
            R("SQLServer:Buffer Manager", "Buffer cache hit ratio", "", 970L),
            R("SQLServer:Buffer Manager", "Buffer cache hit ratio base", "", 1000L),
            R("SQLServer:Memory Manager", "Total Server Memory (KB)", "", 2048L),
            R("SQLServer:Locks", "Number of Deadlocks/sec", "_Total", 3L)));
        r.On("sys.master_files", Set(["name", "size_bytes"], R("master", 8_000_000L), R("Shop", 90_000_000L)));
        var snap = await new SqlServerMetricsReader(r).SnapshotAsync(Target("sqlserver"), default);
        Assert.Equal("Developer Edition (64-bit) 16.0.4135.4", snap.Version);
        Assert.Equal(1000, M(snap, "queries").Value);
        Assert.Equal(MetricKinds.Counter, M(snap, "queries").Kind);
        Assert.Equal(4200, M(snap, "memory.pageLifeExpectancy").Value);
        Assert.Equal(97, M(snap, "cache.hitRatio").Value);
        Assert.Equal(2048 * 1024, M(snap, "memory.server").Value);
        Assert.Equal(3, M(snap, "deadlocks").Value);
        Assert.Equal(1, M(snap, "sessions.blocked").Value);
        Assert.Equal("Shop", snap.Databases[0].Name);
    }

    [Fact]
    public async Task Sql_server_without_view_server_state_keeps_the_tiles_with_the_grant()
    {
        var r = new FakeSqlRunner();
        r.OnFail("dm_os_performance_counters", "300", "VIEW SERVER STATE permission was denied on object 'server', database 'master'.");
        r.OnFail("AS blocked", "300", "VIEW SERVER STATE permission was denied on object 'server', database 'master'.");
        var snap = await new SqlServerMetricsReader(r).SnapshotAsync(Target("sqlserver"), default);
        var batches = M(snap, "queries");
        Assert.Null(batches.Value);
        Assert.Equal("GRANT VIEW SERVER STATE TO <login>;", batches.Needs);
        Assert.Null(M(snap, "sessions.total").Value);
    }

    [Fact]
    public async Task MySql_derives_transactions_ratio_and_running_threads()
    {
        var r = new FakeSqlRunner();
        r.On("@@max_connections", Set(["max_connections", "version"], R(151, "8.4.0")));
        r.On("SHOW GLOBAL STATUS", Set(["Variable_name", "Value"],
            R("Questions", "10000"), R("Com_commit", "300"), R("Com_rollback", "20"), R("Threads_connected", "9"), R("Threads_running", "3"),
            R("Uptime", "86400"), R("Innodb_buffer_pool_read_requests", "100000"), R("Innodb_buffer_pool_reads", "500"), R("Bytes_sent", "123456")));
        r.On("INNODB_TRX", Set(["blocked"], R(2)));
        r.On("information_schema.tables", Set(["name", "size_bytes"], R("shop", "4096")));
        var snap = await new MySqlMetricsReader(r, "mariadb").SnapshotAsync(Target("mariadb"), default);
        Assert.Equal("mariadb", snap.ProviderId);
        Assert.Equal("8.4.0", snap.Version);
        Assert.Equal(9, M(snap, "sessions.total").Value);
        Assert.Equal(2, M(snap, "sessions.active").Value); // Threads_running includes the monitor's own statement
        Assert.Equal(320, M(snap, "transactions").Value);
        Assert.Equal(99.5, M(snap, "cache.hitRatio").Value);
        Assert.Equal(2, M(snap, "sessions.blocked").Value);
        Assert.Equal(151, M(snap, "connections.max").Value);
        Assert.Equal(4096, snap.Databases.Single().SizeBytes);
    }

    [Fact]
    public async Task ClickHouse_reads_metrics_events_and_uptime()
    {
        var r = new FakeSqlRunner();
        r.On("SELECT version()", Set(["version"], R("24.8.1.1")));
        r.On("FROM system.metrics", Set(["name", "value"], R("Query", "3"), R("TCPConnection", "2"), R("HTTPConnection", "5"), R("MemoryTracking", "1048576"), R("Merge", "1")));
        r.On("FROM system.events", Set(["name", "value"], R("Query", "500"), R("SelectQuery", "400"), R("MarkCacheHits", "90"), R("MarkCacheMisses", "10")));
        r.On("asynchronous_metrics", Set(["value"], R("12345.5")));
        r.On("system.parts", Set(["name", "size_bytes"], R("default", "100")));
        var snap = await new ClickHouseMetricsReader(r).SnapshotAsync(Target("clickhouse"), default);
        Assert.Equal("24.8.1.1", snap.Version);
        Assert.Equal(2, M(snap, "sessions.active").Value);
        Assert.Equal(7, M(snap, "sessions.total").Value);
        Assert.Equal(500, M(snap, "queries").Value);
        Assert.Equal(90, M(snap, "cache.hitRatio").Value);
        Assert.Equal(12345.5, M(snap, "uptime").Value);
        Assert.Equal(1048576, M(snap, "memory.tracked").Value);
    }

    [Fact]
    public async Task Oracle_reads_sessions_sysstat_and_the_tablespaces()
    {
        var r = new FakeSqlRunner();
        r.On("FROM v$instance", Set(["version", "instance_name", "uptime_s"], R("23.0.0.0", "FREE", 5000.9)));
        r.On("FROM v$session", Set(["total", "active", "blocked"], R(30, 5, null)));
        r.On("v$parameter", Set(["max_sessions"], R(472)));
        r.On("FROM v$sysstat", Set(["name", "value"],
            R("user commits", "100"), R("user rollbacks", "5"), R("execute count", "4000"), R("physical reads", "200"), R("db block gets", "3000"), R("consistent gets", "7000")));
        r.On("dba_data_files", Set(["name", "size_bytes"], R("USERS", "1048576")));
        var snap = await new OracleMetricsReader(r).SnapshotAsync(Target("oracle"), default);
        Assert.Equal(5000, M(snap, "uptime").Value);
        Assert.Equal(4, M(snap, "sessions.active").Value);
        Assert.Equal(0, M(snap, "sessions.blocked").Value);
        Assert.Equal(472, M(snap, "connections.max").Value);
        Assert.Equal(105, M(snap, "transactions").Value);
        Assert.Equal(98, M(snap, "cache.hitRatio").Value);
        Assert.Equal("USERS", snap.Databases.Single().Name);
    }

    [Fact]
    public async Task Snowflake_sums_the_warehouses_and_degrades_the_history_without_a_database()
    {
        var r = new FakeSqlRunner();
        r.On("CURRENT_VERSION()", Set(["VERSION"], R("9.1.0")));
        r.On("SHOW WAREHOUSES", Set(["name", "state", "started_clusters", "running", "queued"],
            R("WH1", "STARTED", 1, 3, 1), R("WH2", "SUSPENDED", 0, 0, 0), R("WH3", "RESIZING", 2, 2, 0)));
        r.OnFail("QUERY_HISTORY", "90105", "Cannot perform SELECT. This session does not have a current database.");
        var snap = await new SnowflakeMetricsReader(r).SnapshotAsync(Target("snowflake"), default);
        Assert.Equal(5, M(snap, "sessions.active").Value);
        Assert.Equal(1, M(snap, "sessions.blocked").Value);
        Assert.Equal(2, M(snap, "warehouses.started").Value);
        Assert.Equal(3, M(snap, "warehouses.clusters").Value);
        Assert.Null(M(snap, "queries.recent").Value);
        Assert.Contains("current database", M(snap, "queries.recent").Hint);
        Assert.All(snap.Metrics, m => Assert.Equal(MetricKinds.Gauge, m.Kind));
    }

    [Fact]
    public void Top_queries_are_the_longest_running_non_idle_rows()
    {
        ActivityRow Row(string id, string state, long? ms, string kind = "session") => new() { Id = id, Kind = kind, State = state, DurationMs = ms, CanKill = true };
        var top = MonitorService.PickTop([
            Row("1", "idle", 900_000), Row("2", "active", 1_000), Row("3", "active", 5_000), Row("4", "running", null), Row("5", "WAIT", 9_000, "lock"),
            Row("6", "sleeping", 800_000), Row("7", "running", 3_000, "op"), Row("8", "", 7_000)], 2);
        Assert.Equal(["3", "7"], top.Select(r => r.Id));
    }

    [Fact]
    public void Every_monitored_provider_has_a_keyed_reader()
    {
        var services = new ServiceCollection();
        services.AddSingleton<ISqlRunnerFactory>(new FakeSqlRunner());
        new LogsModule().ConfigureServices(services);
        using var sp = services.BuildServiceProvider();
        foreach (var id in new[] { "postgresql", "sqlserver", "mysql", "mariadb", "clickhouse", "oracle", "snowflake" })
            Assert.Equal(id, sp.GetRequiredKeyedService<IMetricsReader>(id).ProviderId);
        Assert.Null(sp.GetKeyedService<IMetricsReader>("sqlite"));
        Assert.Null(sp.GetKeyedService<IMetricsReader>("redis"));
    }

    [Fact]
    public void The_wire_shape_is_camelCase_and_omits_nulls()
    {
        var snap = new MonitorSnapshot("2026-10-28T10:00:00Z", "postgresql",
            [new MonitorMetric("sessions.total", "Sessions", 12, MetricUnits.Count, MetricKinds.Gauge, MetricGroups.Sessions), new MonitorMetric("x", "X", null, "count", "counter", "io", "denied", "GRANT x;")],
            [new MonitorDatabase("shop", 10)], [], ["note"]) { Version = "17" };
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(snap, CoreJson.Options));
        var root = doc.RootElement;
        Assert.Equal("17", root.GetProperty("version").GetString());
        var first = root.GetProperty("metrics")[0];
        Assert.Equal(12, first.GetProperty("value").GetDouble());
        Assert.False(first.TryGetProperty("hint", out _));
        var second = root.GetProperty("metrics")[1];
        Assert.Equal("GRANT x;", second.GetProperty("needs").GetString());
        Assert.Equal(10, root.GetProperty("databases")[0].GetProperty("sizeBytes").GetInt64());
        Assert.Equal("note", root.GetProperty("notes")[0].GetString());
    }
}

public sealed class MonitorEndpointTests : IAsyncLifetime
{
    private LogsHarness _h = null!;

    public Task InitializeAsync()
    {
        _h = new LogsHarness();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _h.DisposeAsync();

    private void SqlServerMonitor()
    {
        _h.Sql.On("CAST(SERVERPROPERTY('ProductVersion')", Set(["product_version", "edition", "max_connections", "uptime_s"], R("16.0.1", "Developer", 100, 60)));
        _h.Sql.On("AS blocked", Set(["total", "active", "blocked"], R(3, 1, 0)));
        _h.Sql.On("SUSER_SNAME()", Set(["login_name", "engine_edition", "product_version", "is_sysadmin", "view_server_state", "has_agent"], R("app", 3, "16.0.1", 1, 1, 0)));
        _h.Sql.On("OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle)",
            Set(["session_id", "login_name", "host_name", "program_name", "database_name", "status", "login_time", "start_time", "total_elapsed_time", "wait_type", "wait_time", "blocking_session_id", "command", "cpu_time", "logical_reads", "open_transaction_count", "last_request_start_time", "sql_text"],
                R(55, "app", "h", "p", "Shop", "running", "2026-10-28T09:00:00", "2026-10-28T09:58:00", 120_000, null, 0, 0, "SELECT", 10, 20, 0, "2026-10-28T09:58:00", "SELECT * FROM big"),
                R(56, "app", "h", "p", "Shop", "sleeping", "2026-10-28T09:00:00", null, null, null, 0, 0, null, 1, 1, 0, "2026-10-28T09:00:00", "idle")),
            Set(["session_id", "resource_type", "database_name", "request_mode", "request_status", "lock_count"]));
    }

    [Fact]
    public async Task Snapshot_endpoint_returns_metrics_and_the_longest_running_statements()
    {
        SqlServerMonitor();
        var p = _h.AddProfile("sqlserver");
        var res = await _h.Http.GetAsync($"/api/v1/monitor/{p.Id}/snapshot");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var root = doc.RootElement;
        Assert.Equal("sqlserver", root.GetProperty("providerId").GetString());
        Assert.Contains(root.GetProperty("metrics").EnumerateArray(), m => m.GetProperty("id").GetString() == "sessions.total" && m.GetProperty("value").GetDouble() == 3);
        var top = root.GetProperty("topQueries");
        Assert.Equal(1, top.GetArrayLength());
        Assert.Equal("55", top[0].GetProperty("id").GetString());
        Assert.True(top[0].GetProperty("canKill").GetBoolean());
    }

    [Fact]
    public async Task Queries_false_skips_the_activity_read()
    {
        SqlServerMonitor();
        var p = _h.AddProfile("sqlserver");
        var res = await _h.Http.GetAsync($"/api/v1/monitor/{p.Id}/snapshot?queries=false");
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal(0, doc.RootElement.GetProperty("topQueries").GetArrayLength());
        Assert.DoesNotContain(_h.Sql.Sql, s => s.Contains("sys.dm_tran_locks", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Unsupported_providers_and_unknown_connections_are_refused()
    {
        var sqlite = await _h.Http.GetAsync($"/api/v1/monitor/{_h.Sqlite.Id}/snapshot");
        Assert.Equal(HttpStatusCode.BadRequest, sqlite.StatusCode);
        Assert.Contains("not available", await sqlite.Content.ReadAsStringAsync());
        var engine = await _h.Http.GetAsync("/api/v1/monitor/engine/snapshot");
        Assert.Equal(HttpStatusCode.BadRequest, engine.StatusCode);
        var missing = await _h.Http.GetAsync("/api/v1/monitor/c_missing/snapshot");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Support_endpoint_tells_monitored_providers_apart()
    {
        var ss = _h.AddProfile("sqlserver");
        using var yes = JsonDocument.Parse(await (await _h.Http.GetAsync($"/api/v1/monitor/{ss.Id}/support")).Content.ReadAsStringAsync());
        Assert.True(yes.RootElement.GetProperty("supported").GetBoolean());
        using var no = JsonDocument.Parse(await (await _h.Http.GetAsync($"/api/v1/monitor/{_h.Sqlite.Id}/support")).Content.ReadAsStringAsync());
        Assert.False(no.RootElement.GetProperty("supported").GetBoolean());
    }
}
