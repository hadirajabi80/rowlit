using System.Data.Common;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Services;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0). The seam between WP-A (implements it: Runtime/LinkRuntime.cs) and WP-B (endpoints, views,
// materialize, compile/parse consume it). Registered as a singleton in FederationModule (block LINKS-WPA); until WP-A
// lands, Runtime/UnavailableLinkRuntime.cs answers (SerializeSqlAsync works, everything else is 501 NOT_SUPPORTED).

/// <summary>Link-level services over the federation engine: definitions, catalog, plans, queries and the source cache.</summary>
public interface ILinkRuntime
{
    /// <summary>The definition of link <paramref name="linkId"/> (404 when missing, 400 when the connection is not a link).</summary>
    LinkDefinition Definition(string linkId);

    /// <summary>
    /// Checks a definition (aliases, members, tables, relations); with <paramref name="probe"/> also connects to every
    /// member and resolves its catalog (reachable / tables found). <paramref name="linkId"/>: the link being edited, if any.
    /// </summary>
    Task<LinkValidationResult> ValidateAsync(LinkDefinition definition, string? linkId, bool probe, CancellationToken ct);

    /// <summary>The resolved catalog of a link: per member alias the mounted tables with columns (cached; <paramref name="refresh"/> reloads).</summary>
    Task<LinkCatalog> CatalogAsync(string linkId, bool refresh, CancellationToken ct);

    /// <summary>The push-down plan of a query (no fetching): what each source would be asked for, plus warnings.</summary>
    Task<PushdownPlan> PlanAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct);

    /// <summary>
    /// Runs one query over the link outside a console session (materialize, previews): fetches the sources (reusing the
    /// cache of <see cref="LinkQueryOptions.SessionId"/> when given), runs the SQL and hands back the reader.
    /// Read-only: a non-query statement is refused with 403 READ_ONLY.
    /// </summary>
    Task<LinkQuery> OpenQueryAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, LinkQueryOptions options, CancellationToken ct);

    /// <summary>Drops cached sources of a session (or of every session of the link when <paramref name="sessionId"/> is null); null tables = all. Returns the number dropped.</summary>
    Task<int> RefreshSourcesAsync(string linkId, string? sessionId, IReadOnlyList<LinkTableRef>? tables, CancellationToken ct);

    /// <summary>DuckDB's <c>json_serialize_sql</c> of <paramref name="sql"/> on a short-lived engine (the builder's SQL → model parse).</summary>
    Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct);

    /// <summary>
    /// One level of a member (<c>POST /links/{cid}/browse</c>): the databases or schemas a wide member spans, or the tables of
    /// one container (with columns). Loaded on demand and cached like the catalog.
    /// </summary>
    Task<LinkBrowseResult> BrowseAsync(string linkId, LinkBrowseRequest request, CancellationToken ct) =>
        throw new EngineException(501, ErrorCodes.NotSupported, "Browsing link members is not supported by this runtime.");

    /// <summary>Mounted tables by link name, loading the containers of wide members they live in (<c>POST /links/{cid}/resolve</c>).</summary>
    Task<LinkResolveResult> ResolveTablesAsync(string linkId, IReadOnlyList<LinkTableRef> tables, CancellationToken ct) =>
        throw new EngineException(501, ErrorCodes.NotSupported, "Resolving link tables is not supported by this runtime.");

    /// <summary>
    /// <paramref name="sql"/> with the multi-part names of wide members rewritten to engine names, and the catalog extended
    /// with the tables it names (builder parse, plans).
    /// </summary>
    async Task<LinkSqlResolution> ResolveSqlAsync(string linkId, string sql, CancellationToken ct) =>
        new(sql, await CatalogAsync(linkId, false, ct).ConfigureAwait(false));
}

/// <param name="SessionId">Reuse (and fill) the source cache of this federated session.</param>
/// <param name="Progress">Fetch progress per source (rows so far).</param>
/// <param name="MaxRowsPerSource">Overrides the row cap ("fetch all" = long.MaxValue).</param>
public sealed record LinkQueryOptions(string? SessionId = null, IProgress<LinkFetchProgress>? Progress = null, long? MaxRowsPerSource = null);

public sealed record LinkFetchProgress(LinkTableRef Table, long Rows, bool Done);

/// <summary>An open federated query. Dispose to release the reader and the engine it runs on.</summary>
public sealed class LinkQuery(DbDataReader reader, IReadOnlyList<ColumnInfo> columns, PushdownPlan plan, IAsyncDisposable? owner = null) : IAsyncDisposable
{
    public DbDataReader Reader { get; } = reader;

    /// <summary>Result columns (kinds as the console reports them).</summary>
    public IReadOnlyList<ColumnInfo> Columns { get; } = columns;

    /// <summary>The plan as executed (row counts, truncation and cache flags filled in).</summary>
    public PushdownPlan Plan { get; } = plan;

    public async ValueTask DisposeAsync()
    {
        await Reader.DisposeAsync().ConfigureAwait(false);
        if (owner is not null) await owner.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>The resolved catalog of a link.</summary>
public sealed record LinkCatalog(IReadOnlyList<LinkCatalogSchema> Schemas, IReadOnlyList<VirtualRelation> Relations);

/// <summary>One member as a schema of the link.</summary>
/// <param name="Error">Why the member's catalog could not load (unreachable, missing connection…); Tables is then empty.</param>
/// <param name="Scope">The member's <see cref="LinkScopes"/> token.</param>
/// <param name="Levels">
/// Wide scopes: the name levels between the alias and a table, outermost first ("database", "schema"): empty when the
/// provider has nothing to span (the member then behaves like a schema member). Null for tables / schema members.
/// </param>
/// <param name="DefaultPath">
/// Wide scopes: the default container, one name per level (<c>["shop", "dbo"]</c>); its tables are <see cref="Tables"/>
/// and answer to <c>alias.table</c>. Other containers load on demand (<c>POST /links/{cid}/browse</c>, queries).
/// </param>
public sealed record LinkCatalogSchema(string Alias, string Kind, string? ConnectionId, string? ProviderId, IReadOnlyList<SourceTable> Tables,
    IReadOnlyList<string> Warnings, string? Error = null, string? Scope = null, IReadOnlyList<string>? Levels = null,
    IReadOnlyList<string>? DefaultPath = null);

/// <summary>A link statement with its multi-part names resolved (Runtime/LinkNames.cs).</summary>
/// <param name="Sql">The statement as the engine runs it (<c>crm.sales.orders</c> → <c>crm."sales.orders"</c>).</param>
/// <param name="Catalog">The link catalog plus every table of a wide member the statement names.</param>
public sealed record LinkSqlResolution(string Sql, LinkCatalog Catalog);
