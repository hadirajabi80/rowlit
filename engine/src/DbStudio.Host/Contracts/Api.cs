using System.Text.Json.Nodes;
using DbStudio.Core.Export;
using DbStudio.Core.Models;

namespace DbStudio.Host.Contracts;

// Request/response DTOs of docs/PLAN.md section 3 (mirrors ui/src/api/types.ts). Responses that are plain Core models
// (ConnectionProfile, SessionInfo, ObjectDetails, HistoryEntry, ...) are serialized directly.

public sealed record HealthResponse(string Status, string Version, int Pid, bool Dev);

/// <summary>M2: <paramref name="Dialect"/> is null for non-relational sources; <paramref name="Kind"/> = relational | keyvalue | document | stream.</summary>
public sealed record ProviderInfoResponse(string Id, string DisplayName, Dialect? Dialect, ConnectionFormSpec FormSpec, SourceKind Kind);

/// <summary>POST/PUT /connections body: a profile without id/hasPassword plus the password (null = keep, "" = clear).</summary>
public sealed class ConnectionInput
{
    public string Name { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string? Color { get; set; }
    public string? Folder { get; set; }
    public bool ReadOnly { get; set; }
    public Dictionary<string, JsonNode?> Props { get; set; } = new();
    public bool SavePassword { get; set; } = true;
    public string? Password { get; set; }

    public ConnectionProfile ToProfile() => new()
    {
        Name = Name,
        ProviderId = ProviderId,
        Color = Color,
        Folder = Folder,
        ReadOnly = ReadOnly,
        Props = Props ?? new(),
        SavePassword = SavePassword,
    };
}

public sealed record TestConnectionRequest(ConnectionProfile? Profile, string? Password, bool UseStoredPassword = true);

public sealed record DatabasesResponse(IReadOnlyList<string> Databases, string? Current);

public sealed record RefreshRequest(string? Database, List<string>? Schemas);

public sealed record RefreshResponse(int Version);

public sealed record DdlResponse(string Ddl, string Source);

public sealed record CreateSessionRequest(string ConnectionId, string? Database, TransactionMode TxMode = TransactionMode.Auto, bool CaptureServerOutput = true);

public sealed record DatabaseRequest(string Database);

/// <summary><c>POST /sessions/{sid}/schema</c>: null or empty returns to the schema the session started with.</summary>
public sealed record SchemaRequest(string? Schema);

/// <summary><c>GET /sessions/{sid}/schema</c>: the session's default schema (the one unqualified names resolve to).</summary>
/// <param name="Schema">Null when unknown.</param>
/// <param name="SearchPath">PostgreSQL: the effective search_path, first entry first.</param>
/// <param name="Mode">none (not offered, the request fails with NOT_SUPPORTED) | readOnly (SQL Server) | session.</param>
public sealed record SchemaResponse(string? Schema, IReadOnlyList<string>? SearchPath, DbStudio.Core.Models.SchemaMode Mode);

public sealed record TxModeRequest(TransactionMode TxMode);

public sealed record ExecuteSource(string? TabId, string? Title);

public sealed record ExecuteRequestDto(
    List<SqlBatch>? Batches,
    int? MaxRows,
    bool? StopOnError,
    string? Label,
    ExecuteSource? Source,
    bool? ConfirmedDestructive,
    List<DbStudio.Core.Params.QueryParam>? Params = null,
    bool? SkipHistory = null);

public sealed record ExecuteResponse(string ExecutionId, string StartedAt);

public sealed record CancelResponse(bool Cancelled);

public sealed record RowsPage(ColumnInfo[] Columns, IReadOnlyList<object?[]> Rows, long Total, bool Truncated);

public sealed record CellResponse(string Kind, string? Value, long Len);

public sealed record ResultSetExportRequest(string? Format, string? Path, ExportOptions? Options);

public sealed record ExportFileResponse(string Path, long Rows);

public sealed record QueryExportRequest(string? SessionId, string? Sql, string? Format, string? Path, ExportOptions? Options,
    List<DbStudio.Core.Params.QueryParam>? Params = null);

public sealed record QueryExportResponse(string ExportId);

/// <summary>PUT /history/{id}: partial; null/missing fields are left unchanged.</summary>
public sealed record HistoryUpdateRequest(bool? Pinned);

public sealed record DiagnosticsRequest(Dialect Dialect, string? Sql, string? ConnectionId);

public sealed record DiagnosticsResponse(IReadOnlyList<SqlDiagnostic> Diagnostics, string Engine);
