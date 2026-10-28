using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Threading.Channels;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.DataCompare;

/// <summary>A column of one side as read from the catalog (tables) or from a zero-row execution (queries).</summary>
internal sealed record SideColumn(string Name, string TypeText, CanonType Canon, bool Nullable, bool IsPk, bool Identity, bool Computed, bool Generated);

/// <summary>One side, resolved: connection (through the SSH resolver), dialect, location and columns.</summary>
internal sealed class SideMeta
{
    public required string Role { get; init; }
    public required DataCompareSide Spec { get; init; }
    public required TransferConnection Conn { get; init; }
    public required string? Database { get; init; }
    public required string? Schema { get; init; }
    public required List<SideColumn> Columns { get; init; }
    public required List<string> PrimaryKey { get; init; }
    public required string Label { get; init; }

    public Dialect Dialect => Conn.Provider.Dialect;
    public bool IsQuery => Spec.IsQuery;
    public string From => IsQuery ? DataCompareSql.QueryFrom(Spec.Query!) : TransferSql.Qualified(Dialect, Schema, Spec.Table!);
}

/// <summary>A column both sides have, in the order of the compared rows.</summary>
internal sealed record PairColumn(string Name, SideColumn Source, SideColumn Target, ValueFamily Family, bool Padded, bool IsKey, bool Compared);

/// <summary>What a comparison reads and how it matches rows.</summary>
internal sealed class ComparePlan
{
    public required SideMeta Source { get; init; }
    public required SideMeta Target { get; init; }
    public required DataCompareOptions Options { get; init; }
    /// <summary>Every column both sides have (also preview-only info for the others in <see cref="Preview"/>).</summary>
    public required List<PairColumn> Columns { get; init; }
    public required List<DataCompareColumnInfo> Preview { get; init; }
    public required List<string> DefaultKey { get; init; }
    public required List<string> Notes { get; init; }

    public int[] KeyIndex => Columns.Select((c, i) => (c, i)).Where(x => x.c.IsKey).Select(x => x.i).ToArray();

    public KeyComparer Keys()
    {
        var keys = Columns.Where(c => c.IsKey).ToList();
        return new KeyComparer(keys.Select(k => k.Family).ToList(), keys.Select(k => k.Padded).ToList(), KeyIndex);
    }

    public List<ComparedColumn> Compared() =>
        Columns.Select((c, i) => (c, i)).Where(x => x.c.Compared && !x.c.IsKey).Select(x => new ComparedColumn(x.i, x.c.Family, x.c.Padded)).ToList();

    /// <summary>Whether both servers can produce the key order the comparer expects.</summary>
    public string? ServerOrderBlocker()
    {
        if (!DataCompareSql.CanOrder(Source.Dialect) || !DataCompareSql.CanOrder(Target.Dialect)) return "one side cannot sort its rows on the server";
        foreach (var k in Columns.Where(c => c.IsKey))
        {
            if (!ValueFamilies.ServerOrderable(k.Family)) return $"the key column {k.Name} cannot be sorted on the server";
            if (ValueFamilies.OrderGroup(ValueFamilies.Of(k.Source.Canon)) != ValueFamilies.OrderGroup(ValueFamilies.Of(k.Target.Canon)))
                return $"the key column {k.Name} has different kinds of types on the two sides";
        }
        return null;
    }

    public DataSyncSupport Sync()
    {
        static (bool Ok, string? Why) Can(SideMeta s)
        {
            if (s.IsQuery) return (false, $"The {s.Role} is a query: only tables can be synchronized.");
            if (!SyncScriptBuilder.CanWrite(s.Dialect)) return (false, $"Rows cannot be synchronized into {s.Conn.Provider.DisplayName}.");
            return (true, null);
        }
        var t = Can(Target);
        var s = Can(Source);
        return new DataSyncSupport(t.Ok, s.Ok, t.Why, s.Why, t.Ok && !Target.Conn.Profile.ReadOnly, s.Ok && !Source.Conn.Profile.ReadOnly);
    }
}

/// <summary>A finished comparison, kept so the grid pages, the script and the apply work on the same differences.</summary>
internal sealed class DataComparison
{
    public required string Id { get; init; }
    public required ComparePlan Plan { get; init; }
    public required List<DataDiffRow> Diffs { get; init; }
    public required DataCompareCounts Counts { get; init; }
    public required bool Truncated { get; init; }
    public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
}

/// <summary>The last few comparisons (each holds its kept differences in memory).</summary>
internal sealed class DataCompareStore
{
    private const int Capacity = 6;
    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(3);
    private readonly ConcurrentDictionary<string, DataComparison> _items = new(StringComparer.Ordinal);

    public void Add(DataComparison c)
    {
        _items[c.Id] = c;
        foreach (var id in _items.Values.Where(m => DateTimeOffset.UtcNow - m.CreatedAt > MaxAge).Select(m => m.Id).ToList()) _items.TryRemove(id, out _);
        foreach (var old in _items.Values.OrderByDescending(m => m.CreatedAt).Skip(Capacity).ToList()) _items.TryRemove(old.Id, out _);
    }

    public DataComparison Get(string id) => _items.TryGetValue(id, out var c) ? c
        : throw new EngineException(404, ErrorCodes.NotFound, "This comparison is no longer available (the engine keeps the last few). Compare again.");

    public void Remove(string id) => _items.TryRemove(id, out _);
}

