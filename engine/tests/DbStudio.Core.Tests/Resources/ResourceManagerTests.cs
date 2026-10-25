using System.Text.Json.Nodes;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Providers.Sqlite;
using Microsoft.Data.Sqlite;

namespace DbStudio.Core.Tests.Resources;

/// <summary>A clock the test moves by hand (timers are not driven: policies run on demand).</summary>
public sealed class ManualClock(DateTimeOffset? start = null) : TimeProvider
{
    private DateTimeOffset _now = start ?? new DateTimeOffset(2026, 1, 1, 9, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}

public sealed class FakeProbe : IMemoryProbe
{
    public MemorySample Value { get; set; } = new(100L * 1024 * 1024, 50L * 1024 * 1024, 16L * 1024 * 1024 * 1024);
    public MemorySample Sample() => Value;
}

/// <summary>Core services over SQLite with a manual clock and an on-demand <see cref="ResourceManager"/>.</summary>
public sealed class ResourceEnv : IAsyncDisposable
{
    public string Dir { get; } = Path.Combine(Path.GetTempPath(), "dbstudio-core-tests", Guid.NewGuid().ToString("N"));
    public ManualClock Clock { get; } = new();
    public FakeProbe Probe { get; } = new();
    public RecordingPublisher Events { get; } = new();
    public AppPaths Paths { get; }
    public SettingsService Settings { get; }
    public ProviderRegistry Providers { get; } = new([new SqliteProvider()]);
    public ConnectionStore Connections { get; }
    public ResultStore Results { get; }
    public HistoryService History { get; }
    public SessionManager Sessions { get; }
    public CatalogService Catalog { get; }
    public ExecutionService Executions { get; }
    public ResourceManager Resources { get; }

    public ResourceEnv(string? resources = null)
    {
        Paths = new AppPaths(Dir);
        Settings = new SettingsService(Paths);
        if (resources is not null) Settings.Update(new JsonObject { ["resources"] = JsonNode.Parse(resources) });
        Connections = new ConnectionStore(Paths, new InMemorySecretStore(), Providers);
        Results = new ResultStore(time: Clock);
        History = new HistoryService(Paths);
        Sessions = new SessionManager(Providers, Connections, Events, Results, settings: Settings, time: Clock, pingInterval: TimeSpan.FromHours(1));
        Catalog = new CatalogService(Providers, Connections, Events, time: Clock);
        Executions = new ExecutionService(Sessions, Results, History, Catalog, Connections, Events);
        Resources = new ResourceManager(Sessions, Catalog, Results, Connections, Providers, Events, settings: Settings, time: Clock, probe: Probe,
            interval: Timeout.InfiniteTimeSpan);
    }

    public ConnectionProfile AddSqlite(string file) =>
        Connections.Create(new ConnectionProfile
        {
            Name = file, ProviderId = "sqlite",
            Props = new() { ["path"] = Path.Combine(Dir, file), ["createIfMissing"] = true },
        }, null);

    public async Task<SessionHandle> SessionAsync(ConnectionProfile c) =>
        await Sessions.CreateAsync(c.Id, null, TransactionMode.Auto, false, CancellationToken.None);

    public async Task<ExecDoneEvent> RunAsync(string sid, string sql)
    {
        var started = Executions.Start(sid, new ExecuteCommand([new SqlBatch(sql, 1, 1)], 1000, true, "script"));
        return await Events.WaitAsync<ExecDoneEvent>(e => e.ExecutionId == started.ExecutionId);
    }

