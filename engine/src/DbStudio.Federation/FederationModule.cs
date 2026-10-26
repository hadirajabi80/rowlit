using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;
using DbStudio.Federation.Runtime;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DbStudio.Federation;

/// <summary>
/// Composition root of linked databases (plan-links), discovered through the anchor in <c>Host/ModuleAssemblies.cs</c>.
/// Shared by two work packages: each edits only its own labelled block (docs/wp-notes/links/wp0.md, rule R1).
/// WP0 registers nothing user-visible: no <see cref="IDbProvider"/> "linked" yet, so <c>GET /providers</c> is unchanged.
/// </summary>
public sealed class FederationModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services)
    {
        // LINKS-WPA begin (engine core: LinkedProvider, IFederationEngineFactory, ILinkRuntime, RelationalFetcher per provider id)
        // WP-A replaces the placeholder runtime and adds, e.g.:
        //   services.AddSingleton<IDbProvider, LinkedProvider>();
        //   services.AddSingleton<IFederationEngineFactory, DuckDbEngineFactory>();
        //   services.AddSingleton<ILinkRuntime, LinkRuntime>();
        //   foreach (var id in RelationalFetcher.ProviderIds) services.AddKeyedSingleton<ISourceFetcher, RelationalFetcher>(id);
        services.TryAddSingleton<ILinkRuntime, UnavailableLinkRuntime>();
        // LINKS-WPA end

        // LINKS-WPB begin (engine services: views, materialize, native scripts, compile/parse, P3 fetchers)
        //   services.AddSingleton<LinkedViewStore>(); services.AddSingleton<MaterializeService>(); …
        //   services.AddKeyedSingleton<ISourceFetcher, MongoFetcher>("mongodb"); …("elasticsearch"); …(FetcherKeys.Files);
        // LINKS-WPB end
    }

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var links = api.MapGroup("/links");

        // WP0: which federation engine this build can run (forces the libduckdb load; used by the native smoke test).
        links.MapGet("/engine", () => Results.Json(DuckDbProbe.Info, CoreJson.Options));

        // LINKS-WPB begin (Endpoints/LinkEndpoints.cs: validate, catalog, compile, parse, plan, views, materialize,
        // native-script, refresh-sources; route table in Contracts/LinkApi.cs)
        //   LinkEndpoints.Map(links);
        // LINKS-WPB end
    }
}