/// <summary>
/// Data compare &amp; sync: compares the rows of two tables (or queries) of any two relational connections. Both sides are
/// read ordered by the key and merge-joined in one pass (<see cref="MergeJoin"/>); when the servers cannot produce the same
/// order (different collations, CQL, mixed key types) or a side breaks it, the rows are sorted in the engine instead (up to
/// <see cref="DataCompareLimits.MaxEngineSortedRows"/> per side). Only the differences are kept (capped); the sync script
/// writes them as DELETE / UPDATE / INSERT for either side with WP-3's literal rendering.
/// </summary>
public sealed class DataCompareService(ITransferEnvironment env, JobManager? jobs = null, ILogger<DataCompareService>? log = null)
{
    public const string CompareJobKind = "data.compare";
    public const string SyncJobKind = "data.sync";
    public const int SamplePerClass = 100;
    private const int StatementsPerRoundTrip = 20;

    private readonly ILogger _log = log ?? (ILogger)NullLogger.Instance;
    private readonly DataCompareStore _store = new();

    // ------------------------------------------------------------------ preview

    /// <summary><c>POST /data-compare/columns</c>: the columns of both sides, the default key and what can be synchronized.</summary>
    public async Task<DataComparePreview> PreviewAsync(DataCompareRequest? request, CancellationToken ct)
    {
        var plan = await PlanAsync(request, requireKey: false, ct).ConfigureAwait(false);
        return new DataComparePreview(plan.Preview, plan.DefaultKey, CoreJson.ToWire(plan.Source.Dialect), CoreJson.ToWire(plan.Target.Dialect),
            plan.Source.Label, plan.Target.Label, plan.Sync(), plan.Notes);
    }

    // ------------------------------------------------------------------ compare

    /// <summary>Validates the request and starts the <c>data.compare</c> job; returns the job id.</summary>
    public string Start(DataCompareRequest? request, string? clientId)
    {
        Validate(request);
        var jm = jobs ?? throw new InvalidOperationException("No job manager.");
        return jm.Start(CompareJobKind, request!.Target.ConnectionId, clientId, async (job, ct) =>
            await CompareAsync(request, (p, done) => job.Report(done, null, JsonSerializer.Serialize(p, CoreJson.Options), p.Phase != "reading"), ct).ConfigureAwait(false));
    }

    /// <summary>Runs a comparison in the caller's task (tests, embedding).</summary>
    public async Task<DataCompareResult> CompareAsync(DataCompareRequest? request, Action<DataCompareProgress, long>? progress, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        progress?.Invoke(new DataCompareProgress("preparing", 0, 0, 0, "Reading the columns"), 0);
        var plan = await PlanAsync(request, requireKey: true, ct).ConfigureAwait(false);
        var ordering = plan.Options.Ordering ?? DataOrderings.Auto;
        var blocker = plan.ServerOrderBlocker();
        var notes = new List<string>(plan.Notes);
        if (ordering == DataOrderings.Server && blocker is not null)
            throw EngineException.Validation($"The servers cannot sort the rows the same way: {blocker}. Use the engine ordering.", new { field = "options.ordering" });

        var engine = ordering == DataOrderings.Engine || blocker is not null;
        if (blocker is not null && ordering == DataOrderings.Auto) notes.Add($"Rows were sorted by the engine: {blocker}.");
        CollectSink sink;
        try
        {
            sink = await RunMergeAsync(plan, engine, progress, ct).ConfigureAwait(false);
        }
        catch (OrderViolationException ex) when (!engine && ordering == DataOrderings.Auto)
        {
            _log.LogInformation("Data compare: {Message} Sorting in the engine.", ex.Message);
            notes.Add($"Rows were sorted by the engine: the {ex.Side} server's order of the key differs from the other side's (collation).");
            engine = true;
            sink = await RunMergeAsync(plan, true, progress, ct).ConfigureAwait(false);
        }
        catch (OrderViolationException ex)
        {
            throw EngineException.Validation($"{ex.Message} The servers sort the key differently: compare with the engine ordering.", new { field = "options.ordering" });
        }

        if (sink.Counts.Duplicate > 0)
            notes.Add($"{sink.Counts.Duplicate} rows share their key with another row on the same side: they cannot be matched and are never synchronized.");
        var comparison = new DataComparison
        {
            Id = Ids.New("dcmp"), Plan = plan, Diffs = sink.Diffs, Counts = sink.Counts, Truncated = sink.Truncated,
        };
        _store.Add(comparison);
        progress?.Invoke(new DataCompareProgress("done", sink.SourceRows, sink.TargetRows, sink.Counts.Differences, null), sink.SourceRows + sink.TargetRows);
        return new DataCompareResult(comparison.Id, sink.Counts, WireColumns(plan), plan.Columns.Where(c => c.IsKey).Select(c => c.Name).ToList(),
            sink.Sample, sink.Diffs.Count, sink.Truncated, engine ? DataOrderings.Engine : DataOrderings.Server, sink.SourceRows, sink.TargetRows,
            plan.Source.Label, plan.Target.Label, CoreJson.ToWire(plan.Source.Dialect), CoreJson.ToWire(plan.Target.Dialect), plan.Sync(), notes,
            sw.ElapsedMilliseconds);
    }

    private static List<DataCompareColumn> WireColumns(ComparePlan plan) =>
        plan.Columns.Select(c => new DataCompareColumn(c.Name, c.Source.TypeText, c.Target.TypeText, c.IsKey, c.Compared, ValueFamilies.Wire(c.Family))).ToList();

