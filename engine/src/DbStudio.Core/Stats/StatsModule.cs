using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.Stats;

/// <summary>
/// Column statistics, discovered by <c>EngineModules.Discover</c> (Core is always referenced, so the Host needs no change).
/// <list type="bullet">
/// <item><c>POST /stats/columns</c> <see cref="ColumnStatsRequest"/> → 202 { jobId }; the <c>stats.columns</c> job reports a
/// <see cref="StatsProgress"/> as JSON in <c>message</c> (one per finished column) and ends with a <see cref="ColumnStatsResult"/>;
/// <c>DELETE /jobs/{id}</c> cancels</item>
/// </list>
/// </summary>
public sealed class StatsModule : IEngineModule
{
    private const string ClientHeader = "X-DbStudio-Client";

    public void ConfigureServices(IServiceCollection services) =>
        services.AddSingleton(sp => new ColumnStatsService(sp.GetRequiredService<ITransferEnvironment>(), sp.GetRequiredService<JobManager>(),
            sp.GetService<ILogger<ColumnStatsService>>()));

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/stats");

        g.MapPost("/columns", (HttpContext http, ColumnStatsRequest? request, ColumnStatsService svc) =>
            Results.Json(new JobStarted(svc.Start(request, ClientPresence.Normalize(http.Request.Headers[ClientHeader].ToString()))), CoreJson.Options,
                statusCode: StatusCodes.Status202Accepted));
    }
}
