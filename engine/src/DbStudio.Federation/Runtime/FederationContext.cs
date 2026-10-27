using System.Collections.Concurrent;
using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Engine;
using DbStudio.Federation.Pushdown;

namespace DbStudio.Federation.Runtime;

/// <summary>A source table held in a context's engine: what was fetched, when, and how.</summary>
internal sealed record CachedSource(FetchRequest Request, DateTimeOffset FetchedAt, long Rows, bool Truncated, string SourceQuery, long ElapsedMs,
    long ConversionFailures);

/// <summary>Messages a prepare emits (the console prints them).</summary>
internal delegate ValueTask PrepareMessage(MessageSeverity severity, string text);

/// <summary>
/// One federation engine with its fetched sources: the state of a federated console session (or of one materialize /
/// preview query). <see cref="PrepareAsync"/> analyses a statement and makes sure every mounted table it reads is in the
/// engine with the columns and rows the statement needs (fetching in parallel, reusing the cache); the caller then runs
/// the statement on the engine. Prepares are serialized (<see cref="Gate"/>).
/// </summary>
internal sealed class FederationContext : IAsyncDisposable
{
    private readonly LinkRuntime _runtime;
    private readonly ConcurrentDictionary<string, CachedSource> _cache = new(StringComparer.OrdinalIgnoreCase);
    private int _disposed;

    public FederationContext(LinkRuntime runtime, string linkId, string id, IFederationEngine engine, FederationLimits limits, string? engineWarning)
    {
        _runtime = runtime;
        LinkId = linkId;
        Id = id;
        Engine = engine;
        Internals = (IFederationEngineInternals)engine;
        Limits = limits;
        EngineWarning = engineWarning;
    }

    public string LinkId { get; }

    /// <summary>Session id (console) or a one-off query id.</summary>
    public string Id { get; }

    public IFederationEngine Engine { get; }
    public IFederationEngineInternals Internals { get; }
    public FederationLimits Limits { get; }

    /// <summary>Why the SQLite fallback runs (DuckDB unavailable), else null.</summary>
    public string? EngineWarning { get; }

    public SemaphoreSlim Gate { get; } = new(1, 1);

    /// <summary>The plan of the last prepared statement.</summary>
    public PushdownPlan? LastPlan { get; private set; }

    public IReadOnlyDictionary<string, CachedSource> Cache => _cache;