    private async Task<CollectSink> RunMergeAsync(ComparePlan plan, bool engineOrder, Action<DataCompareProgress, long>? progress, CancellationToken ct)
    {
        var keys = plan.Keys();
        var sink = new CollectSink(Math.Clamp(plan.Options.MaxDifferences, 1, DataCompareLimits.MaxDifferences));
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        await using var srcSession = await OpenAsync(plan.Source, cts.Token).ConfigureAwait(false);
        await using var tgtSession = await OpenAsync(plan.Target, cts.Token).ConfigureAwait(false);
        var srcSql = SelectSql(plan, plan.Source, engineOrder);
        var tgtSql = SelectSql(plan, plan.Target, engineOrder);
        var lastReport = 0L;
        void Report(string phase, bool force)
        {
            if (progress is null) return;
            var now = Environment.TickCount64;
            if (!force && now - lastReport < 150) return;
            lastReport = now;
            progress(new DataCompareProgress(phase, sink.SourceRows, sink.TargetRows, sink.Counts.Differences,
                phase == "sorting" ? "Sorting the rows" : null), sink.SourceRows + sink.TargetRows);
        }

        await using var src = StreamingSource.Start(srcSession, srcSql, plan.Source.Role, cts.Token);
        await using var tgt = StreamingSource.Start(tgtSession, tgtSql, plan.Target.Role, cts.Token);
        try
        {
            IRowSource a, b;
            if (engineOrder)
            {
                Report("reading", true);
                var counting = 0L;
                async Task<List<object?[]>> LoadAsync(StreamingSource s, bool isSource)
                {
                    var rows = new List<object?[]>();
                    while (await s.NextAsync(cts.Token).ConfigureAwait(false) is { } r)
                    {
                        rows.Add(r);
                        if (rows.Count > DataCompareLimits.MaxEngineSortedRows)
                            throw EngineException.Validation($"The {s.Role} has more than {DataCompareLimits.MaxEngineSortedRows:N0} rows: too many to sort in the engine. Compare a filtered part, or tables whose key both servers sort the same way.");
                        if (isSource) sink.SourceRows++; else sink.TargetRows++;
                        if ((++counting & 1023) == 0) lock (sink) Report("reading", false);
                    }
                    return rows;
                }
                var la = LoadAsync(src, true);
                var lb = LoadAsync(tgt, false);
                await Task.WhenAll(la, lb).ConfigureAwait(false);
                Report("sorting", true);
                var sa = (await la.ConfigureAwait(false)).Order(keys).ToList();
                var sb = (await lb.ConfigureAwait(false)).Order(keys).ToList();
                a = new ListRowSource(sa);
                b = new ListRowSource(sb);
                sink.CountRows = false;
            }
            else
            {
                a = src;
                b = tgt;
            }
            Report("comparing", true);
            var countedA = new CountingSource(a, () => { if (sink.CountRows) sink.SourceRows++; Report("comparing", false); });
            var countedB = new CountingSource(b, () => { if (sink.CountRows) sink.TargetRows++; Report("comparing", false); });
            await MergeJoin.RunAsync(countedA, countedB, keys, plan.Compared(), new ValueComparer(plan.Options), sink, cts.Token).ConfigureAwait(false);
        }
        catch
        {
            await cts.CancelAsync().ConfigureAwait(false);
            throw;
        }
        return sink;
    }

    private static string SelectSql(ComparePlan plan, SideMeta side, bool engineOrder)
    {
        var d = side.Dialect;
        var items = plan.Columns.Select(c =>
        {
            var col = side.Role == "source" ? c.Source : c.Target;
            return TransferSql.SelectColumn(d, col.Name, col.Canon, col.TypeText);
        });
        var order = engineOrder ? null : plan.Columns.Where(c => c.IsKey).Select(c =>
        {
            var col = side.Role == "source" ? c.Source : c.Target;
            return (TransferSql.Quote(d, col.Name), c.Family, col.Canon, col.Nullable && !col.IsPk);
        }).ToList();
        return DataCompareSql.Select(d, side.From, items, side.Spec.Where, order);
    }

    private static async Task<IDbSession> OpenAsync(SideMeta side, CancellationToken ct) =>
        await side.Conn.Provider.OpenSessionAsync(side.Conn.Profile, side.Conn.Password,
            new SessionOptions(Ids.New("s"), side.Database, TransactionMode.Auto, false), ct).ConfigureAwait(false);

    // ------------------------------------------------------------------ rows

    public DataDiffPage Rows(string compareId, string? cls, int offset, int limit)
    {
        var c = _store.Get(compareId);
        if (cls is { Length: > 0 } && cls != "all" && !DiffClasses.IsDifference(cls))
            throw EngineException.Validation($"Unknown class '{cls}'.", new { field = "class" });
        var all = cls is null or "" or "all";
        var rows = all ? c.Diffs : c.Diffs.Where(d => d.Class == cls).ToList();
        offset = Math.Max(0, offset);
        limit = Math.Clamp(limit <= 0 ? 200 : limit, 1, 2000);
        return new DataDiffPage(all ? null : cls, offset, rows.Count, rows.Skip(offset).Take(limit).ToList());
    }

    public void Discard(string compareId) => _store.Remove(compareId);

    // ------------------------------------------------------------------ script

    private static readonly IReadOnlySet<string> AllSyncClasses = new HashSet<string> { DiffClasses.Changed, DiffClasses.OnlyInSource, DiffClasses.OnlyInTarget };

