using DbStudio.Core.Catalog;
using DbStudio.Core.Providers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Core.Services.Portability;

/// <summary>
/// WP-5: exports and imports saved connections (settings, SSH tunnel included; passwords only under a passphrase).
/// Discovered by <c>EngineModules.Discover</c>; no Host change.
/// <list type="bullet">
/// <item><c>POST /connections/export</c> <c>{ ids?, includeSecrets?, passphrase? }</c> → <c>{ fileName, content, count, secretsIncluded, skipped }</c></item>
/// <item><c>POST /connections/import/preview</c> <c>{ content, passphrase? }</c> → the connections of the file with a proposed action (new / update by name / skip)</item>
/// <item><c>POST /connections/import</c> <c>{ content, passphrase?, actions? }</c> → <c>{ created, updated, skipped, items, errors, passwordsImported }</c></item>
/// </list>
/// A wrong passphrase answers 400 VALIDATION with <c>detail.field = "passphrase"</c>.
/// </summary>
public sealed class ConnectionsPortabilityModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services) => services.AddSingleton<ConnectionsPortabilityService>();

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/connections");

        // the key derivation takes a few hundred ms of CPU: off the request thread
        g.MapPost("/export", (ExportRequest? request, ConnectionsPortabilityService svc) =>
            Task.Run(() => Results.Json(svc.Export(request), CoreJson.Options)));

        g.MapPost("/import/preview", (ImportPreviewRequest? request, ConnectionsPortabilityService svc) =>
            Task.Run(() => Results.Json(svc.Preview(request), CoreJson.Options)));

        g.MapPost("/import", async (ImportRequest? request, ConnectionsPortabilityService svc, IServiceProvider services) =>
        {
            var result = await Task.Run(() => svc.Import(request));
            var catalog = services.GetRequiredService<CatalogService>();
            var clients = services.GetRequiredService<SourceClientManager>();
            // an updated connection may point elsewhere now: forget its catalog and drop its source client (as PUT /connections/{id})
            foreach (var item in result.Items.Where(i => i.Action == ConnectionsFormat.ActionUpdate && i.Id is not null))
            {
                catalog.Forget(item.Id!);
                await clients.CloseAsync(item.Id!, "connection imported");
            }
            return Results.Json(result, CoreJson.Options);
        });
    }
}
