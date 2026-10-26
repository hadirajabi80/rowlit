using DbStudio.Core.Models;
using DbStudio.Core.Params;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0): REST wire shapes of the /links endpoints (WP-B implements them in Endpoints/, the UI calls
// them through ui/src/api/links.ts). Links themselves are saved through the existing /connections CRUD, queries run
// through /sessions/{sid}/execute like any console.
//
//   GET    /links/engine                          → FederationEngineInfo              (WP0, Diagnostics/)
//   POST   /links/validate                        LinkValidateRequest  → LinkValidationResult
//   GET    /links/{cid}/catalog                   ?refresh=            → LinkCatalog
//   POST   /links/{cid}/compile                   CompileRequest       → CompileResult
//   POST   /links/{cid}/parse                     ParseRequest         → ParseResult
//   POST   /links/{cid}/plan                      PlanRequest          → PushdownPlan
//   GET    /links/{cid}/views                                          → LinkedView[]
//   PUT    /links/{cid}/views/{id}                LinkedViewInput      → LinkedView     (id "new" creates)
//   DELETE /links/{cid}/views/{id}                                     → 204
//   POST   /links/{cid}/materialize/preview       MaterializeRequest   → MaterializePreview
//   POST   /links/{cid}/materialize               MaterializeRequest   → 202 JobStarted (job.progress; job.done result MaterializeResult)
//   POST   /links/{cid}/native-script             NativeScriptRequest  → NativeScriptResult
//   POST   /links/{cid}/refresh-sources           RefreshSourcesRequest → RefreshSourcesResult
//
// Errors use the usual envelope: 404 NOT_FOUND (link/view), 400 VALIDATION, 403 READ_ONLY (materialize into a read-only
// target), 501 NOT_SUPPORTED (no federation engine), 503 SOURCE_UNAVAILABLE (a member cannot connect).

// ---- validation

/// <param name="Id">The link being edited (its own name is not a conflict), null for a new link.</param>
/// <param name="Probe">Also connect to the members and resolve their tables.</param>
public sealed record LinkValidateRequest(LinkDefinition Definition, string? Id = null, bool Probe = false);

public sealed record LinkValidationResult(bool Ok, IReadOnlyList<LinkProblem> Problems, IReadOnlyList<LinkMemberStatus> Members);

/// <param name="Severity">error | warning (only errors make <see cref="LinkValidationResult.Ok"/> false).</param>
/// <param name="Code"><see cref="LinkProblemCodes"/>.</param>
/// <param name="Member">Index into <see cref="LinkDefinition.Members"/>, when the problem is about one.</param>
/// <param name="Table">Mounted table (link name) concerned, if any.</param>
/// <param name="Relation">Index into <see cref="LinkDefinition.Relations"/>, if any.</param>
public sealed record LinkProblem(string Severity, string Code, string Message, int? Member = null, string? Table = null, int? Relation = null);

public static class LinkProblemCodes
{
    public const string Empty = "empty",
        AliasInvalid = "aliasInvalid", AliasDuplicate = "aliasDuplicate", AliasReserved = "aliasReserved",
        MemberMissing = "memberMissing", MemberUnsupported = "memberUnsupported", MemberLinked = "memberLinked",
        MemberUnreachable = "memberUnreachable",
        TableInvalid = "tableInvalid", TableDuplicate = "tableDuplicate", TableMissing = "tableMissing", NoTables = "noTables",
        RelationInvalid = "relationInvalid";
}

/// <param name="Reachable">Null when not probed.</param>
/// <param name="Tables">Mounted tables found (after resolving AllTables), null when not probed.</param>
public sealed record LinkMemberStatus(int Index, string Alias, string? ProviderId, bool? Reachable, int? Tables, string? Error = null);

// ---- builder compile / parse / plan

/// <param name="Model">The builder model.</param>
/// <param name="Plan">Also compute the push-down plan of the compiled SQL.</param>
public sealed record CompileRequest(BuilderModel Model, bool Plan = false);

/// <param name="Sql">The canonical SQL (BuilderModel.cs header), identical to the UI's builder/compile.ts.</param>
/// <param name="Params">Bind values of the filters ($fp1…).</param>
public sealed record CompileResult(string Sql, IReadOnlyList<QueryParam> Params, IReadOnlyList<PlanWarning> Warnings, PushdownPlan? Plan = null);

public sealed record ParseRequest(string Sql);

/// <summary>SQL → builder model. <see cref="Model"/> null when the SQL is outside the builder subset; <see cref="Reason"/> says why.</summary>
public sealed record ParseResult(BuilderModel? Model, string? Reason = null);

public sealed record PlanRequest(string Sql, IReadOnlyList<QueryParam>? Params = null);

/// <summary>How a federated query reads its sources.</summary>
/// <param name="Engine">"duckdb" | "sqlite".</param>
/// <param name="Parsed">The analyzer used DuckDB's AST (false: text fallback, projection by identifiers, no predicates).</param>
public sealed record PushdownPlan(string Engine, bool Parsed, IReadOnlyList<SourceFetchPlan> Sources, IReadOnlyList<PlanWarning> Warnings);

/// <summary>One mounted table of the query.</summary>
/// <param name="SourceQuery">What the source is (or was) asked (<see cref="ISourceFetcher.Describe"/>).</param>
/// <param name="Columns">Projection (source column names).</param>
/// <param name="Predicates">Pushed predicates.</param>
/// <param name="Limit">Pushed limit.</param>
/// <param name="MaxRows">Row cap.</param>
/// <param name="Rows">Rows fetched (null in a plan computed without fetching).</param>
/// <param name="Truncated">The cap was hit (null when not fetched).</param>
/// <param name="Cached">Served from the session's source cache.</param>
/// <param name="FetchedAt">When the cached copy was fetched.</param>
public sealed record SourceFetchPlan(
    LinkTableRef Table,
    string? ConnectionId,
    string ProviderId,
    string SourceQuery,
    IReadOnlyList<string> Columns,
    IReadOnlyList<PushdownPredicate> Predicates,
    long? Limit,
    long MaxRows,
    long? Rows = null,
    bool? Truncated = null,
    bool Cached = false,
    DateTimeOffset? FetchedAt = null,
    long? ElapsedMs = null);

/// <param name="Code"><see cref="PlanWarningCodes"/>.</param>
/// <param name="Table">The mounted table concerned, if any.</param>
public sealed record PlanWarning(string Code, string Message, LinkTableRef? Table = null);

public static class PlanWarningCodes
{
    /// <summary>A source hit the row cap: results may be incomplete.</summary>
    public const string RowCap = "rowCap";
    /// <summary>The analyzer could not parse the SQL (text fallback: whole tables, projection by identifiers).</summary>
    public const string Fallback = "fallback";
    /// <summary>A join compares columns of different kinds (e.g. int = string).</summary>
    public const string JoinKinds = "joinKinds";
    /// <summary>A join compares text columns with different collations (or CHAR padding).</summary>
    public const string JoinCollation = "joinCollation";
    /// <summary>LIMIT without ORDER BY: which rows come back is arbitrary.</summary>
    public const string LimitWithoutOrder = "limitWithoutOrder";
    /// <summary>A builder table no join reaches (cross product).</summary>
    public const string Cartesian = "cartesian";
    /// <summary>A decimal wider than DECIMAL(38) was read as VARCHAR.</summary>
    public const string DecimalWidened = "decimalWidened";
    /// <summary>Values the engine could not convert were stored as NULL.</summary>
    public const string Conversion = "conversion";
    /// <summary>A Cassandra table is read whole (only partition-key equality pushes).</summary>
    public const string FullScan = "fullScan";
    /// <summary>Served from the source cache (stale data possible: "Refresh sources").</summary>
    public const string Cached = "cached";
    /// <summary>The SQLite fallback engine runs the query (DuckDB unavailable).</summary>
    public const string FallbackEngine = "fallbackEngine";
}

// ---- linked views

/// <summary>A query saved on a link (the explorer shows it under the link's Queries node).</summary>
/// <param name="Builder">The builder model when the view was made (or last edited) in the builder; null for SQL-only views.</param>
public sealed record LinkedView(string Id, string ConnectionId, string Name, string? Description, string Sql, BuilderModel? Builder,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public sealed record LinkedViewInput(string Name, string? Description, string Sql, BuilderModel? Builder);

// ---- materialize

public static class MaterializeModes
{
    /// <summary>CREATE TABLE (fails when it exists).</summary>
    public const string Create = "create";
    /// <summary>DROP + CREATE.</summary>
    public const string Replace = "replace";
    /// <summary>INSERT into an existing table (columns matched by name).</summary>
    public const string Append = "append";
}

/// <summary>Writes the result of a link query (SQL or a linked view) into a table of a writable connection.</summary>
/// <param name="Sql">The query; or <paramref name="ViewId"/>.</param>
/// <param name="TargetConnectionId">A relational, non-read-only connection (403 READ_ONLY otherwise).</param>
/// <param name="Mode"><see cref="MaterializeModes"/>.</param>
/// <param name="BatchSize">Null = the target dialect's default (ImportDialect.DefaultBatchSize).</param>
/// <param name="SessionId">Reuse that console session's source cache.</param>
public sealed record MaterializeRequest(
    string? Sql,
    string? ViewId,
    IReadOnlyList<QueryParam>? Params,
    string TargetConnectionId,
    string? Database,
    string? Schema,
    string Table,
    string Mode = MaterializeModes.Create,
    int? BatchSize = null,
    string? SessionId = null);

/// <summary>DDL the materialize job would run, with the mapped columns.</summary>
public sealed record MaterializePreview(string Dialect, string? Ddl, IReadOnlyList<ColumnInfo> Columns, IReadOnlyList<string> Warnings, bool TableExists);

/// <summary>job.done result of a materialize job.</summary>
public sealed record MaterializeResult(string TargetConnectionId, string? Database, string? Schema, string Table, long Rows, long ElapsedMs,
    IReadOnlyList<PlanWarning> Warnings);

// ---- native links (scripts only, never executed by the engine)

public static class NativeLinkKinds
{
    /// <summary>SQL Server sp_addlinkedserver (+ sp_addlinkedsrvlogin).</summary>
    public const string LinkedServer = "linkedServer";
    /// <summary>PostgreSQL postgres_fdw / mysql_fdw / oracle_fdw / tds_fdw foreign servers + IMPORT FOREIGN SCHEMA.</summary>
    public const string Fdw = "fdw";
    /// <summary>Oracle CREATE DATABASE LINK.</summary>
    public const string DatabaseLink = "dbLink";
    /// <summary>MySQL/MariaDB FEDERATED (MariaDB CONNECT) tables.</summary>
    public const string Federated = "federated";
    /// <summary>ClickHouse ENGINE = PostgreSQL / MySQL tables or database engines.</summary>
    public const string ClickHouseEngine = "clickhouseEngine";
}

/// <summary>A script that makes <paramref name="TargetConnectionId"/>'s server reach a member natively.</summary>
/// <param name="MemberAlias">The member whose server the target should reach.</param>
/// <param name="Kind"><see cref="NativeLinkKinds"/>; null = the default for the target/member pair.</param>
/// <param name="Name">Name of the native link object (linked server, foreign server, DB link); null = derived from the alias.</param>
public sealed record NativeScriptRequest(string TargetConnectionId, string MemberAlias, string? Kind = null, string? Name = null);

/// <param name="Dialect">Dialect of the target (the console the script opens in).</param>
/// <param name="Script">The script; secrets appear as <c>&lt;password&gt;</c>-style placeholders, never real values.</param>
/// <param name="Placeholders">The placeholders the user must replace.</param>
/// <param name="Notes">Prerequisites and caveats (extensions to install, drivers, privileges).</param>
public sealed record NativeScriptResult(Dialect Dialect, string Kind, string Script, IReadOnlyList<string> Placeholders, IReadOnlyList<string> Notes,
    IReadOnlyList<string> AvailableKinds);

// ---- source cache

/// <param name="SessionId">The console session; null = every session of the link.</param>
/// <param name="Tables">Null = all tables.</param>
public sealed record RefreshSourcesRequest(string? SessionId = null, IReadOnlyList<LinkTableRef>? Tables = null);

public sealed record RefreshSourcesResult(int Invalidated);
