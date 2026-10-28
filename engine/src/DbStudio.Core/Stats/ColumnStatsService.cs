using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using DbStudio.Core.DataCompare;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.Stats;

/// <summary>
/// Column statistics: profiles the columns of a table or view (nulls, distinct values, min / max, average and sum of numbers,
/// text lengths, the most frequent values and a histogram of numbers and dates). Runs as the <c>stats.columns</c> job, so it
/// reports a finished column at a time and can be cancelled (the running statement is cancelled on the server).
/// <list type="bullet">
/// <item>Only SELECT statements are sent, so a read-only connection profiles like any other.</item>
/// <item>A large table is sampled: in auto mode a table with more than <see cref="StatsLimits.MaxExactRows"/> rows is read
/// through its first <see cref="StatsLimits.SampleRows"/> rows, so no statement scans a huge table; the result says so.</item>
/// <item>Connections resolve through <see cref="ITransferEnvironment"/>, i.e. <c>ConnectionStore.ResolveForOpen</c> (SSH tunnels).</item>
/// </list>
/// </summary>
public sealed class ColumnStatsService(ITransferEnvironment env, JobManager? jobs = null, ILogger<ColumnStatsService>? log = null)
{
    public const string JobKind = "stats.columns";
    /// <summary>Columns summarized by one statement (one scan of the table).</summary>
    private const int ColumnsPerSummary = 8;

    private readonly ILogger _log = log ?? (ILogger)NullLogger.Instance;

    /// <summary>Validates the request and starts the <c>stats.columns</c> job; returns the job id.</summary>
    public string Start(ColumnStatsRequest? request, string? clientId)
    {
        var req = Validate(request);
        var conn = env.Resolve(req.ConnectionId); // 404 for an unknown connection, 400 for a non-relational one
        if (!StatsSql.Supported(conn.Provider.Dialect))
            throw EngineException.Validation($"Column statistics are not available for {conn.Provider.DisplayName} (it cannot group or count distinct values).");
        var jm = jobs ?? throw new InvalidOperationException("No job manager.");
        return jm.Start(JobKind, req.ConnectionId, clientId, async (job, ct) =>
            await ProfileAsync(req, (p, force) => job.Report(Math.Max(p.Index, 0), p.Total, JsonSerializer.Serialize(p, CoreJson.Options), force), ct).ConfigureAwait(false));
    }

    private static ColumnStatsRequest Validate(ColumnStatsRequest? r)
    {
        if (r is null) throw EngineException.Validation("A request body is required.");
        if (string.IsNullOrWhiteSpace(r.ConnectionId)) throw EngineException.Validation("connectionId is required.", new { field = "connectionId" });
        if (string.IsNullOrWhiteSpace(r.Table)) throw EngineException.Validation("table is required.", new { field = "table" });
        if (r.Sample is not null && !StatsSampleModes.IsValid(r.Sample))
            throw EngineException.Validation("sample must be auto, exact or sample.", new { field = "sample" });
        if (r.Columns is { Count: > StatsLimits.MaxColumns })
            throw EngineException.Validation($"At most {StatsLimits.MaxColumns} columns can be profiled at once.", new { field = "columns" });
        DataCompareSql.CheckWhere(r.Where, "where");
        if (r.Params is { Count: > 0 } ps) ParamValues.Validate(ps);
        return r;
    }

