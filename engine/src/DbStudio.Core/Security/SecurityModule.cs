using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Core.Security;

public sealed class SecurityModule : IEngineModule
{
    public void ConfigureServices(IServiceCollection services) => services.AddSingleton(sp => new SecurityService(sp.GetRequiredService<ITransferEnvironment>()));

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/security/{connectionId}");
        g.MapGet("/principals", (string connectionId, string? database, SecurityService svc, CancellationToken ct) => svc.ListAsync(connectionId, database, ct));
        g.MapGet("/principal", (string connectionId, string? database, string? name, string? kind, string? host, SecurityService svc, CancellationToken ct) => svc.DetailAsync(connectionId, database, name, kind, host, ct));
        g.MapPost("/script", (string connectionId, SecurityChangeRequest? request, SecurityService svc) => Results.Json(svc.Script(connectionId, request), CoreJson.Options));
        g.MapPost("/apply", (string connectionId, string? database, SecurityChangeRequest? request, SecurityService svc, CancellationToken ct) => svc.ApplyAsync(connectionId, database, request, ct));
    }
}
