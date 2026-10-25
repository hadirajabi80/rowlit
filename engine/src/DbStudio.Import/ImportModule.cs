using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Import.Run;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Import;

/// <summary>
/// Composition root of the Import Wizard (discovered through the anchor in <c>Host/ModuleAssemblies.cs</c>):
/// <code>
///   POST   /import/preview                         PreviewRequest      → PreviewResult
///   GET    /connections/{cid}/import/capabilities  ?database=          → ImportCapabilitiesDto
///   POST   /connections/{cid}/import/table-info    TableRefDto         → TargetTableInfo
///   POST   /connections/{cid}/import/ddl           DdlRequest          → DdlPreview
///   POST   /connections/{cid}/import/start         ImportRequest       → 202 { jobId }   (progress: job.progress, result: job.done)
///   GET    /import/errors/{jobId}                  → text/csv error report of a finished job
/// </code>
/// </summary>
public sealed class ImportModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services) => services.AddSingleton<ImportService>();

    public void MapEndpoints(RouteGroupBuilder api)
    {
        api.MapPost("/import/preview", async (PreviewRequest? req, ImportService svc, CancellationToken ct) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            return Results.Json(await svc.PreviewAsync(req, ct).ConfigureAwait(false), CoreJson.Options);
        });

        api.MapGet("/import/errors/{jobId}", (string jobId, ImportService svc) =>
        {
            var path = svc.ErrorReportPath(jobId) ?? throw EngineException.NotFound("The error report");
            return Results.File(path, "text/csv; charset=utf-8", "import-errors.csv");
        });

        var g = api.MapGroup("/connections/{cid}/import");

        g.MapGet("/capabilities", (string cid, ImportService svc) => Results.Json(svc.Capabilities(cid), CoreJson.Options));

        g.MapPost("/table-info", async (string cid, TableRefDto? table, ImportService svc, CancellationToken ct) =>
        {
            if (table is null) throw EngineException.Validation("A request body is required.");
            return Results.Json(await svc.TableInfoAsync(cid, table, ct).ConfigureAwait(false), CoreJson.Options);
        });

        g.MapPost("/ddl", (string cid, DdlRequest? req, ImportService svc) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            return Results.Json(svc.Ddl(cid, req), CoreJson.Options);
        });

        g.MapPost("/start", (string cid, ImportRequest? req, ImportService svc, HttpContext http) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            var jobId = svc.Start(cid, req, ClientPresence.Normalize(http.Request.Headers["X-DbStudio-Client"].ToString()));
            return Results.Json(new JobStarted(jobId), CoreJson.Options, statusCode: StatusCodes.Status202Accepted);
        });
    }
}