    /// <summary>Drops cached tables (null = all). Returns how many were dropped.</summary>
    public async Task<int> InvalidateAsync(IReadOnlyList<LinkTableRef>? tables, CancellationToken ct)
    {
        await Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var keys = tables is null
                ? _cache.Keys.ToList()
                : tables.Select(t => t.ToString()).Where(k => _cache.ContainsKey(k)).ToList();
            foreach (var key in keys)
            {
                if (!_cache.TryRemove(key, out _)) continue;
                var dot = key.IndexOf('.');
                try { await Engine.DropTableAsync(key[..dot], key[(dot + 1)..], ct).ConfigureAwait(false); }
                catch (Exception e) when (e is not OperationCanceledException) { /* the table is replaced on the next fetch anyway */ }
            }
            return keys.Count;
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>
    /// Analyses <paramref name="sql"/> and fetches what it reads (under <see cref="Gate"/>). Fetch failures throw
    /// <see cref="FetchException"/> (or <see cref="EngineException"/> for an unusable member); cancellation cancels every
    /// running fetch and throws <see cref="OperationCanceledException"/>.
    /// </summary>
    /// <param name="allColumns">Fetch whole tables (retry after the engine reported a column the projection missed).</param>
    /// <param name="maxRowsOverride">"Fetch all" / a materialize cap; null = the limits.</param>
    public async Task<PushdownPlan> PrepareAsync(string sql, bool allColumns, long? maxRowsOverride, IProgress<LinkFetchProgress>? progress,
        PrepareMessage? message, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        await Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var planned = await _runtime.PlanFetchesAsync(this, sql, allColumns, maxRowsOverride, ct).ConfigureAwait(false);
            var sources = new SourceFetchPlan[planned.Fetches.Count];
            var warnings = new List<PlanWarning>(planned.Warnings);
            var messages = new ConcurrentQueue<(int Order, MessageSeverity Severity, string Text)>();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var throttle = new SemaphoreSlim(Math.Max(1, LinkRuntime.MaxParallelFetches), Math.Max(1, LinkRuntime.MaxParallelFetches));
            var tasks = planned.Fetches.Select((f, index) => Task.Run(async () =>
            {
                await throttle.WaitAsync(cts.Token).ConfigureAwait(false);
                try
                {
                    sources[index] = await FetchOneAsync(f, progress, messages, index, cts.Token).ConfigureAwait(false);
                }
                catch
                {
                    // one failing source stops the others (the query cannot run without it)
                    try { await cts.CancelAsync().ConfigureAwait(false); } catch (ObjectDisposedException) { }
                    throw;
                }
                finally
                {
                    throttle.Release();
                }
            }, CancellationToken.None)).ToList();
            try
            {
                await Task.WhenAll(tasks).ConfigureAwait(false);
            }
            catch
            {
                ct.ThrowIfCancellationRequested();
                // the first real failure (not the cancellations it caused)
                var failure = tasks.Where(t => t.IsFaulted).Select(t => t.Exception!.GetBaseException()).FirstOrDefault(e => e is not OperationCanceledException);
                if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
                throw;
            }

            foreach (var s in sources)
            {
                if (s.Truncated == true && !planned.Sampled)
                    warnings.Add(new PlanWarning(PlanWarningCodes.RowCap,
                        $"{s.Table}: only the first {s.MaxRows.ToString("N0", CultureInfo.InvariantCulture)} rows were read (links.maxRowsPerSource); results may be incomplete.", s.Table));
                if (s.Cached)
                    warnings.Add(new PlanWarning(PlanWarningCodes.Cached,
                        $"{s.Table}: served from the session cache (fetched {s.FetchedAt?.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture)}); use Refresh sources for current data.", s.Table));
            }
            foreach (var f in planned.Fetches.Where((f, i) => _cache.TryGetValue(f.Table.ToString(), out var c) && c.ConversionFailures > 0 && !sources[i].Cached))
            {
                var c = _cache[f.Table.ToString()];
                warnings.Add(new PlanWarning(PlanWarningCodes.Conversion,
                    $"{f.Table}: {c.ConversionFailures.ToString("N0", CultureInfo.InvariantCulture)} value(s) could not be converted and were read as NULL.", f.Table));
            }

            if (planned.Sampled && sources.Any(s => s.Truncated == true))
                warnings.Add(new PlanWarning(PlanWarningCodes.Cached,
                    $"EXPLAIN read only the first {ExplainSql.SampleRows.ToString("N0", CultureInfo.InvariantCulture)} rows of each source to build the plan, so the row estimates in it are not the sources'. EXPLAIN ANALYZE runs the query for real.", null));
            if (message is not null)
            {
                foreach (var m in messages.OrderBy(m => m.Order)) await message(m.Severity, m.Text).ConfigureAwait(false);
                foreach (var w in warnings) await message(w.Code == PlanWarningCodes.Cached ? MessageSeverity.Info : MessageSeverity.Warning, w.Message).ConfigureAwait(false);
            }

            var plan = new PushdownPlan(Engine.Name, planned.Parsed, sources, warnings);
            LastPlan = plan;
            return plan;
        }
        finally
        {
            Gate.Release();
        }
    }

