using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.Transfer;

/// <summary>
/// Composition root of Data Transfer, discovered by <c>EngineModules.Discover</c> (Core is always referenced, so the Host needs
/// no change):
/// <list type="bullet">
/// <item><c>POST /transfer/plan</c>: type mapping + target DDL preview (<see cref="TransferPlan"/>);</item>
/// <item><c>POST /transfer/run</c>: 202 <c>{ jobId }</c>; <c>job.progress</c> carries a <see cref="TransferProgress"/> as JSON in
/// <c>message</c> (done / total = rows overall), <c>job.done.result</c> is a <see cref="TransferResult"/>; <c>DELETE /jobs/{id}</c> cancels;</item>
/// <item><c>GET /transfer/types?provider=&amp;connectionId=</c>: the types a target provider accepts;</item>
/// <item><c>GET /transfer/support?connectionId=</c>: <see cref="TransferSupport"/> (source / target / why not);</item>
/// <item><c>GET /transfer/dump-dialects</c>: the dialects a .sql dump can be written in.</item>
/// </list>
/// </summary>
public sealed class TransferModule : IEngineModule
{
    public const string JobKind = "transfer.run";
    private const string ClientHeader = "X-DbStudio-Client";

    public void ConfigureServices(IServiceCollection services)
    {
        services.AddSingleton<ITransferEnvironment>(sp => new EngineTransferEnvironment(sp.GetRequiredService<ConnectionStore>(),
            sp.GetRequiredService<ProviderRegistry>(), sp.GetRequiredService<ProviderFeatures>()));
        services.AddSingleton(sp => new TransferService(sp.GetRequiredService<ITransferEnvironment>(), sp.GetService<ILogger<TransferService>>()));
    }

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/transfer");

        g.MapPost("/plan", async (TransferSpec? spec, TransferService svc, CancellationToken ct) =>
        {
            if (spec is null) throw EngineException.Validation("A request body is required.");
            svc.Check(spec);
            return Results.Json(await svc.PlanAsync(spec, ct), CoreJson.Options);
        });

        g.MapPost("/run", (TransferSpec? spec, HttpContext http, TransferService svc, JobManager jobs) =>
        {
            if (spec is null) throw EngineException.Validation("A request body is required.");
            svc.Check(spec);
            var owner = ClientPresence.Normalize(http.Request.Headers[ClientHeader].ToString());
            var last = ("", -1);
            var id = jobs.Start(JobKind, spec.Target.ConnectionId ?? spec.Source.ConnectionId, owner, async (ctx, ct) =>
                await svc.RunAsync(spec, (p, done, total) =>
                {
                    var key = (p.Phase, p.TableIndex);
                    var force = key != last;
                    last = key;
                    ctx.Report(done, total, TransferService.ProgressJson(p), force);
                }, ct).ConfigureAwait(false));
            return Results.Json(new JobStarted(id), CoreJson.Options, statusCode: 202);
        });

        g.MapGet("/types", async (string provider, string? connectionId, TransferService svc, CancellationToken ct) =>
            Results.Json(await svc.TargetTypesAsync(provider, connectionId, ct), CoreJson.Options));

        g.MapGet("/support", (string? connectionId, TransferService svc) =>
            Results.Json(svc.Support(connectionId ?? ""), CoreJson.Options));

        g.MapGet("/dump-dialects", (TransferService svc) => Results.Json(svc.DumpDialects(), CoreJson.Options));
    }
}
