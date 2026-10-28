using System.Text.Json.Serialization;

namespace DbStudio.Core.DataCompare;

// Wire contracts of "Data compare & sync" (Navicat's data synchronization, Redgate SQL Data Compare): compare the rows of
// two tables (or queries) of any two relational connections, matched on key columns, and script or apply the INSERT /
// UPDATE / DELETE statements that make one side like the other. camelCase on the wire.

/// <summary>
/// One side of a comparison: a table (<see cref="Table"/>) or a query (<see cref="Query"/>, compared but never written),
/// optionally filtered (<see cref="Where"/>, SQL of that side's dialect without the WHERE keyword).
/// </summary>
/// <param name="Database">Catalog database key (null: the connection's default; providers without a database level ignore it).</param>
/// <param name="Schema">Null: the default schema (MySQL/MariaDB: the database; Oracle: the user).</param>
public sealed record DataCompareSide(string ConnectionId, string? Database = null, string? Schema = null, string? Table = null,
    string? Query = null, string? Where = null)
{
    [JsonIgnore] public bool IsQuery => !string.IsNullOrWhiteSpace(Query);
}

/// <summary>How rows are matched and values compared.</summary>
public sealed record DataCompareOptions
{
    /// <summary>Columns that identify a row on both sides; null = the primary key (source first, else target).</summary>
    public List<string>? KeyColumns { get; init; }
    /// <summary>Columns whose values are compared; null = every column both sides have (computed / rowversion columns excluded).</summary>
    public List<string>? Columns { get; init; }
    /// <summary>Columns left out of the value comparison (still copied by inserts).</summary>
    public List<string>? IgnoreColumns { get; init; }
    /// <summary>Text values are compared without leading / trailing white space.</summary>
    public bool TrimText { get; init; }
    /// <summary>Text values are compared case-insensitively (ordinal, invariant).</summary>
    public bool IgnoreCase { get; init; }
    /// <summary>An empty string equals NULL (Oracle stores '' as NULL).</summary>
    public bool EmptyAsNull { get; init; }
    /// <summary>Numbers whose difference is at most this are equal (0 = exact; decimals compare exactly, 1.50 = 1.5).</summary>
    public double NumericTolerance { get; init; }
    /// <summary>Date / time values whose difference is at most this many milliseconds are equal (precision differs between engines).</summary>
    public long TimeToleranceMs { get; init; }
    /// <summary>Differences kept for the grid and the sync script (counts stay exact beyond it).</summary>
    public int MaxDifferences { get; init; } = DataCompareLimits.DefaultMaxDifferences;
    /// <summary>"auto" (default: the servers sort, the engine sorts when that is not reliable), "server" or "engine".</summary>
    public string? Ordering { get; init; }
}

public static class DataCompareLimits
{
    public const int DefaultMaxDifferences = 10_000;
    public const int MaxDifferences = 200_000;
    /// <summary>Rows per side the engine sorts in memory when the servers cannot provide a common order.</summary>
    public const int MaxEngineSortedRows = 1_000_000;
}

public static class DataOrderings
{
    public const string Auto = "auto", Server = "server", Engine = "engine";

    public static bool IsKnown(string? s) => s is null or Auto or Server or Engine;
}

public sealed record DataCompareRequest(DataCompareSide Source, DataCompareSide Target, DataCompareOptions? Options = null);

/// <summary>Row classes of a comparison.</summary>
public static class DiffClasses
{
    public const string Equal = "equal", Changed = "changed", OnlyInSource = "onlyInSource", OnlyInTarget = "onlyInTarget", Duplicate = "duplicate";

    public static bool IsDifference(string? s) => s is Changed or OnlyInSource or OnlyInTarget or Duplicate;

    public static bool IsSyncable(string? s) => s is Changed or OnlyInSource or OnlyInTarget;
}

/// <summary>The direction of a sync: which side is changed.</summary>
public static class SyncDirections
{
    /// <summary>Make the target like the source (the default).</summary>
    public const string ToTarget = "toTarget";
    /// <summary>Make the source like the target.</summary>
    public const string ToSource = "toSource";

    public static bool IsKnown(string? s) => s is null or ToTarget or ToSource;
}

// ------------------------------------------------------------------ columns preview