    private async Task<SourceFetchPlan> FetchOneAsync(PlannedFetch f, IProgress<LinkFetchProgress>? progress,
        ConcurrentQueue<(int, MessageSeverity, string)> messages, int order, CancellationToken ct)
    {
        var key = f.Table.ToString();
        var request = f.Request;
        if (Limits.CacheSources && _cache.TryGetValue(key, out var cached) && Reusable(cached, request))
        {
            messages.Enqueue((order, MessageSeverity.Info,
                $"{f.Table}: {cached.Rows.ToString("N0", CultureInfo.InvariantCulture)} rows from the session cache."));
            progress?.Report(new LinkFetchProgress(f.Table, cached.Rows, true));
            return Plan(f, cached.Request, cached.SourceQuery, cached.Rows, cached.Truncated, true, cached.FetchedAt, cached.ElapsedMs);
        }

        // Widen to what the cached copy already had, so switching between queries does not refetch back and forth.
        if (Limits.CacheSources && _cache.TryGetValue(key, out var previous) && !previous.Truncated)
        {
            var union = request.Columns.Concat(previous.Request.Columns.Where(c => !request.Columns.Contains(c, StringComparer.OrdinalIgnoreCase)))
                .Where(c => request.Table.Columns.Any(sc => string.Equals(sc.Name, c, StringComparison.OrdinalIgnoreCase)))
                .ToList();
            var ordered = request.Table.Columns.Where(sc => union.Contains(sc.Name, StringComparer.OrdinalIgnoreCase)).Select(sc => sc.Name).ToList();
            request = request with { Columns = ordered };
        }

        var columns = request.Columns.Select(name =>
        {
            var sc = request.Table.Columns.First(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
            return TypeMap.ToEngine(sc, out _);
        }).ToList();
        _cache.TryRemove(key, out _);
        await Engine.CreateTableAsync(f.Table.Alias, f.Table.Table, columns, replace: true, ct).ConfigureAwait(false);
        FetchResult result;
        var appender = Engine.OpenAppender(f.Table.Alias, f.Table.Table, columns);
        try
        {
            var rowsProgress = progress is null ? null : new Progress<long>(n => progress.Report(new LinkFetchProgress(f.Table, n, false)));
            result = await f.Fetcher.FetchAsync(f.Context, request, appender, rowsProgress, ct).ConfigureAwait(false);
            appender.Dispose();
        }
        catch
        {
            try { appender.Dispose(); } catch { /* the table is dropped */ }
            try { await Engine.DropTableAsync(f.Table.Alias, f.Table.Table, CancellationToken.None).ConfigureAwait(false); } catch { /* best effort */ }
            throw;
        }
        var entry = new CachedSource(request, DateTimeOffset.UtcNow, result.Rows, result.Truncated, result.SourceQuery, result.ElapsedMs, result.ConversionFailures);
        _cache[key] = entry;
        progress?.Report(new LinkFetchProgress(f.Table, result.Rows, true));
        var from = f.ProviderName is { Length: > 0 } p ? $" from {p}" : "";
        messages.Enqueue((order, MessageSeverity.Info,
            $"{f.Table}: {result.Rows.ToString("N0", CultureInfo.InvariantCulture)} rows{from} in {result.ElapsedMs.ToString("N0", CultureInfo.InvariantCulture)} ms."));
        if (result.Warnings is { Count: > 0 } ws)
            foreach (var w in ws) messages.Enqueue((order, MessageSeverity.Warning, $"{f.Table}: {w}"));
        return Plan(f, request, result.SourceQuery, result.Rows, result.Truncated, false, entry.FetchedAt, result.ElapsedMs);
    }

    private static SourceFetchPlan Plan(PlannedFetch f, FetchRequest r, string sourceQuery, long rows, bool truncated, bool cached, DateTimeOffset at, long ms) =>
        new(f.Table, f.ConnectionId, f.ProviderId, sourceQuery, r.Columns, r.Predicates, r.Limit, r.MaxRows, rows, truncated, cached, at, ms);

    /// <summary>
    /// The cached copy serves <paramref name="want"/> when it has every column, no predicate <paramref name="want"/> lacks
    /// (so it holds a superset of the rows) and was not cut short (a limit or the row cap) differently.
    /// </summary>
    internal static bool Reusable(CachedSource cached, FetchRequest want)
    {
        var have = cached.Request;
        if (!want.Columns.All(c => have.Columns.Contains(c, StringComparer.OrdinalIgnoreCase))) return false;
        var haveKeys = have.Predicates.Select(PredicateKey).ToHashSet(StringComparer.Ordinal);
        var wantKeys = want.Predicates.Select(PredicateKey).ToHashSet(StringComparer.Ordinal);
        if (!haveKeys.IsSubsetOf(wantKeys)) return false;
        var samePredicates = haveKeys.SetEquals(wantKeys);
        if (cached.Truncated) return samePredicates && have.Limit == want.Limit && have.MaxRows == want.MaxRows;
        if (have.Limit is { } hl) return samePredicates && want.Limit is { } wl && wl <= hl;
        return true;
    }

    internal static string PredicateKey(PushdownPredicate p) =>
        p.Column.ToUpperInvariant() + "\u0001" + p.Op + "\u0001" + string.Join("\u0002", p.Values.Select(v => v.Kind + ":" + v.Value));

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _runtime.Unregister(this);
        _cache.Clear();
        await Engine.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>One mounted table a statement reads: the accepted request and where it goes.</summary>
internal sealed record PlannedFetch(LinkTableRef Table, string? ConnectionId, string ProviderId, string? ProviderName, ISourceFetcher Fetcher,
    SourceContext Context, FetchRequest Request);

/// <summary>The fetches of one statement plus the analyzer's warnings.</summary>
/// <param name="Sampled">A plain EXPLAIN: only a sample of each source is read (the plan needs no data), so the row cap is no warning.</param>
internal sealed record PlannedFetches(bool Parsed, IReadOnlyList<PlannedFetch> Fetches, IReadOnlyList<PlanWarning> Warnings, string? SyntaxError, bool Sampled = false);
