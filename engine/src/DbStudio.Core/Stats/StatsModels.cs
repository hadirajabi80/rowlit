using DbStudio.Core.Params;

namespace DbStudio.Core.Stats;

// Wire contracts of "Column statistics" (profiling a table's columns: nulls, distinct values, min / max, top values and a
// small histogram). camelCase on the wire.

/// <summary>How much of a large table is read.</summary>
public static class StatsSampleModes
{
    /// <summary>Exact up to <see cref="StatsLimits.MaxExactRows"/> rows, a sample of the first rows beyond that (the default).</summary>
    public const string Auto = "auto";
    /// <summary>Read every row (the user asked for it; can be slow on a large table).</summary>
    public const string Exact = "exact";
    /// <summary>Always read at most <c>SampleRows</c> rows.</summary>
    public const string Sample = "sample";

    public static bool IsValid(string? mode) => mode is Auto or Exact or Sample;
}

public static class StatsLimits
{
    /// <summary>A table with more rows than this is sampled in <see cref="StatsSampleModes.Auto"/> mode.</summary>
    public const int MaxExactRows = 1_000_000;
    public const int SampleRows = 100_000;
    public const int TopValues = 10;
    public const int Buckets = 20;
    public const int MaxColumns = 500;
}

/// <summary>
/// <c>POST /stats/columns</c>: profile the columns of a table (or view). <see cref="Where"/> is one condition in the
/// connection's SQL dialect (without the WHERE keyword) that may reference <see cref="Params"/>, the Data tab's filter.
/// </summary>
/// <param name="Database">Catalog database key (null: the connection's default; providers without a database level ignore it).</param>
/// <param name="Schema">Null: the default schema.</param>
/// <param name="Columns">Columns to profile, in order; null or empty = every column.</param>
public sealed record ColumnStatsRequest(string ConnectionId, string? Database, string? Schema, string Table, IReadOnlyList<string>? Columns = null,
    string? Where = null, IReadOnlyList<QueryParam>? Params = null)
{
    /// <summary><see cref="StatsSampleModes"/>; null = auto.</summary>
    public string? Sample { get; init; }
    /// <summary>Rows read when sampling (default <see cref="StatsLimits.SampleRows"/>).</summary>
    public int? SampleRows { get; init; }
    /// <summary>Auto mode samples a table with more rows than this (default <see cref="StatsLimits.MaxExactRows"/>).</summary>
    public int? MaxExactRows { get; init; }
    public int? TopValues { get; init; }
    public int? Buckets { get; init; }
}

/// <summary>A value and how many rows have it.</summary>
public sealed record TopValue(string Value, long Count);

/// <summary>A histogram bar: the values from <see cref="From"/> (inclusive) to <see cref="To"/> (exclusive; the last bar includes it).</summary>
public sealed record HistogramBucket(double From, double To, long Count);

/// <summary><see cref="Axis"/> "number" (the column's own values) or "time" (UNIX seconds, UTC).</summary>
public sealed record StatsHistogram(string Axis, IReadOnlyList<HistogramBucket> Buckets);

/// <summary>
/// The statistics of one column. <see cref="Rows"/> is the rows read (the sample when the table was sampled), so the null
/// share is <c>Nulls / Rows</c>. Optional members are null when the column's type cannot provide them (or the statement
/// failed: see <see cref="Warning"/> / <see cref="Error"/>).
/// </summary>
/// <param name="Kind">numeric | temporal | time | text | bool | guid | other.</param>
public sealed record ColumnStats(string Name, string Type, string Kind, long Rows, long Nulls)
{
    public long? Distinct { get; init; }
    public string? Min { get; init; }
    public string? Max { get; init; }
    public double? Avg { get; init; }
    public string? Sum { get; init; }
    public long? MinLength { get; init; }
    public long? MaxLength { get; init; }
    public IReadOnlyList<TopValue> Top { get; init; } = [];
    public StatsHistogram? Histogram { get; init; }
    /// <summary>Some statistics could not be computed (the rest is valid).</summary>
    public string? Warning { get; init; }
    /// <summary>Nothing could be computed.</summary>
    public string? Error { get; init; }
}

/// <summary>The profile of a table.</summary>
/// <param name="RowsScanned">Rows the statistics are based on.</param>
/// <param name="TableRows">The catalog's row estimate of the table, when it has one.</param>
/// <param name="SampleNote">Why and how the table was sampled (null when every row was read).</param>
public sealed record ColumnStatsResult(string Label, string Dialect, long RowsScanned, bool Sampled, long? TableRows, string? SampleNote,
    IReadOnlyList<ColumnStats> Columns, IReadOnlyList<string> Notes, long ElapsedMs);

/// <summary>Progress of the <c>stats.columns</c> job (JSON in the job's <c>message</c>).</summary>
/// <param name="Phase">preparing | probing | column | done.</param>
/// <param name="Stats">The finished column (phase "column").</param>
public sealed record StatsProgress(string Phase, int Index, int Total, string? Column, ColumnStats? Stats, string? Note = null);
