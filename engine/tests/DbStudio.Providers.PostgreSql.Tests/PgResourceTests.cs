using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Providers.PostgreSql.Tests;

/// <summary>
/// Resources (docs/resources.md) against a real PostgreSQL server: the idle reaper closes the backend of an idle
/// session, the next run reconnects transparently on the database the session was on, and a session holding a
/// temporary table is kept.
/// </summary>
public sealed class PgResourceTests(PgFixture fixture) : IClassFixture<PgFixture>, IAsyncDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-pg-tests", Guid.NewGuid().ToString("N"));
    private readonly List<IAsyncDisposable> _owned = [];
    private readonly List<IDisposable> _disposables = [];

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Events : IEventPublisher
    {
        public readonly ConcurrentQueue<EngineEvent> All = new();
        public void Publish(EngineEvent ev) => All.Enqueue(ev);
    }

    private sealed record Env(Clock Clock, Events Events, SessionManager Sessions, ExecutionService Executions, ResultStore Results,
        ResourceManager Resources, ConnectionProfile Profile);

    private Env Create()
    {
        var clock = new Clock();
        var events = new Events();
        var paths = new AppPaths(_dir);
        var settings = new SettingsService(paths);
        settings.Update(new JsonObject { ["resources"] = new JsonObject { ["idleSessionMinutes"] = 15 } });
        var providers = new ProviderRegistry([new PostgreSqlProvider()]);
        var connections = new ConnectionStore(paths, new InMemorySecretStore(), providers);
        var results = new ResultStore(time: clock);
        var sessions = new SessionManager(providers, connections, events, results, settings: settings, time: clock, pingInterval: TimeSpan.FromHours(1));
        var catalog = new CatalogService(providers, connections, events, time: clock);
        var history = new HistoryService(paths);
        _disposables.Add(history);
        var executions = new ExecutionService(sessions, results, history, catalog, connections, events);
        var resources = new ResourceManager(sessions, catalog, results, connections, providers, events, settings: settings, time: clock,
            interval: Timeout.InfiniteTimeSpan);
        _owned.Add(resources);
        _owned.Add(sessions);
        var profile = connections.Create(new ConnectionProfile
        {
            Name = "pg", ProviderId = "postgresql",
            Props = new(fixture.Profile.Props.Select(kv => KeyValuePair.Create(kv.Key, kv.Value?.DeepClone()))),
        }, fixture.Password);
        return new Env(clock, events, sessions, executions, results, resources, profile);
    }

    private static async Task<object?[]> ScalarRowAsync(Env env, string sid, string sql)
    {
        var started = env.Executions.Start(sid, new ExecuteCommand([new SqlBatch(sql, 1, 1)], 100, true, "statement"));
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!env.Events.All.OfType<ExecDoneEvent>().Any(e => e.ExecutionId == started.ExecutionId))
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException(sql);
            await Task.Delay(20);
        }
        var done = env.Events.All.OfType<ExecDoneEvent>().Single(e => e.ExecutionId == started.ExecutionId);
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        return env.Results.Get(started.ExecutionId)?.Get(0)?.Page(0, 1).FirstOrDefault() ?? [];
    }

    [SkippableFact]
    public async Task IdleSession_ClosesItsBackend_AndReconnectsTransparently_OnTheSameDatabase()
    {
        Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");
        var env = Create();
        var h = await env.Sessions.CreateAsync(env.Profile.Id, null, TransactionMode.Auto, false, CancellationToken.None);
        await env.Sessions.ReopenWithDatabaseAsync(h, "postgres", CancellationToken.None);
        var pid = Convert.ToInt64((await ScalarRowAsync(env, h.Id, "SELECT pg_backend_pid()"))[0]);
        var watcher = await env.Sessions.CreateAsync(env.Profile.Id, null, TransactionMode.Auto, false, CancellationToken.None);

        env.Clock.Now += TimeSpan.FromMinutes(16);
        // the watcher stays busy-looking recent: it runs after the clock moved
        await ScalarRowAsync(env, watcher.Id, "SELECT 1");
        await env.Resources.RunPolicyAsync();
        Assert.True(h.Released);
        Assert.False(watcher.Released);

        // The server no longer has the released backend.
        var deadline = DateTime.UtcNow.AddSeconds(10);
        long alive;
        do
        {
            alive = Convert.ToInt64((await ScalarRowAsync(env, watcher.Id, $"SELECT COUNT(*) FROM pg_stat_activity WHERE pid = {pid}"))[0]);
            if (alive == 0) break;
            await Task.Delay(100);
        } while (DateTime.UtcNow < deadline);
        Assert.Equal(0, alive);

        // Same session id, reconnected on "postgres" (the database it had switched to).
        var row = await ScalarRowAsync(env, h.Id, "SELECT current_database(), pg_backend_pid()");
        Assert.Equal("postgres", row[0]);
        Assert.NotEqual(pid, Convert.ToInt64(row[1]));
        Assert.False(h.Released);
        Assert.Contains(env.Events.All.OfType<ExecMessageEvent>(), m => m.Severity == MessageSeverity.Info && m.Text.Contains("idle"));
    }

    [SkippableFact]
    public async Task SessionWithATempTable_IsKept()
    {
        Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");
        var env = Create();
        var h = await env.Sessions.CreateAsync(env.Profile.Id, null, TransactionMode.Auto, false, CancellationToken.None);
        await ScalarRowAsync(env, h.Id, "CREATE TEMP TABLE zz_resources_keep (a int)");
        Assert.True(h.HasTempObjects);
        env.Clock.Now += TimeSpan.FromHours(2);
        await env.Resources.RunPolicyAsync();
        Assert.False(h.Released);
        Assert.Equal(0L, Convert.ToInt64((await ScalarRowAsync(env, h.Id, "SELECT COUNT(*) FROM zz_resources_keep"))[0]));
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var d in Enumerable.Reverse(_owned)) await d.DisposeAsync();
        foreach (var d in _disposables) d.Dispose();
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