    private static (bool ToTarget, IReadOnlySet<string> Classes) SyncArgs(string? direction, List<string>? classes)
    {
        if (!SyncDirections.IsKnown(direction)) throw EngineException.Validation($"Unknown direction '{direction}'.", new { field = "direction" });
        IReadOnlySet<string> set = AllSyncClasses;
        if (classes is not null)
        {
            var bad = classes.FirstOrDefault(c => !DiffClasses.IsSyncable(c));
            if (bad is not null) throw EngineException.Validation($"'{bad}' rows cannot be synchronized.", new { field = "classes" });
            set = classes.ToHashSet();
        }
        return (direction != SyncDirections.ToSource, set);
    }

    private static (SideMeta Side, BuiltSync Built) Build(DataComparison c, bool toTarget, IReadOnlySet<string> classes)
    {
        var plan = c.Plan;
        var side = toTarget ? plan.Target : plan.Source;
        var support = plan.Sync();
        var why = toTarget ? support.ToTargetReason : support.ToSourceReason;
        if (why is not null) throw EngineException.Validation(why, new { field = "direction" });
        var columns = plan.Columns.Select(p =>
        {
            var col = toTarget ? p.Target : p.Source;
            return new SyncColumn(col.Name, col.Canon, col.TypeText, p.IsKey, col.Identity, !col.Computed && !col.Generated);
        }).ToList();
        var built = SyncScriptBuilder.Build(side.Dialect, side.Schema, side.Spec.Table!, columns, c.Diffs, toTarget, classes);
        var missing = side.Columns.Where(sc => !plan.Columns.Any(p => ReferenceEquals(toTarget ? p.Target : p.Source, sc)) && !sc.Computed && !sc.Generated)
            .Select(sc => sc.Name).ToList();
        if (missing.Count > 0 && built.Inserts > 0)
            built.Warnings.Add($"The other side has no {string.Join(", ", missing)}: inserted rows get the column defaults.");
        if (c.Truncated)
            built.Warnings.Add($"Only the first {c.Diffs.Count:N0} differences were kept: compare again after this script to synchronize the rest.");
        return (side, built);
    }

    public DataSyncScript Script(string compareId, DataSyncRequest? request)
    {
        var c = _store.Get(compareId);
        var (toTarget, classes) = SyncArgs(request?.Direction, request?.Classes);
        var (side, built) = Build(c, toTarget, classes);
        var plan = c.Plan;
        var header = string.Join('\n',
            "Rowlit data synchronization",
            $"Source: {plan.Source.Label}",
            $"Target: {plan.Target.Label}",
            $"This script changes the {side.Role}: {side.Label}",
            $"{built.Deletes} deletes, {built.Updates} updates, {built.Inserts} inserts in {built.Statements.Count} statements");
        return new DataSyncScript(SyncScriptBuilder.Text(side.Dialect, header, built), built.Statements.Count, built.Inserts, built.Updates, built.Deletes,
            built.Warnings, toTarget ? SyncDirections.ToTarget : SyncDirections.ToSource, side.Conn.Profile.Id, side.Database ?? (DialectInfo.SchemaIsDatabase(side.Dialect) ? side.Schema : null),
            CoreJson.ToWire(side.Dialect), c.Truncated);
    }

    // ------------------------------------------------------------------ apply

    /// <summary>Validates and starts the <c>data.sync</c> job (done / total = statements).</summary>
    public string StartApply(string compareId, DataApplyRequest? request, string? clientId)
    {
        var c = _store.Get(compareId);
        var (toTarget, classes) = SyncArgs(request?.Direction, request?.Classes);
        var (side, built) = Build(c, toTarget, classes);
        if (side.Conn.Profile.ReadOnly) throw EngineException.ReadOnly(side.Conn.Profile.Name, "data synchronization");
        var jm = jobs ?? throw new InvalidOperationException("No job manager.");
        return jm.Start(SyncJobKind, side.Conn.Profile.Id, clientId, async (job, ct) =>
            await RunApplyAsync(side, built, request?.Transactional ?? true, (done, total) => job.Report(done, total, $"{done} of {total} statements"), ct)
                .ConfigureAwait(false));
    }

    /// <summary>Applies a sync in the caller's task (tests, embedding).</summary>
    public async Task<DataApplyResult> ApplyAsync(string compareId, DataApplyRequest? request, CancellationToken ct)
    {
        var c = _store.Get(compareId);
        var (toTarget, classes) = SyncArgs(request?.Direction, request?.Classes);
        var (side, built) = Build(c, toTarget, classes);
        if (side.Conn.Profile.ReadOnly) throw EngineException.ReadOnly(side.Conn.Profile.Name, "data synchronization");
        return await RunApplyAsync(side, built, request?.Transactional ?? true, null, ct).ConfigureAwait(false);
    }

