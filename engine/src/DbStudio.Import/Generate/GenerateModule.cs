using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Import.Generate;

/// <summary>
/// Mock data generator (lives in the Import assembly to reuse its bulk loaders):
/// <code>
///   GET    /generate/generators                                                  → GeneratorInfo[]
///   GET    /generate/plan?connectionId=&amp;database=&amp;schema=&amp;table=                → GeneratePlan   (inferred generators per column)
///   POST   /generate/preview   GenerateRequest                                   → GeneratePreview (first rows, same seed as the run)
///   POST   /generate/run       GenerateRequest                                   → 202 { jobId }   (job.progress: GenerateProgress, job.done: GenerateSummary)
///   GET    /generate/errors/{jobId}                                              → text/csv of the rows the server rejected
/// </code>
/// </summary>
public sealed class GenerateModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services) => services.AddSingleton<GenerateService>();

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/generate");

        g.MapGet("/generators", () => Results.Json(GeneratorCatalog.All, CoreJson.Options));

        g.MapGet("/plan", async (string connectionId, string? database, string? schema, string table, GenerateService svc, CancellationToken ct) =>
            Results.Json(await svc.PlanAsync(connectionId, database, schema, table, ct).ConfigureAwait(false), CoreJson.Options));

        g.MapPost("/preview", async (GenerateRequest? req, GenerateService svc, CancellationToken ct) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            return Results.Json(await svc.PreviewAsync(req, ct).ConfigureAwait(false), CoreJson.Options);
        });

        g.MapPost("/run", (GenerateRequest? req, GenerateService svc, HttpContext http) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            var jobId = svc.Start(req, ClientPresence.Normalize(http.Request.Headers["X-DbStudio-Client"].ToString()));
            return Results.Json(new JobStarted(jobId), CoreJson.Options, statusCode: StatusCodes.Status202Accepted);
        });

        g.MapGet("/errors/{jobId}", (string jobId, GenerateService svc) =>
        {
            var path = svc.ErrorReportPath(jobId) ?? throw EngineException.NotFound("The error report");
            return Results.File(path, "text/csv; charset=utf-8", "generate-errors.csv");
        });
    }
}
