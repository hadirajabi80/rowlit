using DbStudio.Import.Parsing;

namespace DbStudio.Import.Run;

// Wire shapes of the Import Wizard API (mirror of ui/src/components/ImportWizard/types.ts).

public sealed class PreviewRequest
{
    public string Path { get; set; } = "";
    public SourceOptions? Options { get; set; }
    public int? MaxRows { get; set; }
    /// <summary>Data rows to skip before the preview page (pagination); type inference always samples from the start.</summary>
    public long? Offset { get; set; }
}

public sealed record PreviewColumn(int Index, string Name, InferredType Inferred);

public sealed record PreviewResult(string Path, string FileName, long FileSize, SourceOptions Options, IReadOnlyList<string>? Sheets,
    IReadOnlyList<string>? JsonPaths, IReadOnlyList<PreviewColumn> Columns, IReadOnlyList<IReadOnlyList<string?>> Rows, long SampledRows,
    bool MoreRows, IReadOnlyList<string> Warnings, long Offset = 0, bool HasNextPage = false);

public sealed class TableRefDto
{
    public string? Database { get; set; }
    public string? Schema { get; set; }
    public string Table { get; set; } = "";
}

public sealed record ImportCapabilitiesDto(string ProviderId, string Dialect, bool CanImport, string? Reason, bool ReadOnly, IReadOnlyList<string> Modes,
    bool CanCreateTable, bool Transactional, string BulkMethod, int DefaultBatchSize, int MaxIdentifierLength, IReadOnlyList<string> SqlTypes);

public sealed record TargetColumnDto(string Name, string Type, string Kind, bool Nullable, bool IsPk, bool IsIdentity, bool IsComputed, bool HasDefault, int Ordinal);

public sealed record TargetTableInfo(bool Exists, IReadOnlyList<TargetColumnDto> Columns, IReadOnlyList<string> PrimaryKey, IReadOnlyList<IReadOnlyList<string>> UniqueKeys);

public sealed class NewColumnDto
{
    public string Name { get; set; } = "";
    public string? SqlType { get; set; }
    public bool? Nullable { get; set; }
    public InferredType Inferred { get; set; } = new(Kinds.Text, 255);
}

public sealed class DdlRequest
{
    public string? Database { get; set; }
    public string? Schema { get; set; }
    public string Table { get; set; } = "";
    public List<NewColumnDto> Columns { get; set; } = [];
    public List<string>? PrimaryKey { get; set; }
}

public sealed record DdlColumn(string Name, string SqlType);
public sealed record DdlPreview(string Ddl, IReadOnlyList<DdlColumn> Columns, IReadOnlyList<string> Warnings);

public sealed class ValueSourceDto
{
    public string Kind { get; set; } = "source";
    public int? Index { get; set; }
    public string? Value { get; set; }
    public string? Name { get; set; }
}

public sealed class ColumnMappingDto
{
    public string Target { get; set; } = "";
    public ValueSourceDto From { get; set; } = new();
    public string? SqlType { get; set; }
    public bool? Nullable { get; set; }
    public InferredType? Inferred { get; set; }
}

public sealed class ImportTargetDto
{
    public string? Database { get; set; }
    public string? Schema { get; set; }
    public string Table { get; set; } = "";
    public bool Create { get; set; }
}

public sealed class ImportRequest
{
    public string Path { get; set; } = "";
    public SourceOptions Source { get; set; } = new();
    public ImportTargetDto Target { get; set; } = new();
    public List<ColumnMappingDto> Columns { get; set; } = [];
    public List<string>? PrimaryKey { get; set; }
    public string Mode { get; set; } = "append";
    public List<string>? KeyColumns { get; set; }
    public string OnError { get; set; } = "stop";
    public int? MaxErrors { get; set; }
    public int? BatchSize { get; set; }
    public bool Transaction { get; set; } = true;
    public bool? UseBulk { get; set; }
    public long? Limit { get; set; }
}

public sealed record ImportProgress(string Phase, long Rows, long Written, long Skipped, long Errors, double Rate, long Bytes, long TotalBytes);

public sealed record ImportRowError(long Row, string? Column, string Message, IReadOnlyList<string?>? Values = null);

public sealed record ImportSummary(string Outcome, string? Error, long RowsRead, long RowsWritten, long RowsSkipped, long ErrorCount, long ElapsedMs,
    double RowsPerSecond, bool Committed, bool RolledBack, string? CreatedTable, string? Ddl, IReadOnlyList<ImportRowError> ErrorsSample,
    bool HasErrorReport, string LoadMethod);