    private static async Task<DataApplyResult> RunApplyAsync(SideMeta side, BuiltSync built, bool transactional, Action<long, long>? progress, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var statements = built.Statements;
        var failures = new List<DataApplyFailure>();
        if (statements.Count == 0) return new DataApplyResult(TransferStatus.Ok, 0, 0, 0, 0, 0, false, failures, 0);
        await using var session = await side.Conn.Provider.OpenSessionAsync(side.Conn.Profile, side.Conn.Password,
            new SessionOptions(Ids.New("s"), side.Database, transactional ? TransactionMode.Manual : TransactionMode.Auto, false), ct).ConfigureAwait(false);
        var executed = 0;
        progress?.Invoke(0, statements.Count);
        try
        {
            if (transactional)
            {
                for (var i = 0; i < statements.Count; i += StatementsPerRoundTrip)
                {
                    ct.ThrowIfCancellationRequested();
                    var chunk = statements.Skip(i).Take(StatementsPerRoundTrip).ToList();
                    var failed = await RunAsync(session, chunk, ct).ConfigureAwait(false);
                    if (failed is { } f)
                    {
                        executed += f.Index;
                        failures.Add(new DataApplyFailure(i + f.Index, Clip(chunk[f.Index]), f.Message));
                        await RollbackQuietlyAsync(session).ConfigureAwait(false);
                        return new DataApplyResult(TransferStatus.Error, executed, statements.Count, 0, 0, 0, true, failures, sw.ElapsedMilliseconds);
                    }
                    executed += chunk.Count;
                    progress?.Invoke(executed, statements.Count);
                }
                await session.CommitAsync(ct).ConfigureAwait(false);
                return new DataApplyResult(TransferStatus.Ok, executed, statements.Count, built.Inserts, built.Updates, built.Deletes, false, failures, sw.ElapsedMilliseconds);
            }

            for (var i = 0; i < statements.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var failed = await RunAsync(session, [statements[i]], ct).ConfigureAwait(false);
                if (failed is { } f) failures.Add(new DataApplyFailure(i, Clip(statements[i]), f.Message));
                else executed++;
                progress?.Invoke(i + 1, statements.Count);
            }
            var status = failures.Count == 0 ? TransferStatus.Ok : executed == 0 ? TransferStatus.Error : TransferStatus.Partial;
            // per-statement counts are not known when some failed: report the planned ones only for a clean run
            return failures.Count == 0
                ? new DataApplyResult(status, executed, statements.Count, built.Inserts, built.Updates, built.Deletes, false, failures, sw.ElapsedMilliseconds)
                : new DataApplyResult(status, executed, statements.Count, 0, 0, 0, false, failures, sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            if (transactional) await RollbackQuietlyAsync(session).ConfigureAwait(false);
            throw;
        }
    }

    private static string Clip(string sql) => sql.Length > 600 ? sql[..600] + " …" : sql;

    private static async Task RollbackQuietlyAsync(IDbSession session)
    {
        try { await session.RollbackAsync(CancellationToken.None).ConfigureAwait(false); }
        catch (Exception) { /* the session is disposed next; an open transaction dies with it */ }
    }

    /// <summary>Runs statements in one round trip; the first failure (index in <paramref name="statements"/>, message) or null.</summary>
    private static async Task<(int Index, string Message)?> RunAsync(IDbSession session, IReadOnlyList<string> statements, CancellationToken ct)
    {
        var sink = new LiveTarget.ErrorSink();
        var summary = await session.ExecuteAsync(new ExecuteRequest(statements.Select(s => new SqlBatch(s, 1, 1)).ToList(), 0, true, false, "data-sync"), sink, ct)
            .ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        if (sink.Failure is { } f) return (Math.Clamp(f.Batch, 0, statements.Count - 1), f.Error.Message);
        if (summary.Status == ExecutionStatus.Error) return (0, "The server reported an error.");
        return null;
    }

    // ------------------------------------------------------------------ plan

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private void Validate(DataCompareRequest? request)
    {
        if (request?.Source is null || request.Target is null) throw EngineException.Validation("source and target are required.", new { field = "source" });
        CheckSide(request.Source, "source");
        CheckSide(request.Target, "target");
        var o = request.Options ?? new DataCompareOptions();
        if (!DataOrderings.IsKnown(o.Ordering)) throw EngineException.Validation($"Unknown ordering '{o.Ordering}'.", new { field = "options.ordering" });
        if (o.MaxDifferences is < 1 or > DataCompareLimits.MaxDifferences)
            throw EngineException.Validation($"maxDifferences must be between 1 and {DataCompareLimits.MaxDifferences}.", new { field = "options.maxDifferences" });
        if (o.NumericTolerance < 0 || double.IsNaN(o.NumericTolerance)) throw EngineException.Validation("numericTolerance must be 0 or more.", new { field = "options.numericTolerance" });
        if (o.TimeToleranceMs < 0) throw EngineException.Validation("timeToleranceMs must be 0 or more.", new { field = "options.timeToleranceMs" });
        var s = request.Source;
        var t = request.Target;
        if (!s.IsQuery && !t.IsQuery && s.ConnectionId == t.ConnectionId
            && string.Equals(Blank(s.Database) ?? "", Blank(t.Database) ?? "", StringComparison.OrdinalIgnoreCase)
            && string.Equals(Blank(s.Schema) ?? "", Blank(t.Schema) ?? "", StringComparison.OrdinalIgnoreCase)
            && string.Equals(s.Table?.Trim(), t.Table?.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(Blank(s.Where) ?? "", Blank(t.Where) ?? "", StringComparison.Ordinal))
            throw EngineException.Validation("Source and target are the same table.", new { field = "target" });
        env.Resolve(s.ConnectionId);
        env.Resolve(t.ConnectionId);
    }

    private static void CheckSide(DataCompareSide side, string role)
    {
        if (string.IsNullOrWhiteSpace(side.ConnectionId)) throw EngineException.Validation($"{role}.connectionId is required.", new { field = $"{role}.connectionId" });
        if (side.IsQuery) DataCompareSql.CheckQuery(side.Query!, $"{role}.query");
        else if (string.IsNullOrWhiteSpace(side.Table)) throw EngineException.Validation($"Choose the {role} table.", new { field = $"{role}.table" });
        DataCompareSql.CheckWhere(side.Where, $"{role}.where");
    }

    private async Task<ComparePlan> PlanAsync(DataCompareRequest? request, bool requireKey, CancellationToken ct)
    {
        Validate(request);
        var options = request!.Options ?? new DataCompareOptions();
        var srcTask = ReadSideAsync(request.Source, "source", ct);
        var tgtTask = ReadSideAsync(request.Target, "target", ct);
        var src = await srcTask.ConfigureAwait(false);
        var tgt = await tgtTask.ConfigureAwait(false);
        var notes = new List<string>();

        // ---- pair the columns by name (exact first, then case-insensitive)
        var pairs = new List<(SideColumn S, SideColumn T)>();
        var usedT = new HashSet<SideColumn>();
        foreach (var s in src.Columns)
        {
            var t = tgt.Columns.FirstOrDefault(x => !usedT.Contains(x) && x.Name == s.Name)
                    ?? tgt.Columns.FirstOrDefault(x => !usedT.Contains(x) && string.Equals(x.Name, s.Name, StringComparison.OrdinalIgnoreCase));
            if (t is null) continue;
            usedT.Add(t);
            pairs.Add((s, t));
        }
        var onlySrc = src.Columns.Where(s => pairs.All(p => p.S != s)).Select(s => s.Name).ToList();
        var onlyTgt = tgt.Columns.Where(t => !usedT.Contains(t)).Select(t => t.Name).ToList();
        if (onlySrc.Count > 0) notes.Add($"Only in the source (not compared): {string.Join(", ", onlySrc)}.");
        if (onlyTgt.Count > 0) notes.Add($"Only in the target (not compared): {string.Join(", ", onlyTgt)}.");
        if (pairs.Count == 0) throw EngineException.Validation("The two sides have no column in common.", new { field = "target" });

        // ---- key
        static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        List<string> PkOf(SideMeta side, Func<(SideColumn S, SideColumn T), SideColumn> pick)
        {
            var names = new List<string>();
            foreach (var k in side.PrimaryKey)
            {
                var p = pairs.FirstOrDefault(x => Same(pick(x).Name, k));
                if (p.S is null) return [];
                names.Add(p.S.Name);
            }
            return names;
        }
        var defaultKey = PkOf(src, x => x.S);
        if (defaultKey.Count == 0) defaultKey = PkOf(tgt, x => x.T);
        List<string> key;
        if (options.KeyColumns is { Count: > 0 })
        {
            key = [];
            foreach (var k in options.KeyColumns)
            {
                var p = pairs.FirstOrDefault(x => Same(x.S.Name, k));
                if (p.S is null) throw EngineException.Validation($"The key column {k} is not on both sides.", new { field = "options.keyColumns" });
                if (!key.Contains(p.S.Name)) key.Add(p.S.Name);
            }
        }
        else key = defaultKey;
        if (requireKey && key.Count == 0)
            throw EngineException.Validation("Neither side has a primary key: choose the key columns that identify a row.", new { field = "options.keyColumns" });

        // ---- compared columns
        HashSet<string>? only = null;
        if (options.Columns is { Count: > 0 })
        {
            only = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var n in options.Columns)
            {
                if (!pairs.Any(x => Same(x.S.Name, n))) throw EngineException.Validation($"The column {n} is not on both sides.", new { field = "options.columns" });
                only.Add(n);
            }
        }
        var ignore = new HashSet<string>(options.IgnoreColumns ?? [], StringComparer.OrdinalIgnoreCase);
        var columns = new List<PairColumn>();
        var preview = new List<DataCompareColumnInfo>();
        foreach (var (s, t) in pairs)
        {
            var family = ValueFamilies.Pick(s.Canon, t.Canon);
            var isKey = key.Contains(s.Name, StringComparer.OrdinalIgnoreCase);
            var generated = s.Generated || t.Generated;
            var computed = s.Computed || t.Computed;
            var comparableByDefault = !generated && !computed;
            string? note = generated ? "generated by the server (rowversion): not compared" : computed ? "computed column: not compared by default" : null;
            var compared = !isKey && (only is null ? comparableByDefault : only.Contains(s.Name)) && !ignore.Contains(s.Name);
            if (isKey && family == ValueFamily.Json) throw EngineException.Validation($"{s.Name} cannot be a key column (JSON).", new { field = "options.keyColumns" });
            columns.Add(new PairColumn(s.Name, s, t, family, ValueFamilies.Padded(s.Canon, t.Canon), isKey, compared));
            preview.Add(new DataCompareColumnInfo(s.Name, s.Name, t.Name, s.TypeText, t.TypeText, src.PrimaryKey.Contains(s.Name, StringComparer.OrdinalIgnoreCase),
                tgt.PrimaryKey.Contains(t.Name, StringComparer.OrdinalIgnoreCase), ValueFamilies.Wire(family), comparableByDefault, note));
        }
        foreach (var n in onlySrc)
        {
            var s = src.Columns.First(c => c.Name == n);
            preview.Add(new DataCompareColumnInfo(n, n, null, s.TypeText, null, s.IsPk, false, ValueFamilies.Wire(ValueFamilies.Of(s.Canon)), false, "only in the source"));
        }
        foreach (var n in onlyTgt)
        {
            var t = tgt.Columns.First(c => c.Name == n);
            preview.Add(new DataCompareColumnInfo(n, null, n, null, t.TypeText, false, t.IsPk, ValueFamilies.Wire(ValueFamilies.Of(t.Canon)), false, "only in the target"));
        }
        if (requireKey && !columns.Any(c => c.Compared))
            notes.Add("No column besides the key is compared: rows are matched on their key only.");
        return new ComparePlan { Source = src, Target = tgt, Options = options, Columns = columns, Preview = preview, DefaultKey = defaultKey, Notes = notes };
    }

    private async Task<SideMeta> ReadSideAsync(DataCompareSide side, string role, CancellationToken ct)
    {
        var conn = env.Resolve(side.ConnectionId);
        var d = conn.Provider.Dialect;
        var db = Blank(side.Database);
        var schema = Blank(side.Schema);
        if (schema is null)
        {
            try
            {
                await using var reader = await conn.Provider.OpenCatalogReaderAsync(conn.Profile, conn.Password, ct).ConfigureAwait(false);
                schema = Blank(await reader.GetDefaultSchemaAsync(db, ct).ConfigureAwait(false));
            }
            catch (Exception ex) when (ex is not OperationCanceledException and not EngineException { Code: ErrorCodes.SshTunnel })
            {
                // fall back below
            }
            schema ??= Blank(DialectInfo.DefaultSchemaFallback(d)) ?? (DialectInfo.SchemaIsDatabase(d) ? db : null);
        }
        var label = string.Join(" › ", new[] { conn.Profile.Name, db, schema, side.IsQuery ? "(query)" : side.Table!.Trim() }
            .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.Ordinal));
        if (side.IsQuery)
        {
            var cols = await QueryColumnsAsync(conn, db, side.Query!, ct).ConfigureAwait(false);
            return new SideMeta { Role = role, Spec = side, Conn = conn, Database = db, Schema = schema, Columns = cols, PrimaryKey = [], Label = label };
        }

        var table = side.Table!.Trim();
        ObjectDetails? details = null;
        await using (var reader = await conn.Provider.OpenCatalogReaderAsync(conn.Profile, conn.Password, ct).ConfigureAwait(false))
        {
            foreach (var type in new[] { ObjectTypes.Table, ObjectTypes.View })
            {
                try
                {
                    details = await reader.GetObjectDetailsAsync(new ObjectRef(db, schema, table, type), ct).ConfigureAwait(false);
                    if (details.Columns.Count > 0) break;
                }
                catch (EngineException ex) when (ex.Status == 404)
                {
                    details = null;
                }
            }
        }
        if (details is null || details.Columns.Count == 0)
            throw EngineException.NotFound($"The {role} table {string.Join(".", new[] { schema, table }.Where(x => !string.IsNullOrEmpty(x)))}");
        var columns = details.Columns.OrderBy(c => c.Ordinal).Select(c =>
        {
            var type = string.IsNullOrWhiteSpace(c.Type) ? "text" : c.Type;
            var b = TypeMapper.Split(type).Base;
            var generated = d == Dialect.TSql && b is "rowversion" or "timestamp";
            return new SideColumn(c.Name, type, TypeMapper.Parse(d, type), c.Nullable, c.IsPk, c.IsIdentity, c.IsComputed, generated);
        }).ToList();
        var pk = details.Indexes.FirstOrDefault(i => i.IsPrimaryKey)?.Columns.ToList()
                 ?? details.Columns.Where(c => c.IsPk).OrderBy(c => c.Ordinal).Select(c => c.Name).ToList();
        if (pk.Count == 0) pk = details.Columns.Where(c => c.IsPk).OrderBy(c => c.Ordinal).Select(c => c.Name).ToList();
        return new SideMeta { Role = role, Spec = side, Conn = conn, Database = db, Schema = schema, Columns = columns, PrimaryKey = pk, Label = label };
    }

