using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.DataCompare;

/// <summary>
/// Data compare &amp; sync, discovered by <c>EngineModules.Discover</c> (Core is always referenced, so the Host needs no change).
/// Connections resolve through the transfer environment (<see cref="ITransferEnvironment"/>, i.e. <c>ConnectionStore.ResolveForOpen</c>):
/// <list type="bullet">
/// <item><c>POST /data-compare/columns</c> { source, target, options? } → <see cref="DataComparePreview"/> (column pairs, default key, sync support)</item>
/// <item><c>POST /data-compare</c> { source, target, options? } → 202 { jobId }; the <c>data.compare</c> job reports
/// <see cref="DataCompareProgress"/> as JSON in <c>message</c> and ends with a <see cref="DataCompareResult"/>; <c>DELETE /jobs/{id}</c> cancels</item>
/// <item><c>GET /data-compare/{id}/rows?class=&amp;offset=&amp;limit=</c> → <see cref="DataDiffPage"/></item>
/// <item><c>POST /data-compare/{id}/script</c> { classes?, direction? } → <see cref="DataSyncScript"/></item>
/// <item><c>POST /data-compare/{id}/apply</c> { classes?, direction?, transactional? } → 202 { jobId } (<c>data.sync</c>, result <see cref="DataApplyResult"/>)</item>
/// <item><c>DELETE /data-compare/{id}</c> forgets the comparison</item>
/// </list>
/// </summary>
public sealed class DataCompareModule : IEngineModule
{
    private const string ClientHeader = "X-DbStudio-Client";

    public void ConfigureServices(IServiceCollection services) =>
        services.AddSingleton(sp => new DataCompareService(sp.GetRequiredService<ITransferEnvironment>(), sp.GetRequiredService<JobManager>(),
            sp.GetService<ILogger<DataCompareService>>()));

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/data-compare");

        g.MapPost("/columns", async (DataCompareRequest? request, DataCompareService svc, CancellationToken ct) =>
            Results.Json(await svc.PreviewAsync(request, ct), CoreJson.Options));

        g.MapPost("", (HttpContext http, DataCompareRequest? request, DataCompareService svc) =>
            Results.Json(new JobStarted(svc.Start(request, ClientId(http))), CoreJson.Options, statusCode: StatusCodes.Status202Accepted));

        g.MapGet("/{id}/rows", (string id, string? @class, int? offset, int? limit, DataCompareService svc) =>
            Results.Json(svc.Rows(id, @class, offset ?? 0, limit ?? 200), CoreJson.Options));

        g.MapPost("/{id}/script", (string id, DataSyncRequest? request, DataCompareService svc) =>
            Results.Json(svc.Script(id, request), CoreJson.Options));

        g.MapPost("/{id}/apply", (HttpContext http, string id, DataApplyRequest? request, DataCompareService svc) =>
            Results.Json(new JobStarted(svc.StartApply(id, request, ClientId(http))), CoreJson.Options, statusCode: StatusCodes.Status202Accepted));

        g.MapDelete("/{id}", (string id, DataCompareService svc) =>
        {
            svc.Discard(id);
            return Results.NoContent();
        });
    }

    private static string? ClientId(HttpContext http) => ClientPresence.Normalize(http.Request.Headers[ClientHeader].ToString());
}