    /// <summary>Profiles in the caller's task (the job's body, tests).</summary>
    public async Task<ColumnStatsResult> ProfileAsync(ColumnStatsRequest request, Action<StatsProgress, bool>? progress, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var req = Validate(request);
        progress?.Invoke(new StatsProgress("preparing", 0, 0, null, null), true);
        var conn = env.Resolve(req.ConnectionId);
        var d = conn.Provider.Dialect;
        if (!StatsSql.Supported(d)) throw EngineException.Validation($"Column statistics are not available for {conn.Provider.DisplayName}.");

        var db = Blank(req.Database);
        var (schema, details, label) = await ReadTableAsync(conn, req, db, ct).ConfigureAwait(false);
        var all = details.Columns.OrderBy(c => c.Ordinal).ToList();
        List<ColumnDetail> chosen;
        if (req.Columns is { Count: > 0 })
        {
            chosen = [];
            foreach (var name in req.Columns.Distinct(StringComparer.Ordinal))
            {
                var found = all.FirstOrDefault(c => c.Name == name) ?? all.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase))
                            ?? throw EngineException.Validation($"The table has no column '{name}'.", new { field = "columns" });
                chosen.Add(found);
            }
        }
        else chosen = all;
        var plans = chosen.Select(c => ColumnPlan.For(d, c.Name, c.Type)).ToList();
        var table = TransferSql.Qualified(d, schema, req.Table.Trim());
        var where = string.IsNullOrWhiteSpace(req.Where) ? null : req.Where.Trim();
        var top = Math.Clamp(req.TopValues ?? StatsLimits.TopValues, 1, 100);
        var buckets = Math.Clamp(req.Buckets ?? StatsLimits.Buckets, 2, 100);
        var sampleRows = Math.Clamp(req.SampleRows ?? StatsLimits.SampleRows, 1, int.MaxValue - 1);
        var maxExact = Math.Clamp(req.MaxExactRows ?? StatsLimits.MaxExactRows, 1, int.MaxValue - 1);
        var mode = req.Sample ?? StatsSampleModes.Auto;

        await using var session = await conn.Provider.OpenSessionAsync(conn.Profile, conn.Password, new SessionOptions(Ids.New("s"), db, TransactionMode.Auto, false), ct)
            .ConfigureAwait(false);
        var runner = new StatementRunner(session, req.Params, ct);

        // Is the table big? Counting stops one row past the limit, so this is cheap on any table.
        int? sample = null;
        string? sampleNote = null;
        var notes = new List<string>();
        if (mode != StatsSampleModes.Exact && plans.Count > 0)
        {
            progress?.Invoke(new StatsProgress("probing", 0, plans.Count, null, null), true);
            var cap = mode == StatsSampleModes.Sample ? sampleRows : maxExact;
            var counted = ToLong((await runner.QueryAsync(StatsSql.Probe(d, table, where, cap)).ConfigureAwait(false)).FirstOrDefault()?[0]);
            if (counted > cap)
            {
                sample = sampleRows;
                sampleNote = mode == StatsSampleModes.Sample
                    ? $"Based on the first {sampleRows:N0} rows (sampling was requested); the table has more."
                    : $"The table has more than {cap:N0} rows: the statistics are based on its first {sampleRows:N0} rows.";
                notes.Add("Distinct counts, top values and histograms describe the sampled rows only.");
            }
        }
        var rel = new StatsRelation(d, table, where, sample);
        if (where is not null) notes.Add("Only the rows matching the filter are profiled.");

        var results = new ColumnStats?[plans.Count];
        long scanned = 0;
        for (var start = 0; start < plans.Count; start += ColumnsPerSummary)
        {
            ct.ThrowIfCancellationRequested();
            var chunk = plans.Skip(start).Take(ColumnsPerSummary).ToList();
            var summaries = await SummarizeAsync(runner, rel, chunk, ct).ConfigureAwait(false);
            for (var i = 0; i < chunk.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var index = start + i;
                progress?.Invoke(new StatsProgress("column", index, plans.Count, chunk[i].Name, null), true);
                var stats = await ProfileColumnAsync(runner, rel, chunk[i], summaries[i], top, buckets, ct).ConfigureAwait(false);
                results[index] = stats;
                if (stats.Error is null) scanned = Math.Max(scanned, stats.Rows);
                progress?.Invoke(new StatsProgress("column", index + 1, plans.Count, chunk[i].Name, stats), true);
            }
        }
        if (plans.Count == 0) scanned = 0;
        var final = results.Select(r => r!).ToList();
        progress?.Invoke(new StatsProgress("done", plans.Count, plans.Count, null, null), true);
        return new ColumnStatsResult(label, CoreJson.ToWire(d), scanned, sample is not null, details.RowCountEstimate is > 0 ? details.RowCountEstimate : null, sampleNote, final, notes,
            sw.ElapsedMilliseconds);
    }

    // ------------------------------------------------------------------ the catalog

    private static async Task<(string? Schema, ObjectDetails Details, string Label)> ReadTableAsync(TransferConnection conn, ColumnStatsRequest req, string? db, CancellationToken ct)
    {
        var d = conn.Provider.Dialect;
        var schema = Blank(req.Schema);
        await using var reader = await conn.Provider.OpenCatalogReaderAsync(conn.Profile, conn.Password, ct).ConfigureAwait(false);
        if (schema is null)
        {
            try { schema = Blank(await reader.GetDefaultSchemaAsync(db, ct).ConfigureAwait(false)); }
            catch (Exception ex) when (ex is not OperationCanceledException and not EngineException { Code: ErrorCodes.SshTunnel }) { /* fall back below */ }
            schema ??= Blank(DialectInfo.DefaultSchemaFallback(d)) ?? (DialectInfo.SchemaIsDatabase(d) ? db : null);
        }
        var table = req.Table.Trim();
        ObjectDetails? details = null;
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
        if (details is null || details.Columns.Count == 0)
            throw EngineException.NotFound($"The table {string.Join(".", new[] { schema, table }.Where(x => !string.IsNullOrEmpty(x)))}");
        var label = string.Join(" › ", new[] { conn.Profile.Name, db, schema, table }.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.Ordinal));
        return (schema, details, label);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // ------------------------------------------------------------------ one chunk of columns

    /// <summary>The summary row of each column of a chunk, with the failure reason of the ones that could not be summarized.</summary>
    private sealed record Summary(long Rows, long NonNull, long? Distinct, string? Min, string? Max, double? Avg, string? Sum, long? MinLength, long? MaxLength,
        string? Warning, string? Error);

    private async Task<Summary[]> SummarizeAsync(StatementRunner runner, StatsRelation rel, List<ColumnPlan> chunk, CancellationToken ct)
    {
        // Fast path: every column of the chunk in one statement. A failure (a type the server cannot aggregate this way)
        // falls back to one statement per column, and then to fewer statistics.
        var fast = await TrySummaryAsync(runner, rel, chunk, 0, ct).ConfigureAwait(false);
        if (fast.Result is { } rows) return rows;
        var result = new Summary[chunk.Count];
        for (var i = 0; i < chunk.Count; i++)
        {
            string? firstError = chunk.Count == 1 ? fast.Error : null;
            Summary[]? one = null;
            for (var level = chunk.Count == 1 ? 1 : 0; level <= 2 && one is null; level++)
            {
                var attempt = await TrySummaryAsync(runner, rel, [chunk[i]], level, ct).ConfigureAwait(false);
                firstError ??= attempt.Error;
                if (attempt.Result is { } r)
                    one = [r[0] with { Warning = level > 0 ? $"Some statistics were skipped: {Shorten(firstError)}" : null }];
            }
            result[i] = one?[0] ?? new Summary(0, 0, null, null, null, null, null, null, null, null, firstError ?? "The statement failed.");
        }
        return result;
    }

    private async Task<(Summary[]? Result, string? Error)> TrySummaryAsync(StatementRunner runner, StatsRelation rel, List<ColumnPlan> chunk, int level, CancellationToken ct)
    {
        var (sql, layout) = StatsSql.Summary(rel, chunk, level);
        try
        {
            var row = (await runner.QueryAsync(sql).ConfigureAwait(false)).FirstOrDefault();
            if (row is null) return (null, "The statement returned no row.");
            var rows = ToLong(row[0]);
            var list = new Summary[chunk.Count];
            for (var i = 0; i < chunk.Count; i++)
            {
                var l = layout[i];
                object? At(int ix) => ix >= 0 && ix < row.Length ? row[ix] : null;
                list[i] = new Summary(rows, ToLong(At(l.NonNull)), l.Distinct >= 0 ? ToLong(At(l.Distinct)) : null,
                    l.Min >= 0 ? Display(At(l.Min)) : null, l.Max >= 0 ? Display(At(l.Max)) : null,
                    l.Avg >= 0 ? ToDouble(At(l.Avg)) : null, l.Sum >= 0 ? Display(At(l.Sum)) : null,
                    l.MinLen >= 0 ? ToNullableLong(At(l.MinLen)) : null, l.MaxLen >= 0 ? ToNullableLong(At(l.MaxLen)) : null, null, null);
            }
            return (list, null);
        }
        catch (StatementFailedException ex)
        {
            _log.LogDebug("Column statistics statement failed ({Level}): {Message}", level, ex.Message);
            return (null, ex.Message);
        }
    }

    // ------------------------------------------------------------------ one column

    private async Task<ColumnStats> ProfileColumnAsync(StatementRunner runner, StatsRelation rel, ColumnPlan plan, Summary s, int topN, int bucketCount, CancellationToken ct)
    {
        if (s.Error is not null)
            return new ColumnStats(plan.Name, plan.Type, plan.Kind, 0, 0) { Error = s.Error };
        var nulls = Math.Max(0, s.Rows - s.NonNull);
        var warnings = new List<string>();
        if (s.Warning is not null) warnings.Add(s.Warning);
        var stats = new ColumnStats(plan.Name, plan.Type, plan.Kind, s.Rows, nulls)
        {
            Distinct = s.Distinct, Min = s.Min, Max = s.Max, Avg = s.Avg, Sum = s.Sum, MinLength = s.MinLength, MaxLength = s.MaxLength,
        };
        if (s.NonNull == 0) return stats with { Warning = Join(warnings) };

        IReadOnlyList<TopValue> top = [];
        if (plan.Top)
        {
            // A column whose values are all different has no "most frequent" ones, and grouping it is the costliest statement.
            var allDistinct = s.Distinct is { } dv && dv == s.NonNull && dv > topN;
            if (!allDistinct)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var rows = await runner.QueryAsync(StatsSql.TopValues(rel, plan.Name, topN)).ConfigureAwait(false);
                    top = rows.Select(r => new TopValue(Display(r[0]) ?? "", ToLong(r[1]))).ToList();
                }
                catch (StatementFailedException ex)
                {
                    warnings.Add("Top values: " + Shorten(ex.Message));
                }
            }
        }

        StatsHistogram? hist = null;
        if ((plan.Numeric || plan.Temporal) && s.NonNull > 0)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                hist = await HistogramAsync(runner, rel, plan, s, bucketCount).ConfigureAwait(false);
            }
            catch (StatementFailedException ex)
            {
                warnings.Add("Histogram: " + Shorten(ex.Message));
            }
        }
        return stats with { Top = top, Histogram = hist, Warning = Join(warnings) };
    }

    private static async Task<StatsHistogram?> HistogramAsync(StatementRunner runner, StatsRelation rel, ColumnPlan plan, Summary s, int bucketCount)
    {
        double min, max;
        if (plan.Temporal)
        {
            var range = (await runner.QueryAsync(StatsSql.TemporalRange(rel, plan.Name)).ConfigureAwait(false)).FirstOrDefault();
            if (range is null || ToDouble(range[0]) is not { } lo || ToDouble(range[1]) is not { } hi) return null;
            (min, max) = (lo, hi);
        }
        else
        {
            if (ToDouble(s.Min) is not { } lo || ToDouble(s.Max) is not { } hi) return null;
            (min, max) = (lo, hi);
        }
        if (!double.IsFinite(min) || !double.IsFinite(max)) return null;
        var axis = plan.Temporal ? "time" : "number";
        if (max <= min) return new StatsHistogram(axis, [new HistogramBucket(min, max, s.NonNull)]);

        var n = bucketCount;
        // Few whole numbers: one bar per number rather than bars with nothing in them.
        if (plan.Integer && max - min + 1 < n) n = (int)(max - min) + 1;
        var rows = await runner.QueryAsync(StatsSql.Histogram(rel, plan.Name, plan.Temporal, min, max, n)).ConfigureAwait(false);
        var counts = new long[n];
        foreach (var r in rows)
        {
            if (ToDouble(r[0]) is not { } b) continue;
            var ix = (int)Math.Clamp(Math.Floor(b), 0, n - 1); // the maximum itself falls into bar n: fold it into the last
            counts[ix] += ToLong(r[1]);
        }
        var width = (max - min) / n;
        var list = new List<HistogramBucket>(n);
        for (var i = 0; i < n; i++) list.Add(new HistogramBucket(min + (i * width), i == n - 1 ? max : min + ((i + 1) * width), counts[i]));
        return new StatsHistogram(axis, list);
    }

    // ------------------------------------------------------------------ values

    private static string? Join(List<string> warnings) => warnings.Count == 0 ? null : string.Join(" ", warnings);

    private static string Shorten(string? message)
    {
        var m = (message ?? "").Replace('\r', ' ').Replace('\n', ' ').Trim();
        return m.Length <= 160 ? m : m[..160] + "…";
    }

    private static long ToLong(object? v) => ToNullableLong(v) ?? 0;

    private static long? ToNullableLong(object? v) => v switch
    {
        null => null,
        long l => l,
        int i => i,
        short sh => sh,
        byte b => b,
        double d when double.IsFinite(d) => (long)Math.Round(d),
        float f when float.IsFinite(f) => (long)Math.Round(f),
        decimal m => (long)Math.Round(m),
        string s when long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) => l,
        string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) => (long)Math.Round(d),
        _ => null,
    };

    private static double? ToDouble(object? v) => v switch
    {
        null => null,
        double d => d,
        float f => f,
        long l => l,
        int i => i,
        short sh => sh,
        byte b => b,
        decimal m => (double)m,
        string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    /// <summary>A value as the text the UI shows (wire values are already text for decimals and dates).</summary>
    private static string? Display(object? wire)
    {
        if (wire is null) return null;
        var text = wire switch
        {
            TruncatedValue t => t.Full,
            BinaryValue => "(binary)",
            _ => ValueConverter.ToInvariantString(wire),
        };
        return text.Length <= 200 ? text : text[..200] + "…";
    }

    // ------------------------------------------------------------------ statements

    private sealed class StatementFailedException(string message) : Exception(message);

    /// <summary>Runs SELECT statements one at a time on the profile's session and returns their rows.</summary>
    private sealed class StatementRunner(IDbSession session, IReadOnlyList<QueryParam>? parameters, CancellationToken ct)
    {
        public async Task<List<object?[]>> QueryAsync(string sql)
        {
            ct.ThrowIfCancellationRequested();
            var sink = new CollectSink();
            var request = new ExecuteRequest([new SqlBatch(sql, 1, 1)], 0, true, false, "column-stats", parameters is { Count: > 0 } ? parameters : null);
            var summary = await session.ExecuteAsync(request, sink, ct).ConfigureAwait(false);
            ct.ThrowIfCancellationRequested();
            if (sink.Failure is { } f) throw new StatementFailedException(f.Message);
            if (summary.Status == ExecutionStatus.Cancelled) throw new OperationCanceledException(ct);
            if (summary.Status == ExecutionStatus.Error) throw new StatementFailedException("The statement failed.");
            return sink.Collected;
        }
    }

    private sealed class CollectSink : IExecutionSink
    {
        public List<object?[]> Collected { get; } = [];
        public ErrorInfo? Failure { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows) { Collected.AddRange(rows); return ValueTask.CompletedTask; }
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error) { Failure ??= error; return ValueTask.CompletedTask; }
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }
}