    /// <summary>The columns of a query, from a zero-row execution.</summary>
    private static async Task<List<SideColumn>> QueryColumnsAsync(TransferConnection conn, string? db, string query, CancellationToken ct)
    {
        await using var session = await conn.Provider.OpenSessionAsync(conn.Profile, conn.Password, new SessionOptions(Ids.New("s"), db, TransactionMode.Auto, false), ct)
            .ConfigureAwait(false);
        var d = conn.Provider.Dialect;
        var sql = d == Dialect.Cql ? DataCompareSql.TrimQuery(query) : $"SELECT * FROM {DataCompareSql.QueryFrom(query)} WHERE 1 = 0";
        var sink = new ColumnsSink();
        await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 1, true, false, "data-compare"), sink, ct).ConfigureAwait(false);
        if (sink.Failure is { } f) throw EngineException.Validation("The query failed: " + f.Message, new { field = "query" });
        if (sink.Columns is not { Length: > 0 } cols) throw EngineException.Validation("The query returns no columns.", new { field = "query" });
        return cols.Select(c => new SideColumn(c.Name, c.DbType, TypeMapper.Parse(d, string.IsNullOrWhiteSpace(c.DbType) ? "text" : c.DbType), true, false, false, false, false))
            .ToList();
    }

    private sealed class ColumnsSink : IExecutionSink
    {
        public ColumnInfo[]? Columns { get; private set; }
        public ErrorInfo? Failure { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) { Columns ??= columns; return ValueTask.CompletedTask; }
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows) => ValueTask.CompletedTask;
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error) { Failure ??= error; return ValueTask.CompletedTask; }
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }

    // ------------------------------------------------------------------ merge sink

    /// <summary>Counts every class, keeps the differences (capped) and the per-class sample.</summary>
    private sealed class CollectSink(int maxDiffs) : IMergeSink
    {
        private long _equal, _changed, _onlySrc, _onlyTgt, _dup;
        private readonly Dictionary<string, int> _sampled = new(StringComparer.Ordinal);

        public List<DataDiffRow> Diffs { get; } = [];
        public List<DataDiffRow> Sample { get; } = [];
        public bool Truncated { get; private set; }
        public long SourceRows;
        public long TargetRows;
        /// <summary>False once the engine-sorted sides were counted while loading.</summary>
        public bool CountRows = true;

        public DataCompareCounts Counts => new(_equal, _changed, _onlySrc, _onlyTgt, _dup);

        private void Keep(DataDiffRow row)
        {
            if (Diffs.Count < maxDiffs) Diffs.Add(row);
            else Truncated = true;
            _sampled.TryGetValue(row.Class, out var n);
            if (n < SamplePerClass)
            {
                _sampled[row.Class] = n + 1;
                Sample.Add(row);
            }
        }

        public void Equal(object?[] source, object?[] target) => _equal++;

        public void Changed(object?[] source, object?[] target, int[] changed)
        {
            _changed++;
            Keep(new DataDiffRow(DiffClasses.Changed, source, target, changed));
        }

        public void OnlyInSource(object?[] source)
        {
            _onlySrc++;
            Keep(new DataDiffRow(DiffClasses.OnlyInSource, source, null, null));
        }

        public void OnlyInTarget(object?[] target)
        {
            _onlyTgt++;
            Keep(new DataDiffRow(DiffClasses.OnlyInTarget, null, target, null));
        }

        public void Duplicate(IReadOnlyList<object?[]> source, IReadOnlyList<object?[]> target)
        {
            foreach (var r in source) { _dup++; Keep(new DataDiffRow(DiffClasses.Duplicate, r, null, null)); }
            foreach (var r in target) { _dup++; Keep(new DataDiffRow(DiffClasses.Duplicate, null, r, null)); }
        }
    }

    private sealed class CountingSource(IRowSource inner, Action onRow) : IRowSource
    {
        public async ValueTask<object?[]?> NextAsync(CancellationToken ct)
        {
            var r = await inner.NextAsync(ct).ConfigureAwait(false);
            if (r is not null) onRow();
            return r;
        }
    }

    /// <summary>
    /// Rows of one side read on a background task into a small bounded channel (back pressure keeps memory flat while the
    /// merge join consumes both sides in step).
    /// </summary>
    private sealed class StreamingSource : IRowSource, IAsyncDisposable
    {
        private readonly Channel<object?[][]> _channel = Channel.CreateBounded<object?[][]>(new BoundedChannelOptions(8) { SingleReader = true, SingleWriter = true });
        private Task _producer = Task.CompletedTask;
        private object?[][]? _buffer;
        private int _pos;

        public required string Role { get; init; }

        public static StreamingSource Start(IDbSession session, string sql, string role, CancellationToken ct)
        {
            var s = new StreamingSource { Role = role };
            s._producer = Task.Run(() => s.ProduceAsync(session, sql, ct), CancellationToken.None);
            return s;
        }

        private async Task ProduceAsync(IDbSession session, string sql, CancellationToken ct)
        {
            Exception? failure = null;
            try
            {
                var sink = new RowSink(_channel.Writer, ct);
                var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 0, true, false, "data-compare"), sink, ct).ConfigureAwait(false);
                await sink.FlushAsync().ConfigureAwait(false);
                if (sink.Failure is { } f) failure = new EngineException(400, ErrorCodes.ProviderError, $"Reading the {Role} failed: {f.Message}", new { side = Role, sql });
                else if (summary.Status == ExecutionStatus.Error) failure = new EngineException(400, ErrorCodes.ProviderError, $"Reading the {Role} failed.", new { side = Role, sql });
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            _channel.Writer.TryComplete(failure);
        }

        public async ValueTask<object?[]?> NextAsync(CancellationToken ct)
        {
            while (_buffer is null || _pos >= _buffer.Length)
            {
                if (!await _channel.Reader.WaitToReadAsync(ct).ConfigureAwait(false)) return null;
                if (_channel.Reader.TryRead(out var next))
                {
                    _buffer = next;
                    _pos = 0;
                }
            }
            return _buffer[_pos++];
        }

        public async ValueTask DisposeAsync()
        {
            // the caller cancels the token on failure; drain so the producer is never blocked on a full channel
            while (_channel.Reader.TryRead(out _)) { }
            try { await _producer.ConfigureAwait(false); }
            catch (Exception) { /* reported through the channel */ }
            while (_channel.Reader.TryRead(out _)) { }
        }

        private sealed class RowSink(ChannelWriter<object?[][]> writer, CancellationToken ct) : IExecutionSink
        {
            private readonly List<object?[]> _rows = new(512);
            public ErrorInfo? Failure { get; private set; }

            public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
            public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;

            public async ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows)
            {
                foreach (var r in rows)
                {
                    _rows.Add(r);
                    if (_rows.Count >= 512) await FlushAsync().ConfigureAwait(false);
                }
            }

            public async ValueTask FlushAsync()
            {
                if (_rows.Count == 0) return;
                var batch = _rows.ToArray();
                _rows.Clear();
                await writer.WriteAsync(batch, ct).ConfigureAwait(false);
            }

            public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
            public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
            public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
            public ValueTask Error(int batchIndex, ErrorInfo error) { Failure ??= error; return ValueTask.CompletedTask; }
            public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
        }
    }
}
