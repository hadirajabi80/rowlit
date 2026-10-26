using DbStudio.Core.Params;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;

namespace DbStudio.Federation.Runtime;

/// <summary>
/// WP0 placeholder of <see cref="ILinkRuntime"/> so WP-B's endpoints resolve and can be tested before WP-A lands:
/// <see cref="SerializeSqlAsync"/> really parses (DuckDB), <see cref="Definition"/> reads the profile, everything else
/// answers 501 NOT_SUPPORTED. WP-A replaces its registration (FederationModule, block LINKS-WPA) with Runtime/LinkRuntime.cs
/// and may delete this file.
/// </summary>
public sealed class UnavailableLinkRuntime(ConnectionStore connections) : ILinkRuntime
{
    public LinkDefinition Definition(string linkId)
    {
        var profile = connections.Get(linkId);
        if (profile.ProviderId != LinkIds.ProviderId)
            throw EngineException.Validation($"The connection '{profile.Name}' is not a linked database.", new { field = "connectionId" });
        return LinkDefinition.FromProfile(profile);
    }

    public Task<LinkValidationResult> ValidateAsync(LinkDefinition definition, string? linkId, bool probe, CancellationToken ct) => throw Unavailable();

    public Task<LinkCatalog> CatalogAsync(string linkId, bool refresh, CancellationToken ct) => throw Unavailable();

    public Task<PushdownPlan> PlanAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct) => throw Unavailable();

    public Task<LinkQuery> OpenQueryAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, LinkQueryOptions options, CancellationToken ct) =>
        throw Unavailable();

    public Task<int> RefreshSourcesAsync(string linkId, string? sessionId, IReadOnlyList<LinkTableRef>? tables, CancellationToken ct) => throw Unavailable();

    public Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct) => Task.Run(() => DuckDbProbe.SerializeSql(sql), ct);

    private static EngineException Unavailable() =>
        new(501, ErrorCodes.NotSupported, "Linked databases are not available in this build yet.");
}