    public async ValueTask DisposeAsync()
    {
        await Resources.DisposeAsync();
        await Sessions.DisposeAsync();
        History.Dispose();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(Dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public class IdleReaperTests
{
    [Fact]
    public async Task IdleSession_IsReleased_AfterTheTimeout_AndReopensTransparently_OnTheNextRun()
    {
        await using var env = new ResourceEnv("""{ "idleSessionMinutes": 15 }""");
        var c = env.AddSqlite("a.sqlite");
        var h = await env.SessionAsync(c);
        Assert.Equal(ExecutionStatus.Ok, (await env.RunAsync(h.Id, "CREATE TABLE t (a INTEGER)")).Status);

        env.Clock.Advance(TimeSpan.FromMinutes(14));
        await env.Resources.RunPolicyAsync();
        Assert.False(h.Released);

        env.Clock.Advance(TimeSpan.FromMinutes(2));
        await env.Resources.RunPolicyAsync();
        Assert.True(h.Released);
        Assert.Equal("idle", h.ReleasedReason);
        Assert.False(env.Sessions.HoldsConnection(c.Id));
        var changed = env.Events.All.OfType<SessionChangedEvent>().Last(e => e.SessionId == h.Id);
        Assert.True(changed.Released);
        Assert.Equal("idle", changed.ReleasedReason);
        Assert.Equal(SessionState.Idle, changed.State);
        var released = Assert.Single(env.Events.All.OfType<ResourcesReleasedEvent>());
        Assert.Equal(("idle", 1), (released.Reason, released.Sessions));
        Assert.True(env.Sessions.Get(h.Id).ToInfo().Released);

        // The same session id runs again: the engine reopens the connection quietly and says so in the messages.
        var done = await env.RunAsync(h.Id, "INSERT INTO t VALUES (1)");
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        Assert.False(h.Released);
        Assert.True(env.Sessions.HoldsConnection(c.Id));
        var msg = env.Events.All.OfType<ExecMessageEvent>().Single(m => m.ExecutionId == done.ExecutionId);
        Assert.Equal(MessageSeverity.Info, msg.Severity);
        Assert.Contains("idle", msg.Text);
    }

    [Fact]
    public async Task Never_Releases_OpenTransactions_TempObjects_OrRunningWork_EvenUnderCriticalPressure()
    {
        await using var env = new ResourceEnv("""{ "idleSessionMinutes": 1, "memoryLimitMb": 64 }""");
        var c = env.AddSqlite("b.sqlite");
        var withTx = await env.SessionAsync(c);
        await env.RunAsync(withTx.Id, "CREATE TABLE t (a INTEGER)");
        await withTx.Session.SetTransactionModeAsync(TransactionMode.Manual, CancellationToken.None);
        await env.RunAsync(withTx.Id, "INSERT INTO t VALUES (1)");
        Assert.True(withTx.Session.TxOpen);

        var withTemp = await env.SessionAsync(c);
        Assert.Equal(ExecutionStatus.Ok, (await env.RunAsync(withTemp.Id, "CREATE TEMP TABLE scratch (a INTEGER)")).Status);
        Assert.True(withTemp.HasTempObjects);
        Assert.True(withTemp.ToInfo().HasTempObjects);

        var running = await env.SessionAsync(c);
        Assert.True(running.TryReserve("x_fake"));
        var idle = await env.SessionAsync(c);

        env.Probe.Value = env.Probe.Value with { WorkingSetBytes = 200L * 1024 * 1024 }; // over the 64 MB limit
        env.Clock.Advance(TimeSpan.FromHours(3));
        var memory = await env.Resources.RunPolicyAsync();
        Assert.Equal(ResourceManager.LevelCritical, memory.Level);

        Assert.False(withTx.Released);
        Assert.True(withTx.Session.TxOpen);
        Assert.False(withTemp.Released);
        Assert.False(running.Released);
        Assert.True(idle.Released);
        Assert.Equal("pressure", idle.ReleasedReason);
        running.Release();
        await withTx.Session.RollbackAsync(CancellationToken.None);
    }

    [Fact]
    public async Task AutoRelease_Off_Or_ZeroMinutes_KeepsIdleSessions()
    {
        await using var env = new ResourceEnv("""{ "idleSessionMinutes": 0 }""");
        var h = await env.SessionAsync(env.AddSqlite("c.sqlite"));
        env.Clock.Advance(TimeSpan.FromDays(1));
        await env.Resources.RunPolicyAsync();
        Assert.False(h.Released);

        env.Settings.Update(new JsonObject { ["resources"] = new JsonObject { ["idleSessionMinutes"] = 5, ["autoRelease"] = false } });
        await env.Resources.RunPolicyAsync();
        Assert.False(h.Released);
    }

    [Fact]
    public async Task ThePing_DoesNotCountAsActivity()
    {
        await using var env = new ResourceEnv("""{ "idleSessionMinutes": 10 }""");
        var h = await env.SessionAsync(env.AddSqlite("d.sqlite"));
        var before = h.LastActivity;
        env.Clock.Advance(TimeSpan.FromMinutes(5));
        Assert.True(h.TryReserve("ping"));
        h.Release();
        Assert.Equal(before, h.LastActivity);
        env.Clock.Advance(TimeSpan.FromMinutes(6));
        await env.Resources.RunPolicyAsync();
        Assert.True(h.Released);
    }
}

public class PressureTests
{
    [Theory]
    [InlineData(50, 100, "normal")]
    [InlineData(86, 100, "high")]
    [InlineData(100, 100, "critical")]
    public void Levels(long used, long limit, string level) => Assert.Equal(level, ResourceManager.LevelOf(used, limit));

    [Fact]
    public void AutoLimit_IsAQuarterOfRam_Between1And8Gb()
    {
        const long gb = 1024L * 1024 * 1024;
        Assert.Equal(4 * gb, ResourceManager.AutoLimitBytes(16 * gb));
        Assert.Equal(gb, ResourceManager.AutoLimitBytes(2 * gb));
        Assert.Equal(8 * gb, ResourceManager.AutoLimitBytes(256 * gb));
    }

    [Fact]
    public void IdleTimeout_ShrinksUnderPressure()
    {
        var p = new ResourcePolicy(IdleSessionMinutes: 15);
        Assert.Equal(TimeSpan.FromMinutes(15), ResourceManager.IdleTimeout(p, "normal"));
        Assert.Equal(TimeSpan.FromMinutes(5), ResourceManager.IdleTimeout(p, "high"));
        Assert.Equal(TimeSpan.FromMinutes(1), ResourceManager.IdleTimeout(p, "critical"));
        Assert.Null(ResourceManager.IdleTimeout(p with { AutoRelease = false }, "critical"));
    }

    [Fact]
    public async Task CrossingTheLimit_PublishesThePressureLevel_Once_AndCountsTheAppsMemory()
    {
        await using var env = new ResourceEnv("""{ "memoryLimitMb": 1000 }""");
        await env.Resources.RunPolicyAsync();
        Assert.Empty(env.Events.All.OfType<ResourcesPressureEvent>());

        env.Resources.ReportAppMemory("win-1", 800L * 1024 * 1024); // + 100 MB engine = 900 MB of 1000
        var m = await env.Resources.RunPolicyAsync();
        Assert.Equal(900L * 1024 * 1024, m.UsedBytes);
        Assert.Equal("high", m.Level);
        await env.Resources.RunPolicyAsync();
        Assert.Equal("high", Assert.Single(env.Events.All.OfType<ResourcesPressureEvent>()).Level);

        env.Clock.Advance(ResourceManager.ReportTtl + TimeSpan.FromSeconds(1)); // the report goes stale
        Assert.Equal("normal", (await env.Resources.RunPolicyAsync()).Level);
        Assert.Equal("normal", env.Events.All.OfType<ResourcesPressureEvent>().Last().Level);
    }

    [Fact]
    public async Task Pressure_ShrinksTheStoredResults()
    {
        await using var env = new ResourceEnv("""{ "memoryLimitMb": 64, "resultCacheMinutes": 0 }""");
        env.Probe.Value = env.Probe.Value with { WorkingSetBytes = 10L * 1024 * 1024 };
        var cols = new[] { new ColumnInfo("v", 0, "TEXT", ColumnKinds.String, true) };
        var x = env.Results.Begin("s1", "x1", Dialect.Sqlite);
        x.Start(0, 0, cols);
        x.AddRows(0, [[new string('x', 50_000)]]);
        x.Completed = true;
        await env.Resources.RunPolicyAsync();
        Assert.NotNull(env.Results.Get("x1"));

        env.Probe.Value = env.Probe.Value with { WorkingSetBytes = 100L * 1024 * 1024 };
        env.Clock.Advance(TimeSpan.FromMinutes(2));
        await env.Resources.RunPolicyAsync();
        Assert.Null(env.Results.Get("x1")); // unread for 2 min > the 1 min expiry under critical pressure
    }
}

public class StoredResultExpiryTests
{
    [Fact]
    public void UnreadCompletedResults_Expire_RunningOnesStay()
    {
        var clock = new ManualClock();
        var store = new ResultStore(time: clock);
        var cols = new[] { new ColumnInfo("v", 0, "TEXT", ColumnKinds.String, true) };
        var done = store.Begin("s1", "x1", Dialect.Sqlite);
        done.Start(0, 0, cols);
        done.AddRows(0, [["a"]]);
        done.Completed = true;
        var running = store.Begin("s2", "x2", Dialect.Sqlite);
        running.Start(0, 0, cols);

        clock.Advance(TimeSpan.FromMinutes(20));
        Assert.NotNull(store.Get("x1")); // read: touched
        clock.Advance(TimeSpan.FromMinutes(20));
        Assert.Equal(0, store.Trim(TimeSpan.FromMinutes(30)));
        Assert.NotNull(store.Get("x1"));
        clock.Advance(TimeSpan.FromMinutes(31));
        Assert.True(store.Trim(TimeSpan.FromMinutes(30)) > 0);
        Assert.Null(store.Get("x1"));
        Assert.NotNull(store.Get("x2"));
        Assert.Equal(0, store.TotalBytes);
    }
}

public class CatalogLruTests
{
    private static async Task<CatalogSnapshotResult> LoadAsync(ResourceEnv env, ConnectionProfile c) =>
        await env.Catalog.GetSnapshotAsync(c.Id, null, null, null, CancellationToken.None);

    [Fact]
    public async Task Trim_EvictsTheLeastRecentlyUsedSchemas_AndAReloadGetsANewETag()
    {
        await using var env = new ResourceEnv();
        var conns = new List<ConnectionProfile>();
        for (var i = 0; i < 3; i++)
        {
            var c = env.AddSqlite($"cat{i}.sqlite");
            var h = await env.SessionAsync(c);
            await env.RunAsync(h.Id, $"CREATE TABLE t{i} (id INTEGER PRIMARY KEY, name TEXT)");
            conns.Add(c);
        }
        var first = await LoadAsync(env, conns[0]);
        env.Clock.Advance(TimeSpan.FromMinutes(1));
        await LoadAsync(env, conns[1]);
        env.Clock.Advance(TimeSpan.FromMinutes(1));
        await LoadAsync(env, conns[2]);

        var total = env.Catalog.TotalBytes();
        Assert.True(total > 0);
        // The newest entry is too recent for the 30 s minimum idle time; the oldest goes first.
        var freed = env.Catalog.Trim(total - 1, TimeSpan.FromSeconds(30));
        Assert.True(freed > 0);
        Assert.Equal(0, env.Catalog.Stats(conns[0].Id).Bytes);
        Assert.True(env.Catalog.Stats(conns[1].Id).Bytes > 0);
        Assert.True(env.Catalog.Stats(conns[2].Id).Bytes > 0);

        // Within budget: nothing more goes.
        Assert.Equal(0, env.Catalog.Trim(total, TimeSpan.Zero));
        // Recently used entries survive even a zero budget unless the minimum idle time allows them.
        env.Catalog.Trim(0, TimeSpan.FromHours(1));
        Assert.True(env.Catalog.Stats(conns[2].Id).Bytes > 0);

        // Reload lazily: a new ETag and a higher version, so a client holding the old copy refetches it.
        var reloaded = await env.Catalog.GetSnapshotAsync(conns[0].Id, null, null, first.ETag, CancellationToken.None);
        Assert.False(reloaded.NotModified);
        Assert.NotEqual(first.ETag, reloaded.ETag);
        Assert.True(reloaded.Version > first.Version);
    }

    [Fact]
    public async Task Forget_ThenReload_NeverReusesAnETag()
    {
        await using var env = new ResourceEnv();
        var c = env.AddSqlite("f.sqlite");
        var h = await env.SessionAsync(c);
        await env.RunAsync(h.Id, "CREATE TABLE t (id INTEGER)");
        var first = await LoadAsync(env, c);
        env.Catalog.Forget(c.Id);
        var again = await env.Catalog.GetSnapshotAsync(c.Id, null, null, first.ETag, CancellationToken.None);
        Assert.False(again.NotModified);
        Assert.True(again.Version > first.Version);

        Assert.True(env.Catalog.ForgetDatabase(c.Id, null) > 0);
        Assert.Equal(0, env.Catalog.Stats(c.Id).Bytes);
    }

    [Fact]
    public async Task ThePolicy_TrimsTheCatalogToItsBudget()
    {
        await using var env = new ResourceEnv("""{ "catalogCacheMb": 8, "memoryLimitMb": 64 }""");
        env.Probe.Value = env.Probe.Value with { WorkingSetBytes = 10L * 1024 * 1024 };
        var c = env.AddSqlite("p.sqlite");
        var h = await env.SessionAsync(c);
        await env.RunAsync(h.Id, "CREATE TABLE t (id INTEGER)");
        await LoadAsync(env, c);
        await env.Resources.RunPolicyAsync();
        Assert.True(env.Catalog.Stats(c.Id).Bytes > 0); // well within 8 MB

        env.Probe.Value = env.Probe.Value with { WorkingSetBytes = 100L * 1024 * 1024 }; // critical: budget / 4, no minimum idle
        await env.Resources.RunPolicyAsync();
        Assert.True(env.Catalog.Stats(c.Id).Bytes > 0); // still fits 2 MB
    }
}

public class ConnectionLimitTests
{
    [Fact]
    public async Task OpeningOneMore_ReleasesTheLeastRecentlyUsedIdleConnection()
    {
        await using var env = new ResourceEnv("""{ "maxOpenConnections": 2 }""");
        var a = env.AddSqlite("la.sqlite");
        var b = env.AddSqlite("lb.sqlite");
        var c = env.AddSqlite("lc.sqlite");
        var ha = await env.SessionAsync(a);
        env.Clock.Advance(TimeSpan.FromMinutes(1));
        var hb = await env.SessionAsync(b);
        env.Clock.Advance(TimeSpan.FromMinutes(1));

        var hc = await env.SessionAsync(c);
        Assert.True(ha.Released);
        Assert.Equal("limit", ha.ReleasedReason);
        Assert.False(hb.Released);
        Assert.False(hc.Released);
        var ev = Assert.Single(env.Events.All.OfType<ResourcesReleasedEvent>());
        Assert.Equal((a.Id, "limit", "la.sqlite"), (ev.ConnectionId, ev.Reason, ev.ConnectionName));
        Assert.Equal(2, env.Resources.ConnectedConnections().Count);
    }

    [Fact]
    public async Task BusyConnections_AreSkipped_AndTheConnectNeverFails()
    {
        await using var env = new ResourceEnv("""{ "maxOpenConnections": 1 }""");
        var a = env.AddSqlite("ba.sqlite");
        var b = env.AddSqlite("bb.sqlite");
        var ha = await env.SessionAsync(a);
        await env.RunAsync(ha.Id, "CREATE TABLE t (a INTEGER)");
        await ha.Session.SetTransactionModeAsync(TransactionMode.Manual, CancellationToken.None);
        await env.RunAsync(ha.Id, "INSERT INTO t VALUES (1)");

        var hb = await env.SessionAsync(b);
        Assert.False(ha.Released); // its transaction keeps it
        Assert.False(hb.Released);
        Assert.Equal(2, env.Resources.ConnectedConnections().Count);
        await ha.Session.RollbackAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ReopeningAReleasedSession_CountsAsOpeningAConnection()
    {
        await using var env = new ResourceEnv("""{ "maxOpenConnections": 1 }""");
        var a = env.AddSqlite("ra.sqlite");
        var b = env.AddSqlite("rb.sqlite");
        var ha = await env.SessionAsync(a);
        env.Clock.Advance(TimeSpan.FromMinutes(1));
        var hb = await env.SessionAsync(b); // releases a
        Assert.True(ha.Released);
        env.Clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(ExecutionStatus.Ok, (await env.RunAsync(ha.Id, "SELECT 1")).Status); // reopens a, releases b
        Assert.False(ha.Released);
        Assert.True(hb.Released);
    }
}

public class CloseConnectionTests
{
    [Fact]
    public async Task Close_ListsBlockers_ThenForceRollsBack_ReleasesSessions_AndDropsTheCatalog()
    {
        await using var env = new ResourceEnv();
        var c = env.AddSqlite("close.sqlite");
        var h = await env.SessionAsync(c);
        await env.RunAsync(h.Id, "CREATE TABLE t (a INTEGER)");
        await env.Catalog.GetSnapshotAsync(c.Id, null, null, null, CancellationToken.None);
        await h.Session.SetTransactionModeAsync(TransactionMode.Manual, CancellationToken.None);
        await env.RunAsync(h.Id, "INSERT INTO t VALUES (1)");
        var idle = await env.SessionAsync(c);

        var described = env.Resources.Describe(c.Id);
        Assert.True(described.Connected);
        Assert.Equal((2, 2, 0), (described.Sessions, described.OpenSessions, described.ReleasedSessions));
        Assert.True(described.CatalogBytes > 0);
        var blocker = Assert.Single(described.Blockers);
        Assert.Equal("transaction", blocker.Kind);

        var busy = await Assert.ThrowsAsync<EngineException>(() => env.Resources.CloseAsync(c.Id, null, force: false, clientId: null));
        Assert.Equal((409, ErrorCodes.ResourceBusy), (busy.Status, busy.Code));
        Assert.False(h.Released);

        var r = await env.Resources.CloseAsync(c.Id, null, force: true, clientId: null);
        Assert.Equal((2, 1), (r.Sessions, r.RolledBack));
        Assert.True(r.CatalogBytes > 0);
        Assert.True(h.Released && idle.Released);
        Assert.Equal("closed", h.ReleasedReason);
        Assert.Equal(0, env.Catalog.Stats(c.Id).Bytes);
        Assert.False(env.Resources.Describe(c.Id).Connected);

        // The tab reconnects lazily; the rolled-back insert is gone.
        var done = await env.RunAsync(h.Id, "SELECT COUNT(*) FROM t");
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        Assert.Equal(TransactionMode.Manual, h.Session.TxMode);
        var rows = env.Results.Get(done.ExecutionId)!.Get(0)!.Page(0, 1);
        Assert.Equal(0L, Convert.ToInt64(rows[0][0]));
    }

    [Fact]
    public async Task Close_IgnoresAnotherLiveWindowsSessions()
    {
        await using var env = new ResourceEnv();
        var c = env.AddSqlite("win.sqlite");
        var mine = await env.Sessions.CreateAsync(c.Id, null, TransactionMode.Auto, false, "win-a", CancellationToken.None);
        var theirs = await env.Sessions.CreateAsync(c.Id, null, TransactionMode.Auto, false, "win-b", CancellationToken.None);
        // without presence information both owners count as live: only the requester's own session is released
        var r = await env.Resources.CloseAsync(c.Id, null, force: false, clientId: "win-a");
        Assert.Equal(1, r.Sessions);
        Assert.True(mine.Released);
        Assert.False(theirs.Released);
    }

    [Fact]
    public async Task CloseAll_ReleasesEveryConnection()
    {
        await using var env = new ResourceEnv();
        var a = env.AddSqlite("all-a.sqlite");
        var b = env.AddSqlite("all-b.sqlite");
        var ha = await env.SessionAsync(a);
        var hb = await env.SessionAsync(b);
        var r = await env.Resources.CloseAllAsync(force: false, clientId: null);
        Assert.Equal((2, 2), (r.Connections, r.Sessions));
        Assert.True(ha.Released && hb.Released);
        Assert.Empty(env.Resources.ConnectedConnections());
        var snapshot = env.Resources.Snapshot();
        Assert.Equal(0, snapshot.Totals.OpenConnections);
        Assert.Equal(2, snapshot.Totals.ReleasedSessions);
    }
}

public class ResourceSettingsTests
{
    [Fact]
    public void Defaults_AreDocumented_AndValidated()
    {
        var paths = new AppPaths(Path.Combine(Path.GetTempPath(), "dbstudio-core-tests", Guid.NewGuid().ToString("N")));
        var s = new SettingsService(paths);
        var r = s.Get()["resources"]!.AsObject();
        Assert.Equal(15, (int)SettingsService.Number(r["idleSessionMinutes"]));
        Assert.Equal(20, (int)SettingsService.Number(r["maxOpenConnections"]));
        Assert.Equal(0, (int)SettingsService.Number(r["memoryLimitMb"]));
        Assert.True(r["autoRelease"]!.GetValue<bool>());
        Assert.Equal(new ResourcePolicy(), ResourcePolicy.From(s));

        var bad = Assert.Throws<EngineException>(() => s.Update(new JsonObject { ["resources"] = new JsonObject { ["maxOpenConnections"] = -1 } }));
        Assert.Equal(400, bad.Status);
        s.Update(new JsonObject { ["resources"] = new JsonObject { ["idleSessionMinutes"] = 30 } });
        Assert.Equal(30, ResourcePolicy.From(s).IdleSessionMinutes);
    }
}