/// <summary>A column as both sides have it (<c>POST /data-compare/columns</c>).</summary>
/// <param name="Name">The source name (the target name when the source lacks the column).</param>
/// <param name="Kind">How values are compared: numeric | float | bool | temporal | text | guid | binary | json.</param>
/// <param name="Comparable">Both sides have it and it can be compared (computed / rowversion columns are not by default).</param>
public sealed record DataCompareColumnInfo(string Name, string? SourceName, string? TargetName, string? SourceType, string? TargetType,
    bool SourceKey, bool TargetKey, string Kind, bool Comparable, string? Note);

/// <param name="KeyColumns">The key a comparison uses when none is chosen (empty: no primary key on either side).</param>
public sealed record DataComparePreview(List<DataCompareColumnInfo> Columns, List<string> KeyColumns, string SourceDialect, string TargetDialect,
    string SourceLabel, string TargetLabel, DataSyncSupport Sync, List<string> Notes);

/// <summary>Whether a sync script can be written / applied for each direction, and why not.</summary>
public sealed record DataSyncSupport(bool ToTarget, bool ToSource, string? ToTargetReason, string? ToSourceReason, bool ApplyToTarget, bool ApplyToSource);

// ------------------------------------------------------------------ result

public sealed record DataCompareCounts(long Equal, long Changed, long OnlyInSource, long OnlyInTarget, long Duplicate)
{
    [JsonIgnore] public long Differences => Changed + OnlyInSource + OnlyInTarget + Duplicate;
}

/// <summary>A column of the result rows (the arrays of <see cref="DataDiffRow"/> follow this order).</summary>
/// <param name="Compared">Its values take part in the comparison (keys never "change").</param>
public sealed record DataCompareColumn(string Name, string? SourceType, string? TargetType, bool IsKey, bool Compared, string Kind);

/// <summary>One difference. <see cref="Source"/> / <see cref="Target"/> follow <see cref="DataCompareResult.Columns"/>; null on the side without the row.</summary>
/// <param name="Changed">Indexes of the columns whose values differ (changed rows).</param>
public sealed record DataDiffRow(string Class, object?[]? Source, object?[]? Target, int[]? Changed);

/// <param name="Sample">The first differences of each class (at most <see cref="DataCompareService.SamplePerClass"/>), in key order.</param>
/// <param name="TruncatedDiffs">More differences exist than were kept (<see cref="DataCompareOptions.MaxDifferences"/>): the grid and the script cover the kept ones.</param>
/// <param name="Ordering">"server" (both servers sorted by the key) or "engine" (rows sorted in memory).</param>
public sealed record DataCompareResult(string CompareId, DataCompareCounts Counts, List<DataCompareColumn> Columns, List<string> KeyColumns,
    List<DataDiffRow> Sample, long KeptDifferences, bool TruncatedDiffs, string Ordering, long SourceRows, long TargetRows,
    string SourceLabel, string TargetLabel, string SourceDialect, string TargetDialect, DataSyncSupport Sync, List<string> Notes, long ElapsedMs);

/// <summary>A page of differences (<c>GET /data-compare/{id}/rows</c>).</summary>
public sealed record DataDiffPage(string? Class, int Offset, int Total, List<DataDiffRow> Rows);

/// <summary>JSON in the <c>message</c> of <c>data.compare</c> job progress (the job's done = rows read on both sides).</summary>
public sealed record DataCompareProgress(string Phase, long SourceRows, long TargetRows, long Differences, string? Message);

// ------------------------------------------------------------------ sync

/// <param name="Classes">Classes to sync (default: changed, onlyInSource, onlyInTarget).</param>
/// <param name="Direction">toTarget (default) | toSource.</param>
public sealed record DataSyncRequest(List<string>? Classes = null, string? Direction = null);

/// <param name="Transactional">Apply: one transaction, rolled back on the first error (default true); false runs each statement on its own and collects failures.</param>
public sealed record DataApplyRequest(List<string>? Classes = null, string? Direction = null, bool? Transactional = null);

/// <param name="ConnectionId">The connection the script changes.</param>
/// <param name="Database">The database to run it in (console).</param>
public sealed record DataSyncScript(string Text, int Statements, long Inserts, long Updates, long Deletes, List<string> Warnings, string Direction,
    string ConnectionId, string? Database, string Dialect, bool Truncated);

public sealed record DataApplyFailure(int Index, string Sql, string Message);

/// <summary>Result of a <c>data.sync</c> job.</summary>
public sealed record DataApplyResult(string Status, int Executed, int Total, long Inserted, long Updated, long Deleted, bool RolledBack,
    List<DataApplyFailure> Failures, long ElapsedMs);
