using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime;
using System.Text.Json.Nodes;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.Services;

// Resources (docs/resources.md): one policy for everything the engine holds per connection — tab sessions, source
// clients, streams, pooled catalog connections, the catalog cache and the stored result rows — plus the explorer's
// manual "Close connection" / "Close database" / "Disconnect all".

/// <summary>settings <c>resources.*</c> (Settings › Connections › Resources). Every value is documented in docs/resources.md.</summary>
/// <param name="AutoRelease">Master switch of the automatic policies (idle sessions, open connections limit).</param>
/// <param name="IdleSessionMinutes">A session without an execution for this long gives back its connection (0 = never).</param>
/// <param name="MemoryLimitMb">Memory limit of the whole app (engine + windows); 0 = auto (25% of RAM, 1–8 GB).</param>
/// <param name="MaxOpenConnections">Connections holding server resources at once; opening one more releases the least recently used idle one (0 = unlimited).</param>
/// <param name="CatalogCacheMb">Budget of the engine's catalog cache (LRU by schema).</param>
/// <param name="ResultCacheMb">Budget of the stored result rows (row paging, full cells, "export loaded rows").</param>
/// <param name="ResultCacheMinutes">Stored rows unread for this long are dropped (0 = never).</param>
/// <param name="ReleaseResultsMinutes">UI: rows of background tabs not viewed for this long are released (0 = never).</param>
/// <param name="ResultRowBudget">UI: rows kept across all result tabs before background ones are released.</param>
/// <param name="TrimUnderPressure">Shorten the timeouts and budgets while memory use is high.</param>
public sealed record ResourcePolicy(
    bool AutoRelease = true,
    int IdleSessionMinutes = ResourcePolicy.DefaultIdleSessionMinutes,
    int MemoryLimitMb = 0,
    int MaxOpenConnections = ResourcePolicy.DefaultMaxOpenConnections,
    int CatalogCacheMb = 128,
    int ResultCacheMb = 256,
    int ResultCacheMinutes = 30,
    int ReleaseResultsMinutes = 10,
    int ResultRowBudget = 500_000,
    bool TrimUnderPressure = true)
{
    public const int DefaultIdleSessionMinutes = 15;
    public const int DefaultMaxOpenConnections = 20;

    internal static readonly (string Key, double Min, double Max)[] Ranges =
    [
        ("idleSessionMinutes", 0, 1440), ("memoryLimitMb", 0, 1_048_576), ("maxOpenConnections", 0, 1000),
        ("catalogCacheMb", 8, 16_384), ("resultCacheMb", 16, 65_536), ("resultCacheMinutes", 0, 1440),
        ("releaseResultsMinutes", 0, 1440), ("resultRowBudget", 10_000, 100_000_000),
    ];

    internal static readonly string[] Toggles = ["autoRelease", "trimUnderPressure"];

    public static JsonObject DefaultsJson()
    {
        var d = new ResourcePolicy();
        return new JsonObject
        {
            ["autoRelease"] = d.AutoRelease,
            ["idleSessionMinutes"] = d.IdleSessionMinutes,
            ["memoryLimitMb"] = d.MemoryLimitMb,
            ["maxOpenConnections"] = d.MaxOpenConnections,
            ["catalogCacheMb"] = d.CatalogCacheMb,
            ["resultCacheMb"] = d.ResultCacheMb,
            ["resultCacheMinutes"] = d.ResultCacheMinutes,
            ["releaseResultsMinutes"] = d.ReleaseResultsMinutes,
            ["resultRowBudget"] = d.ResultRowBudget,
            ["trimUnderPressure"] = d.TrimUnderPressure,
        };
    }

    public static ResourcePolicy From(SettingsService? settings)
    {
        if (settings?.Get()["resources"] is not JsonObject r) return new ResourcePolicy();
        var d = new ResourcePolicy();
        int I(string key, int fallback) => r[key] is { } n ? (int)Math.Clamp(SettingsService.Number(n), 0, int.MaxValue) : fallback;
        bool B(string key, bool fallback) => r[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : fallback;
        return new ResourcePolicy(
            B("autoRelease", d.AutoRelease), I("idleSessionMinutes", d.IdleSessionMinutes), I("memoryLimitMb", d.MemoryLimitMb),
            I("maxOpenConnections", d.MaxOpenConnections), I("catalogCacheMb", d.CatalogCacheMb), I("resultCacheMb", d.ResultCacheMb),
            I("resultCacheMinutes", d.ResultCacheMinutes), I("releaseResultsMinutes", d.ReleaseResultsMinutes),
            I("resultRowBudget", d.ResultRowBudget), B("trimUnderPressure", d.TrimUnderPressure));
    }
}

/// <param name="WorkingSetBytes">Engine process working set.</param>
/// <param name="ManagedHeapBytes">GC heap size after the last collection.</param>
/// <param name="TotalAvailableBytes">Physical memory available to the process (RAM or container limit).</param>
public sealed record MemorySample(long WorkingSetBytes, long ManagedHeapBytes, long TotalAvailableBytes);

/// <summary>Samples the engine's memory (tests substitute fixed numbers).</summary>
public interface IMemoryProbe
{
    MemorySample Sample();
}

public sealed class ProcessMemoryProbe : IMemoryProbe
{
    public MemorySample Sample()
    {
        using var p = Process.GetCurrentProcess();
        var gc = GC.GetGCMemoryInfo();
        return new MemorySample(p.WorkingSet64, gc.HeapSizeBytes, gc.TotalAvailableMemoryBytes);
    }
}

/// <param name="Level">"normal" | "high" | "critical".</param>
/// <param name="AppBytes">Electron processes (main, windows, GPU) as last reported by a window; 0 in browser mode.</param>
/// <param name="UsedBytes">Engine working set + <paramref name="AppBytes"/>.</param>
/// <param name="LimitBytes">Effective memory limit (settings resources.memoryLimitMb, or auto).</param>
public sealed record MemoryInfo(long EngineBytes, long ManagedBytes, long AppBytes, long UsedBytes, long LimitBytes, long TotalBytes, string Level, bool AutoLimit);

/// <param name="Kind">"transaction" | "query" | "export" | "import" | "job" | "stream".</param>
public sealed record ResourceBlocker(string Kind, string Label, string ConnectionId, string? SessionId = null, string? TabId = null,
    string? JobId = null, string? StreamId = null);

/// <summary>What one connection holds (Resources popover row, explorer "connected" dot, close confirmations).</summary>
/// <param name="Connected">Holds server resources: a session with its connection, a source client or a stream.</param>
/// <param name="OpenSessions">Sessions holding a physical connection.</param>
/// <param name="ReleasedSessions">Sessions whose connection was released (reopen on the next run).</param>
public sealed record ConnectionResources(string ConnectionId, string Name, string ProviderId, bool Connected, int Sessions, int OpenSessions,
    int ReleasedSessions, int Streams, bool SourceClient, int Jobs, long CatalogBytes, int CatalogSchemas, DateTimeOffset? LastUsed,
    IReadOnlyList<ResourceBlocker> Blockers);

public sealed record ResourceTotals(int OpenConnections, int Sessions, int OpenSessions, int ReleasedSessions, int Streams, int SourceClients,
    long CatalogBytes, long ResultBytes, long ResultCapBytes);

public sealed record ResourcesSnapshot(MemoryInfo Memory, ResourceTotals Totals, IReadOnlyList<ConnectionResources> Connections, ResourcePolicy Policy);

/// <param name="Sessions">Sessions whose connection was released.</param>
/// <param name="RolledBack">Of those, with a transaction that was rolled back.</param>
/// <param name="Cancelled">Running statements / exports / jobs cancelled.</param>
public sealed record CloseResourcesResult(int Connections, int Sessions, int RolledBack, int Cancelled, int Streams, int SourceClients, long CatalogBytes);

/// <summary>
/// Resources (docs/resources.md). Runs every 30 s: releases idle sessions (never ones with an open transaction, a running
/// statement or temporary objects), reaps idle source clients, trims the catalog cache and the stored results to their
/// budgets, clears pooled catalog connections of connections nobody used for the idle timeout, and watches memory: above
/// the limit the timeouts and budgets shrink and the UI is told (<c>resources.pressure</c>). Opening a connection beyond
/// <c>resources.maxOpenConnections</c> first releases the least recently used idle one (<c>resources.released</c>).
/// </summary>
public sealed class ResourceManager : IAsyncDisposable
{
    public const string LevelNormal = "normal", LevelHigh = "high", LevelCritical = "critical";

    private readonly SessionManager _sessions;
    private readonly CatalogService _catalog;
    private readonly ResultStore _results;
    private readonly ConnectionStore _connections;
    private readonly ProviderRegistry _providers;
    private readonly IEventPublisher _events;
    private readonly SourceClientManager? _clients;
    private readonly StreamManager? _streams;
    private readonly JobManager? _jobs;
    private readonly SettingsService? _settings;
    private readonly ILogger _log;
    private readonly TimeProvider _time;
    private readonly IMemoryProbe _probe;
    private readonly ITimer? _timer;
    private readonly SemaphoreSlim _capacityGate = new(1, 1);
    private readonly ConcurrentDictionary<string, (long Bytes, DateTimeOffset At)> _appReports = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _poolsCleared = new(StringComparer.Ordinal);
    private int _ticking;
    private string _level = LevelNormal;
    private DateTimeOffset _lastCollect = DateTimeOffset.MinValue;
    private bool _disposed;

    /// <summary>A window's memory report counts for this long.</summary>
    public static readonly TimeSpan ReportTtl = TimeSpan.FromMinutes(2);

    /// <param name="interval">Policy period (default 30 s); <see cref="Timeout.InfiniteTimeSpan"/> = only on demand (tests).</param>
    public ResourceManager(SessionManager sessions, CatalogService catalog, ResultStore results, ConnectionStore connections, ProviderRegistry providers,
        IEventPublisher events, SourceClientManager? clients = null, StreamManager? streams = null, JobManager? jobs = null,
        SettingsService? settings = null, ILogger<ResourceManager>? log = null, TimeProvider? time = null, IMemoryProbe? probe = null,
        TimeSpan? interval = null)
    {
        _sessions = sessions;
        _catalog = catalog;
        _results = results;
        _connections = connections;
        _providers = providers;
        _events = events;
        _clients = clients;
        _streams = streams;
        _jobs = jobs;
        _settings = settings;
        _log = log ?? (ILogger)NullLogger.Instance;
        _time = time ?? TimeProvider.System;
        _probe = probe ?? new ProcessMemoryProbe();
        _sessions.BeforeConnect = EnsureCapacityAsync;
        if (_clients is not null) _clients.BeforeConnect = EnsureCapacityAsync;
        var period = interval ?? TimeSpan.FromSeconds(30);
        if (period != Timeout.InfiniteTimeSpan) _timer = _time.CreateTimer(_ => _ = TickAsync(), null, period, period);
    }

    public ResourcePolicy Policy() => ResourcePolicy.From(_settings);

    /// <summary>The pressure level of the last sample.</summary>
    public string Level => Volatile.Read(ref _level);

    // ------------------------------------------------------------------ memory

    /// <summary>A window reports the Electron processes' memory (desktop: app.getAppMetrics). Any one window's report covers the app.</summary>
    public void ReportAppMemory(string? clientId, long appBytes)
    {
        if (appBytes < 0) return;
        _appReports[ClientPresence.Normalize(clientId) ?? "anonymous"] = (appBytes, _time.GetUtcNow());
    }

    /// <summary>Auto memory limit: 25% of the memory available to the process, between 1 and 8 GB.</summary>
    public static long AutoLimitBytes(long totalAvailable)
    {
        const long gb = 1024L * 1024 * 1024;
        if (totalAvailable <= 0) return 2 * gb;
        return Math.Clamp(totalAvailable / 4, gb, 8 * gb);
    }

    public MemoryInfo Memory()
    {
        var sample = _probe.Sample();
        var policy = Policy();
        var now = _time.GetUtcNow();
        long app = 0;
        foreach (var (key, r) in _appReports.ToArray())
        {
            if (now - r.At > ReportTtl) _appReports.TryRemove(key, out _);
            else app = Math.Max(app, r.Bytes);
        }
        var used = sample.WorkingSetBytes + app;
        var limit = policy.MemoryLimitMb > 0 ? policy.MemoryLimitMb * 1024L * 1024 : AutoLimitBytes(sample.TotalAvailableBytes);
        return new MemoryInfo(sample.WorkingSetBytes, sample.ManagedHeapBytes, app, used, limit, sample.TotalAvailableBytes,
            LevelOf(used, limit), policy.MemoryLimitMb <= 0);
    }

    /// <summary>"normal" below 85% of the limit, "high" up to it, "critical" above.</summary>
    public static string LevelOf(long used, long limit) =>
        limit <= 0 ? LevelNormal : used >= limit ? LevelCritical : used >= limit * 0.85 ? LevelHigh : LevelNormal;

    // ------------------------------------------------------------------ policy

    private async Task TickAsync()
    {
        try { await RunPolicyAsync().ConfigureAwait(false); }
        catch (Exception ex) { _log.LogWarning(ex, "Resource policy failed"); }
    }

    /// <summary>One pass of every automatic policy (the timer calls it; tests and POST /resources/trim too). Returns the memory sample it used.</summary>
    /// <param name="aggressive">Act as under critical pressure (Resources popover "Free memory now").</param>
    public async Task<MemoryInfo> RunPolicyAsync(bool aggressive = false)
    {
        if (_disposed) return Memory();
        if (Interlocked.Exchange(ref _ticking, 1) != 0) return Memory();
        try
        {
            var policy = Policy();
            var memory = Memory();
            var level = aggressive ? LevelCritical : policy.TrimUnderPressure ? memory.Level : LevelNormal;
            if (!aggressive && memory.Level != Volatile.Read(ref _level))
            {
                Volatile.Write(ref _level, memory.Level);
                _log.Log(memory.Level == LevelNormal ? LogLevel.Information : LogLevel.Warning,
                    "Memory {Level}: {Used:N0} of {Limit:N0} bytes", memory.Level, memory.UsedBytes, memory.LimitBytes);
                _events.Publish(new ResourcesPressureEvent(memory.Level, memory.UsedBytes, memory.LimitBytes));
            }

            var now = _time.GetUtcNow();
            await ReleaseIdleSessionsAsync(policy, level, now).ConfigureAwait(false);
            if (_clients is not null)
                await _clients.ReapIdleAsync(level switch { LevelCritical => TimeSpan.FromMinutes(1), LevelHigh => TimeSpan.FromMinutes(3), _ => null }).ConfigureAwait(false);

            // Catalog cache: LRU within the budget; under pressure a smaller budget and recently used schemas go too.
            var catalogBudget = policy.CatalogCacheMb * 1024L * 1024 / (level switch { LevelCritical => 4, LevelHigh => 2, _ => 1 });
            _catalog.Trim(catalogBudget, level switch { LevelCritical => TimeSpan.Zero, LevelHigh => TimeSpan.FromMinutes(2), _ => TimeSpan.FromMinutes(10) });

            // Stored result rows: the configured cap, unread ones expire, a smaller target under pressure.
            _results.CapBytes = policy.ResultCacheMb * 1024L * 1024;
            TimeSpan? expiry = policy.ResultCacheMinutes > 0 ? TimeSpan.FromMinutes(policy.ResultCacheMinutes) : null;
            if (level != LevelNormal) expiry = expiry is { } e && e < TimeSpan.FromMinutes(5) ? e : TimeSpan.FromMinutes(level == LevelCritical ? 1 : 5);
            _results.Trim(expiry, level switch { LevelCritical => _results.CapBytes / 4, LevelHigh => _results.CapBytes / 2, _ => null });

            ClearIdlePools(policy, level, now);

            if (level == LevelCritical && now - _lastCollect > TimeSpan.FromMinutes(5))
            {
                _lastCollect = now;
                GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
                GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
            }
            return memory;
        }
        finally
        {
            Interlocked.Exchange(ref _ticking, 0);
        }
    }

    /// <summary>Idle timeout of sessions at a pressure level (null = never).</summary>
    public static TimeSpan? IdleTimeout(ResourcePolicy policy, string level)
    {
        if (!policy.AutoRelease) return null;
        TimeSpan? configured = policy.IdleSessionMinutes > 0 ? TimeSpan.FromMinutes(policy.IdleSessionMinutes) : null;
        return level switch
        {
            LevelCritical => TimeSpan.FromMinutes(1),
            LevelHigh => TimeSpan.FromMinutes(Math.Max(2, Math.Min(configured?.TotalMinutes ?? 5, (configured?.TotalMinutes ?? 15) / 3))),
            _ => configured,
        };
    }

    /// <summary>A session the automatic policies may release: idle, no open transaction, no temporary objects.</summary>
    public static bool IsReleasable(SessionHandle h) =>
        !h.Released && !h.IsReserved && !h.Session.TxOpen && !h.HasTempObjects && h.Session.State is SessionState.Idle or SessionState.Broken;

    private async Task ReleaseIdleSessionsAsync(ResourcePolicy policy, string level, DateTimeOffset now)
    {
        if (IdleTimeout(policy, level) is not { } timeout) return;
        var reason = level == LevelNormal ? "idle" : "pressure";
        var byConnection = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var h in _sessions.List())
        {
            if (!IsReleasable(h) || now - h.LastActivity < timeout) continue;
            if (await _sessions.ReleaseAsync(h, reason).ConfigureAwait(false))
                byConnection[h.Profile.Id] = byConnection.GetValueOrDefault(h.Profile.Id) + 1;
        }
        foreach (var (cid, n) in byConnection)
            _events.Publish(new ResourcesReleasedEvent(cid, NameOf(cid), reason, n, false));
    }

    /// <summary>Pooled catalog connections of connections whose metadata nobody read for the idle timeout (once per idle period).</summary>
    private void ClearIdlePools(ResourcePolicy policy, string level, DateTimeOffset now)
    {
        var idle = IdleTimeout(policy with { AutoRelease = true }, level) ?? TimeSpan.FromMinutes(ResourcePolicy.DefaultIdleSessionMinutes);
        foreach (var cid in _catalog.CachedConnections())
        {
            if (_catalog.LastUsed(cid) is not { } used || now - used < idle) continue;
            if (_poolsCleared.TryGetValue(cid, out var at) && at >= used) continue;
            _poolsCleared[cid] = now;
            ClearPools(cid, null);
        }
    }

    private void ClearPools(string connectionId, string? onlyDatabase)
    {
        try
        {
            if (_connections.Find(connectionId) is not { } profile || _providers.Find(profile.ProviderId) is not { } provider) return;
            var databases = onlyDatabase is not null ? [onlyDatabase] : _catalog.CachedDatabases(connectionId);
            // WP-SSH: the pools are keyed by the tunnelled address; no open tunnel = nothing pooled through it
            if (_connections.CurrentForOpen(profile) is not { } current) return;
            provider.ClearPooledConnections(current, _connections.GetPassword(connectionId), databases);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Clearing the connection pools of {ConnectionId} failed", connectionId);
        }
    }

    // ------------------------------------------------------------------ open connections limit

    /// <summary>Connections holding server resources: a session with its connection, a source client, or a stream.</summary>
    public IReadOnlySet<string> ConnectedConnections()
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var h in _sessions.List()) if (h.HoldsConnection) set.Add(h.Profile.Id);
        if (_clients is not null) foreach (var c in _clients.List()) set.Add(c.ConnectionId);
        if (_streams is not null) foreach (var s in _streams.List()) if (s.ConnectionId != StreamManager.EngineConnectionId) set.Add(s.ConnectionId);
        return set;
    }

    /// <summary>
    /// Before <paramref name="connectionId"/> connects: when <c>resources.maxOpenConnections</c> connections already hold
    /// resources, release the least recently used one that is idle (no transaction, running work, temporary objects,
    /// streams or jobs). When none is idle the new connection opens anyway: the limit never makes a connect fail.
    /// </summary>
    public async Task EnsureCapacityAsync(string connectionId, CancellationToken ct)
    {
        var policy = Policy();
        if (!policy.AutoRelease || policy.MaxOpenConnections <= 0) return;
        await _capacityGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var connected = ConnectedConnections();
            if (connected.Contains(connectionId) || connected.Count < policy.MaxOpenConnections) return;
            var victims = connected
                .Where(cid => cid != connectionId && IsIdleConnection(cid))
                .OrderBy(LastUsed)
                .Take(connected.Count - policy.MaxOpenConnections + 1)
                .ToList();
            foreach (var victim in victims)
            {
                var released = await ReleaseConnectionAsync(victim, null, "limit", force: false, clientId: null).ConfigureAwait(false);
                _log.LogInformation("Open connections limit ({Limit}): released {ConnectionId} to open {Next}", policy.MaxOpenConnections, victim, connectionId);
                _events.Publish(new ResourcesReleasedEvent(victim, NameOf(victim), "limit", released.Sessions, released.SourceClients > 0));
            }
        }
        finally
        {
            _capacityGate.Release();
        }
    }

    private bool IsIdleConnection(string connectionId)
    {
        foreach (var h in _sessions.List())
            if (h.Profile.Id == connectionId && h.HoldsConnection && !IsReleasable(h)) return false;
        if (_streams?.List().Any(s => s.ConnectionId == connectionId) == true) return false;
        if (_clients?.HasLease(connectionId) == true) return false;
        if (_jobs?.List().Any(j => j.ConnectionId == connectionId) == true) return false;
        return true;
    }

    private DateTimeOffset LastUsed(string connectionId)
    {
        var last = DateTimeOffset.MinValue;
        foreach (var h in _sessions.List()) if (h.Profile.Id == connectionId && h.LastActivity > last) last = h.LastActivity;
        if (_clients?.Info(connectionId) is { } c && c.LastUsed > last) last = c.LastUsed;
        return last;
    }

    // ------------------------------------------------------------------ inspection

    private string NameOf(string connectionId) => _connections.Find(connectionId)?.Name ?? connectionId;

    /// <summary>The session belongs to the requesting window: it owns it, the owner is gone, or nobody owns it (API callers).</summary>
    private static bool InScope(SessionHandle h, string? clientId)
    {
        var requester = ClientPresence.Normalize(clientId);
        if (requester is null || h.OwnerClientId is null) return true;
        return h.OwnerClientId == requester || h.Orphan;
    }

    private static bool OnDatabase(SessionHandle h, string? database) =>
        database is null || string.Equals(h.Released ? h.Options.Database : h.Session.CurrentDatabase ?? h.Options.Database, database, StringComparison.OrdinalIgnoreCase);

    /// <summary>What closing would interrupt: open transactions, running statements / exports, jobs (imports...) and streams.</summary>
    public IReadOnlyList<ResourceBlocker> Blockers(string connectionId, string? database, string? clientId)
    {
        var list = new List<ResourceBlocker>();
        foreach (var h in _sessions.List())
        {
            if (h.Profile.Id != connectionId || !InScope(h, clientId) || !OnDatabase(h, database)) continue;
            if (h.IsRunning)
            {
                var kind = h.ActiveOperation?.StartsWith("e_", StringComparison.Ordinal) == true ? "export" : "query";
                list.Add(new ResourceBlocker(kind, $"{h.DisplayName} — {(kind == "export" ? "running export" : "running query")}", connectionId, h.Id, h.TabId));
            }
            if (!h.Released && h.Session.TxOpen)
                list.Add(new ResourceBlocker("transaction", $"{h.DisplayName} — uncommitted transaction", connectionId, h.Id, h.TabId));
        }
        if (database is null)
        {
            foreach (var j in _jobs?.List() ?? [])
            {
                if (j.ConnectionId != connectionId) continue;
                var import = j.Kind.Contains("import", StringComparison.OrdinalIgnoreCase);
                list.Add(new ResourceBlocker(import ? "import" : "job", import ? "Import in progress" : $"Running {j.Kind}", connectionId, JobId: j.JobId));
            }
            foreach (var s in _streams?.List() ?? [])
                if (s.ConnectionId == connectionId) list.Add(new ResourceBlocker("stream", $"Live stream ({s.Kind})", connectionId, StreamId: s.StreamId));
        }
        return list;
    }

    public ConnectionResources Describe(string connectionId, string? database = null, string? clientId = null)
    {
        var profile = _connections.Find(connectionId);
        var sessions = _sessions.List().Where(h => h.Profile.Id == connectionId && OnDatabase(h, database)).ToList();
        var open = sessions.Count(h => h.HoldsConnection);
        var streams = database is null ? _streams?.List().Count(s => s.ConnectionId == connectionId) ?? 0 : 0;
        var client = database is null && _clients?.Peek(connectionId) is not null;
        var jobs = database is null ? _jobs?.List().Count(j => j.ConnectionId == connectionId) ?? 0 : 0;
        var (bytes, schemas, _) = _catalog.Stats(connectionId);
        var last = LastUsed(connectionId);
        return new ConnectionResources(connectionId, profile?.Name ?? connectionId, profile?.ProviderId ?? "", open > 0 || streams > 0 || client,
            sessions.Count, open, sessions.Count(h => h.Released), streams, client, jobs, bytes, schemas,
            last == DateTimeOffset.MinValue ? null : last, Blockers(connectionId, database, clientId));
    }

    public ResourcesSnapshot Snapshot(string? clientId = null)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var h in _sessions.List()) ids.Add(h.Profile.Id);
        foreach (var cid in _catalog.CachedConnections()) ids.Add(cid);
        foreach (var cid in ConnectedConnections()) ids.Add(cid);
        foreach (var j in _jobs?.List() ?? []) if (j.ConnectionId is { } cid) ids.Add(cid);
        var rows = ids.Where(cid => _connections.Find(cid) is not null).Select(cid => Describe(cid, null, clientId))
            .OrderByDescending(r => r.Connected).ThenByDescending(r => r.LastUsed).ThenBy(r => r.Name, StringComparer.OrdinalIgnoreCase).ToList();
        var sessions = _sessions.List();
        var totals = new ResourceTotals(rows.Count(r => r.Connected), sessions.Count, sessions.Count(h => h.HoldsConnection), sessions.Count(h => h.Released),
            rows.Sum(r => r.Streams), rows.Count(r => r.SourceClient), rows.Sum(r => r.CatalogBytes), _results.TotalBytes, _results.CapBytes);
        return new ResourcesSnapshot(Memory(), totals, rows, Policy());
    }

    // ------------------------------------------------------------------ manual close (explorer, Disconnect all)

    /// <summary>
    /// Explorer "Close connection" (<paramref name="database"/> null) / "Close database": releases the sessions of the
    /// requesting window (their tabs reconnect on the next run), and for the whole connection also closes its streams,
    /// source client and jobs, drops its catalog cache and clears its pooled connections. Without <paramref name="force"/>
    /// 409 RESOURCE_BUSY lists what would be interrupted (detail.blockers); with it transactions roll back and running
    /// work is cancelled.
    /// </summary>
    public async Task<CloseResourcesResult> CloseAsync(string connectionId, string? database, bool force, string? clientId)
    {
        _connections.Get(connectionId); // 404
        var blockers = Blockers(connectionId, database, clientId);
        if (blockers.Count > 0 && !force)
            throw new EngineException(409, ErrorCodes.ResourceBusy,
                $"Closing would interrupt {blockers.Count} item(s): {string.Join("; ", blockers.Select(b => b.Label))}.", new { blockers });
        return await ReleaseConnectionAsync(connectionId, database, "closed", force, clientId).ConfigureAwait(false);
    }

    /// <summary>"Disconnect all": every connection holding resources or cached metadata. 409 RESOURCE_BUSY lists all blockers.</summary>
    public async Task<CloseResourcesResult> CloseAllAsync(bool force, string? clientId)
    {
        var ids = new HashSet<string>(ConnectedConnections(), StringComparer.Ordinal);
        foreach (var cid in _catalog.CachedConnections()) ids.Add(cid);
        foreach (var h in _sessions.List()) if (InScope(h, clientId)) ids.Add(h.Profile.Id);
        var known = ids.Where(cid => _connections.Find(cid) is not null).ToList();
        var blockers = known.SelectMany(cid => Blockers(cid, null, clientId).Select(b => b with { Label = $"{NameOf(cid)}: {b.Label}" })).ToList();
        if (blockers.Count > 0 && !force)
            throw new EngineException(409, ErrorCodes.ResourceBusy,
                $"Disconnecting would interrupt {blockers.Count} item(s): {string.Join("; ", blockers.Select(b => b.Label))}.", new { blockers });
        var total = new CloseResourcesResult(0, 0, 0, 0, 0, 0, 0);
        foreach (var cid in known)
        {
            var r = await ReleaseConnectionAsync(cid, null, "closed", force, clientId).ConfigureAwait(false);
            total = new CloseResourcesResult(total.Connections + 1, total.Sessions + r.Sessions, total.RolledBack + r.RolledBack, total.Cancelled + r.Cancelled,
                total.Streams + r.Streams, total.SourceClients + r.SourceClients, total.CatalogBytes + r.CatalogBytes);
        }
        return total;
    }

    private async Task<CloseResourcesResult> ReleaseConnectionAsync(string connectionId, string? database, string reason, bool force, string? clientId)
    {
        var automatic = reason is not "closed";
        var scope = _sessions.List().Where(h => h.Profile.Id == connectionId && (automatic || InScope(h, clientId)) && OnDatabase(h, database)).ToList();
        var cancelled = 0;
        if (force)
        {
            foreach (var h in scope.Where(h => h.IsRunning))
            {
                h.Session.Cancel();
                cancelled++;
            }
            if (database is null)
                foreach (var j in _jobs?.List() ?? [])
                    if (j.ConnectionId == connectionId && _jobs!.Cancel(j.JobId)) cancelled++;
            // Give cancelled statements a moment to end so their sessions can be released.
            var deadline = _time.GetUtcNow() + TimeSpan.FromSeconds(5);
            while (scope.Any(h => h.IsRunning) && _time.GetUtcNow() < deadline)
                await Task.Delay(50).ConfigureAwait(false);
        }
        var sessions = 0;
        var rolledBack = 0;
        foreach (var h in scope)
        {
            if (automatic && !IsReleasable(h)) continue;
            var hadTx = !h.Released && h.Session.TxOpen;
            if (await _sessions.ReleaseAsync(h, reason, force).ConfigureAwait(false))
            {
                sessions++;
                if (hadTx) rolledBack++;
            }
        }
        var streams = 0;
        var clients = 0;
        long catalogBytes = 0;
        if (database is null)
        {
            if (!automatic && _streams is not null) streams = await _streams.CloseForConnectionAsync(connectionId, "connection closed").ConfigureAwait(false);
            if (_clients is not null && (!automatic || !_clients.HasLease(connectionId)) && await _clients.CloseAsync(connectionId, automatic ? reason : "connection closed").ConfigureAwait(false))
                clients++;
            if (!automatic)
            {
                ClearPools(connectionId, null);
                catalogBytes = _catalog.Stats(connectionId).Bytes;
                _catalog.Forget(connectionId);
            }
            else
            {
                ClearPools(connectionId, null);
            }
        }
        else if (!automatic)
        {
            ClearPools(connectionId, database);
            catalogBytes = _catalog.ForgetDatabase(connectionId, database);
        }
        if (!automatic)
            _log.LogInformation("Closed {ConnectionId}{Database}: {Sessions} session(s) released ({RolledBack} rolled back), {Cancelled} cancelled, {Streams} stream(s), {Bytes:N0} catalog bytes",
                connectionId, database is null ? "" : "/" + database, sessions, rolledBack, cancelled, streams, catalogBytes);
        return new CloseResourcesResult(1, sessions, rolledBack, cancelled, streams, clients, catalogBytes);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        if (_timer is not null) await _timer.DisposeAsync().ConfigureAwait(false);
        if (_sessions.BeforeConnect == EnsureCapacityAsync) _sessions.BeforeConnect = null;
    }
}
