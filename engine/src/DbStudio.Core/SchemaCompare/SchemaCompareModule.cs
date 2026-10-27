using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Core.SchemaCompare;

/// <summary>
/// Schema compare / structure synchronization, discovered by <c>EngineModules.Discover</c> like <c>DiagramsModule</c>:
/// <list type="bullet">
/// <item><c>POST /schema-compare</c> { source, target, options } → 202 { jobId }; the <c>schema.compare</c> job ends with a
/// <see cref="CompareResult"/> (<c>job.done</c>); <c>DELETE /jobs/{id}</c> cancels</item>
/// <item><c>GET /schema-compare/{id}/items?item=…</c> → <see cref="CompareItemDetail"/> (both definitions + the item's statements)</item>
/// <item><c>POST /schema-compare/{id}/script</c> { itemIds? } → <see cref="CompareScript"/></item>
/// <item><c>POST /schema-compare/{id}/apply</c> { itemIds?, stopOnError? } → <see cref="CompareApplyResult"/> (executes on the target)</item>
/// <item><c>DELETE /schema-compare/{id}</c> forgets the comparison</item>
/// </list>
/// </summary>
public sealed class SchemaCompareModule : IEngineModule
{
    private const string ClientHeader = "X-DbStudio-Client";

    public void ConfigureServices(IServiceCollection services) => services.AddSingleton<SchemaCompareService>();

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/schema-compare");

        g.MapPost("", (HttpContext http, CompareRequest? request, SchemaCompareService service) =>
        {
            var jobId = service.Start(request, ClientId(http));
            return Results.Json(new JobStarted(jobId), CoreJson.Options, statusCode: StatusCodes.Status202Accepted);
        });

        g.MapGet("/{id}/item", async (string id, string? item, SchemaCompareService service, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(item)) throw EngineException.Validation("item is required.", new { field = "item" });
            return Results.Json(await service.ItemAsync(id, item, ct), CoreJson.Options);
        });

        g.MapPost("/{id}/script", async (string id, CompareScriptRequest? request, SchemaCompareService service, CancellationToken ct) =>
            Results.Json(await service.ScriptAsync(id, request, ct), CoreJson.Options));

        g.MapPost("/{id}/apply", async (HttpContext http, string id, CompareApplyRequest? request, SchemaCompareService service, CancellationToken ct) =>
            Results.Json(await service.ApplyAsync(id, request, ClientId(http), ct), CoreJson.Options));

        g.MapDelete("/{id}", (string id, SchemaCompareService service) =>
        {
            service.Discard(id);
            return Results.NoContent();
        });
    }

    private static string? ClientId(HttpContext http) => ClientPresence.Normalize(http.Request.Headers[ClientHeader].ToString());
}
