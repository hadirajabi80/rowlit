namespace DbStudio.Core.SchemaCompare;

// Wire models of Schema Compare / Structure Synchronization (camelCase JSON, ui/src/schemacompare/types.ts).
// Source is the truth, target is changed: "create" = only in the source, "drop" = only in the target, "alter" = different.

/// <summary>One side of a comparison: connection › database › schema. MySQL/MariaDB/Oracle have no database level (schema only).</summary>
public sealed record CompareEndpoint(string ConnectionId, string? Database = null, string? Schema = null);

/// <summary>What is compared and how routine bodies are compared. Everything defaults to on.</summary>
public sealed record CompareOptions
{
    public bool Tables { get; init; } = true;
    public bool Columns { get; init; } = true;
    public bool PrimaryKeys { get; init; } = true;
    public bool ForeignKeys { get; init; } = true;
    public bool Uniques { get; init; } = true;
    public bool Checks { get; init; } = true;
    public bool Indexes { get; init; } = true;
    public bool Defaults { get; init; } = true;
    public bool Comments { get; init; } = true;
    public bool Views { get; init; } = true;
    public bool Procedures { get; init; } = true;
    public bool Functions { get; init; } = true;
    public bool Triggers { get; init; } = true;
    public bool Sequences { get; init; } = true;
    /// <summary>Routine, view and trigger bodies: whitespace differences do not count.</summary>
    public bool IgnoreWhitespace { get; init; } = true;
    /// <summary>Keywords and identifiers compare case-insensitively (string literals always compare exactly).</summary>
    public bool IgnoreCase { get; init; } = true;
    public bool IgnoreComments { get; init; } = true;
    /// <summary>Column collations do not count.</summary>
    public bool IgnoreCollation { get; init; } = true;
    /// <summary>Names of constraints and indexes do not count (a differently named but identical key is the same key).</summary>
    public bool IgnoreConstraintNames { get; init; }
}

public sealed record CompareRequest(CompareEndpoint? Source, CompareEndpoint? Target, CompareOptions? Options);

public static class CompareStatus
{
    public const string Create = "create", Drop = "drop", Alter = "alter", Identical = "identical";
}

/// <summary>Object kinds of the result list ("tablefunc" is a "func").</summary>
public static class CompareKinds
{
    public const string Table = "table", View = "view", Proc = "proc", Func = "func", Trigger = "trigger", Sequence = "sequence",
        Type = "type", Package = "package";
}

/// <param name="Severity">"dataLoss" (rows or columns are lost, or a value may not fit) | "warning" | "info".</param>
public sealed record CompareWarning(string Severity, string Message);

/// <param name="Id">Stable within one comparison: "table:Orders", "func:fn_tax(numeric)".</param>
/// <param name="Changes">Human-readable list of what differs (alter) or what is created / dropped.</param>
/// <param name="Detail">Trigger: the table it fires on. Views / routines: nothing.</param>
public sealed record CompareItem(string Id, string Kind, string Name, string Status, IReadOnlyList<string> Changes,
    IReadOnlyList<CompareWarning> Warnings, string? Detail = null);

public sealed record CompareCounts(int Create, int Drop, int Alter, int Identical);

public sealed record CompareResult(string CompareId, string ProviderId, string Dialect, string SourceLabel, string TargetLabel,
    string SourceSchema, string TargetSchema, IReadOnlyList<CompareItem> Items, CompareCounts Counts, IReadOnlyList<string> Notes,
    bool TransactionalDdl, long ElapsedMs);

public sealed record ScriptStatement(string Sql, string Kind, string? ItemId, string? Warning);

public sealed record ItemWarning(string ItemId, string Severity, string Message);

public sealed record CompareScript(IReadOnlyList<ScriptStatement> Statements, string Text, IReadOnlyList<ItemWarning> Warnings,
    bool TransactionalDdl, int ItemCount);

public sealed record CompareItemDetail(CompareItem Item, string? SourceDdl, string? TargetDdl, IReadOnlyList<ScriptStatement> Statements);

/// <param name="ItemIds">Items to apply; null = every item that differs.</param>
/// <param name="StopOnError">true: one run, rolled back on the first error where the provider has transactional DDL;
/// false: statement by statement, failures are collected and the run continues.</param>
public sealed record CompareScriptRequest(IReadOnlyList<string>? ItemIds);

public sealed record CompareApplyRequest(IReadOnlyList<string>? ItemIds, bool? StopOnError);

public sealed record CompareApplyFailure(int Index, string Sql, string Message, string? Code, string? ItemId);

public sealed record CompareApplyResult(bool Ok, int Executed, int Total, bool RolledBack, bool TransactionalDdl, long ElapsedMs,
    IReadOnlyList<CompareApplyFailure> Failures);
