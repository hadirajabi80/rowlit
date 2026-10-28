using System.Text.Json.Serialization;

namespace DbStudio.Core.Transfer;

// Wire contracts of "Data Transfer" (Navicat's data transfer): copy tables (structure and/or data) from one connection /
// database / schema to another, across providers, or write a .sql dump for the target dialect. camelCase on the wire.

/// <summary>Where the rows come from: a relational connection, optionally a database and schema.</summary>
public sealed record TransferSource(string ConnectionId, string? Database = null, string? Schema = null);

/// <summary>
/// Where the rows go: either a connection (<see cref="ConnectionId"/>, optional database and schema) or a SQL file
/// (<see cref="FilePath"/> + <see cref="DumpProvider"/>, the provider id whose dialect the script is written in).
/// </summary>
public sealed record TransferTarget(string? ConnectionId = null, string? Database = null, string? Schema = null,
    string? FilePath = null, string? DumpProvider = null)
{
    [JsonIgnore] public bool IsFile => !string.IsNullOrWhiteSpace(FilePath);
}

/// <summary>One table (or view copied as a table) to transfer.</summary>
/// <param name="Schema">Source schema; null = the source's schema.</param>
/// <param name="Type">"table" (default) | "view".</param>
/// <param name="TargetName">Name of the target table; null = the source name (case-folded per the options).</param>
/// <param name="Where">Optional filter (SQL in the source dialect, without the WHERE keyword).</param>
/// <param name="ColumnTypes">Per-column overrides of the mapped target type, by source column name ("varchar(40)").</param>
/// <param name="ExcludedColumns">Source columns left out of the copy.</param>
public sealed record TransferTableSpec(string Name, string? Schema = null, string? Type = null, string? TargetName = null,
    string? Where = null, Dictionary<string, string>? ColumnTypes = null, List<string>? ExcludedColumns = null);

/// <summary>Create-structure behaviour when the target table already exists.</summary>
public static class CreateModes
{
    /// <summary>Do not create tables: copy data into the existing ones.</summary>
    public const string None = "none";
    /// <summary>Drop the existing table and create it again.</summary>
    public const string DropExisting = "dropExisting";
    /// <summary>Keep an existing table as it is (its data is still copied when requested).</summary>
    public const string SkipExisting = "skipExisting";
    /// <summary>Fail the table when it exists.</summary>
    public const string FailIfExists = "failIfExists";

    public static bool IsKnown(string? s) => s is None or DropExisting or SkipExisting or FailIfExists;
}

public static class DataModes
{
    /// <summary>Structure only.</summary>
    public const string None = "none";
    public const string Append = "append";
    public const string Truncate = "truncate";
    /// <summary>Insert new rows, update rows with the same primary key (PostgreSQL, MySQL, SQLite, SQL Server, Oracle).</summary>
    public const string Upsert = "upsert";

    public static bool IsKnown(string? s) => s is None or Append or Truncate or Upsert;
}

/// <summary>Case folding of generated table / column / constraint names.</summary>
public static class NameCases
{
    /// <summary>PostgreSQL → lower case, Oracle and Snowflake → upper case, everything else keeps the source names.</summary>
    public const string Auto = "auto";
    public const string Keep = "keep";
    public const string Lower = "lower";
    public const string Upper = "upper";

    public static bool IsKnown(string? s) => s is Auto or Keep or Lower or Upper;
}

public sealed record TransferOptions
{
    public string CreateMode { get; init; } = CreateModes.FailIfExists;
    public string DataMode { get; init; } = DataModes.Append;
    public bool Indexes { get; init; } = true;
    public bool PrimaryKeys { get; init; } = true;
    public bool ForeignKeys { get; init; } = true;
    public bool Uniques { get; init; } = true;
    public bool Defaults { get; init; } = true;
    public bool Comments { get; init; } = true;
    /// <summary>Keep identity / auto-increment columns and copy their values (IDENTITY_INSERT, OVERRIDING SYSTEM VALUE, sequence reset).</summary>
    public bool Identity { get; init; } = true;
    /// <summary>Create the target schema (database for MySQL) when it does not exist.</summary>
    public bool CreateSchema { get; init; } = true;
    public int BatchSize { get; init; } = 500;
    public bool ContinueOnError { get; init; }
    public string NameCase { get; init; } = NameCases.Auto;
}

public sealed record TransferSpec(TransferSource Source, TransferTarget Target, List<TransferTableSpec> Tables, TransferOptions? Options = null)
{
    [JsonIgnore] public TransferOptions Opts => Options ?? new TransferOptions();
}

// ------------------------------------------------------------------ plan

/// <summary>One column of the type-mapping preview.</summary>
/// <param name="Name">Source column name.</param>
/// <param name="TargetName">Column name in the target.</param>
/// <param name="SourceType">Type text as the source reports it.</param>
/// <param name="TargetType">Mapped (or user-chosen) target type.</param>
/// <param name="DefaultTargetType">What the mapper proposes (differs from <see cref="TargetType"/> after an override).</param>
/// <param name="Overridden">The user chose <see cref="TargetType"/>.</param>
/// <param name="Excluded">Left out of the copy.</param>
/// <param name="Note">Lossy / noteworthy conversion ("precision reduced to 6", "copied as text").</param>
public sealed record PlannedColumn(string Name, string TargetName, string SourceType, string TargetType, string DefaultTargetType,
    bool Nullable, bool IsPrimaryKey, bool IsIdentity, bool IsComputed, bool Overridden, bool Excluded, string? Note);

public sealed record PlannedTable(string SourceSchema, string SourceName, string SourceType, string TargetSchema, string TargetName,
    List<PlannedColumn> Columns, List<string> CreateStatements, List<string> PostStatements, List<string> Warnings,
    bool ExistsInTarget, long? RowEstimate, string? Where, string? Error);

public sealed record TransferPlan(string SourceProvider, string TargetProvider, string TargetDialect, List<PlannedTable> Tables,
    List<string> Warnings, List<string> SchemaStatements);

// ------------------------------------------------------------------ result

public static class TransferStatus
{
    public const string Ok = "ok", Error = "error", Cancelled = "cancelled", Skipped = "skipped", Partial = "partial";
}

public sealed record TransferTableResult(string Name, string TargetName, string Status, long Rows, long ErrorRows, long ElapsedMs, string? Error,
    bool Created);

public sealed record TransferError(string Table, string Phase, string Message, string? Sql = null);

public sealed record TransferResult(string Status, long TotalRows, long ElapsedMs, List<TransferTableResult> Tables, List<TransferError> Errors,
    string? FilePath, long? FileBytes);

// ------------------------------------------------------------------ support

/// <summary>What a connection can be in a transfer (<c>GET /transfer/support?connectionId=</c>).</summary>
/// <param name="Reason">Why it cannot be a source or a target (null when it can be both).</param>
public sealed record TransferSupport(string ConnectionId, string ProviderId, string? Dialect, bool AsSource, bool AsTarget, string? Reason);

/// <summary>A dialect a .sql dump can be written in (<c>GET /transfer/dump-dialects</c>).</summary>
public sealed record DumpDialect(string Provider, string Name, string Dialect);

/// <summary>JSON carried in the <c>message</c> of <c>job.progress</c> events (the job's done/total are overall rows).</summary>
public sealed record TransferProgress(string Phase, string? Table, int TableIndex, int TableCount, long TableDone, long? TableTotal, long RowsPerSecond,
    string? Message);
