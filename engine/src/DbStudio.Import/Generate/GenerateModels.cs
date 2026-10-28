using DbStudio.Import.Run;

namespace DbStudio.Import.Generate;

// Wire shapes of the mock data generator (mirror of ui/src/api/types.generate.ts).

/// <summary>One option of a generator (rendered as an input by the UI). <c>Type</c>: number | text | multiline | date | datetime | time | bool.</summary>
public sealed record GeneratorOption(string Key, string Label, string Type, string? Default = null, string? Help = null);

/// <param name="Kinds">Column kinds (Kinds.*: int, bigint, decimal, float, bool, date, datetime, time, guid, binary, json, text, other) the generator can fill.</param>
public sealed record GeneratorInfo(string Id, string Label, string Group, IReadOnlyList<string> Kinds, IReadOnlyList<GeneratorOption> Options);

/// <summary>A column of the generator plan: what the engine inferred, editable by the user.</summary>
public sealed class GenerateColumn
{
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public string Kind { get; set; } = "text";
    public bool Nullable { get; set; }
    public bool IsPk { get; set; }
    public bool IsIdentity { get; set; }
    public bool IsComputed { get; set; }
    public bool HasDefault { get; set; }
    /// <summary>Generator id (GeneratorCatalog), <c>foreignKey</c> (values of the parent table) or <c>skip</c> (the column is left out of the INSERT).</summary>
    public string Generator { get; set; } = "skip";
    public Dictionary<string, string?> Options { get; set; } = [];
    /// <summary>0-100: share of rows that get NULL (nullable columns only).</summary>
    public double NullPercent { get; set; }
    /// <summary>Values must be distinct (a unique index covers only this column).</summary>
    public bool Unique { get; set; }
    /// <summary>Name of the foreign key whose parent values fill the column (<c>foreignKey</c> generator).</summary>
    public string? ForeignKey { get; set; }
    /// <summary>Why the engine chose this generator (shown as a hint).</summary>
    public string? Note { get; set; }
}

public sealed record GenerateForeignKey(string Name, IReadOnlyList<string> Columns, string? RefSchema, string RefTable, IReadOnlyList<string> RefColumns, bool ParentHasRows);

public sealed record GeneratePlan(string ProviderId, string Dialect, bool CanGenerate, string? Reason, bool ReadOnly, string Table, long DefaultRows, long MaxRows,
    long Seed, int BatchSize, bool Transactional, IReadOnlyList<GenerateColumn> Columns, IReadOnlyList<GenerateForeignKey> ForeignKeys,
    IReadOnlyList<IReadOnlyList<string>> UniqueKeys, IReadOnlyList<string> Warnings);

/// <summary>The target and the per-column choices of a preview / run.</summary>
public sealed class GenerateRequest
{
    public string ConnectionId { get; set; } = "";
    public string? Database { get; set; }
    public string? Schema { get; set; }
    public string Table { get; set; } = "";
    public long Rows { get; set; } = 1000;
    /// <summary>Same seed, same data (previews match the run). Null: random.</summary>
    public long? Seed { get; set; }
    public List<GenerateColumn> Columns { get; set; } = [];
    public bool TruncateFirst { get; set; }
    public int? BatchSize { get; set; }
    /// <summary>One transaction for the whole run (default); false commits every batch.</summary>
    public bool Transaction { get; set; } = true;
    /// <summary><c>stop</c> (default) or <c>skip</c> rows the server rejects (check constraints, triggers) and report them.</summary>
    public string OnError { get; set; } = "stop";
    public int? MaxErrors { get; set; }
    /// <summary>Preview only: number of rows (1-100).</summary>
    public int? PreviewRows { get; set; }
}

public sealed record GeneratePreviewColumn(string Name, string Type, string Kind);

public sealed record GeneratePreview(IReadOnlyList<GeneratePreviewColumn> Columns, IReadOnlyList<IReadOnlyList<string?>> Rows, IReadOnlyList<string> Warnings, long Seed);

public sealed record GenerateProgress(string Phase, long Rows, long Total, long Written, long Skipped, long Errors, double Rate);

public sealed record GenerateSummary(string Outcome, string? Error, long RowsRequested, long RowsGenerated, long RowsWritten, long RowsSkipped, long ErrorCount,
    long ElapsedMs, double RowsPerSecond, bool Committed, bool RolledBack, bool Truncated, IReadOnlyList<ImportRowError> ErrorsSample, bool HasErrorReport,
    string LoadMethod, long Seed, IReadOnlyList<string> Warnings);
