using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Core.LocalHistory;

/// <summary>
/// Local history of editors: registers <see cref="LocalHistoryService"/> and maps <c>/local-history</c>. The key of an
/// editor is an opaque string the UI derives from the tab identity, so it travels in the query string / body, never in
/// the path (file paths contain slashes). Discovered by <c>EngineModules.Discover</c> like <c>DiagramsModule</c>.
/// <list type="bullet">
/// <item><c>POST /local-history</c> <c>{ key, text, reason, label?, title? }</c> → <c>{ id, added }</c> (identical text = not added)</item>
/// <item><c>GET /local-history?key=&amp;key=&amp;limit=&amp;before=</c> → snapshots of any of the keys, newest first, without text</item>
/// <item><c>GET /local-history/{id}</c> → the snapshot with its text; <c>PATCH /local-history/{id}</c> <c>{ label }</c>; <c>DELETE /local-history/{id}</c></item>
/// <item><c>DELETE /local-history?key=</c> clears the keys; <c>POST /local-history/prune</c> <c>{ days?, maxBytes?, perKey? }</c></item>
/// </list>
/// </summary>
public sealed class LocalHistoryModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services) => services.AddSingleton<LocalHistoryService>();

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/local-history");

        g.MapPost("", async (SnapshotInput? input, LocalHistoryService svc, CancellationToken ct) =>
            Results.Json(await svc.AddAsync(input, null, ct), CoreJson.Options));

        g.MapGet("", async (string[]? key, int? limit, long? before, LocalHistoryService svc, CancellationToken ct) =>
            Results.Json(await svc.ListAsync(Keys(key), limit ?? 100, before, ct), CoreJson.Options));

        g.MapDelete("", async (string[]? key, LocalHistoryService svc, CancellationToken ct) =>
            Results.Json(new { removed = await svc.ClearAsync(Keys(key), ct) }, CoreJson.Options));

        g.MapPost("/prune", async (PruneRequest? request, LocalHistoryService svc, CancellationToken ct) =>
            Results.Json(await svc.PruneAsync(request, ct), CoreJson.Options));

        g.MapGet("/{id:long}", async (long id, LocalHistoryService svc, CancellationToken ct) =>
            Results.Json(await svc.GetAsync(id, ct), CoreJson.Options));

        g.MapPatch("/{id:long}", async (long id, SnapshotPatch? patch, LocalHistoryService svc, CancellationToken ct) =>
        {
            if (!await svc.LabelAsync(id, patch?.Label, ct)) throw EngineException.NotFound($"Snapshot {id}");
            return Results.Json(await svc.GetAsync(id, ct), CoreJson.Options);
        });

        g.MapDelete("/{id:long}", async (long id, LocalHistoryService svc, CancellationToken ct) =>
        {
            if (!await svc.DeleteAsync(id, ct)) throw EngineException.NotFound($"Snapshot {id}");
            return Results.NoContent();
        });
    }

    private static IReadOnlyList<string> Keys(string[]? key) =>
        (key ?? []).Where((k) => !string.IsNullOrEmpty(k)).Distinct(StringComparer.Ordinal).Take(8).ToList();
}
