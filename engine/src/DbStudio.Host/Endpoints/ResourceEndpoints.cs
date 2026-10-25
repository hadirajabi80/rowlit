using DbStudio.Core.Services;
using DbStudio.Host.Infrastructure;

namespace DbStudio.Host.Endpoints;

/// <summary>POST /connections/{id}/close body.</summary>
/// <param name="Database">Close only this database (sessions on it and its catalog cache); null = the whole connection.</param>
/// <param name="Force">Roll back open transactions and cancel running work instead of answering 409 RESOURCE_BUSY.</param>
public sealed record CloseResourcesRequest(string? Database = null, bool? Force = null);

/// <summary>POST /resources/report body: memory of the Electron processes (desktop app.getAppMetrics).</summary>
public sealed record AppMemoryReport(long AppBytes);

/// <summary>POST /resources/trim body.</summary>
public sealed record TrimRequest(bool? Aggressive = null);

/// <summary>Resources (docs/resources.md): status-bar popover data, manual close, memory reports.</summary>
public static class ResourceEndpoints
{
    public static RouteGroupBuilder MapResources(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/resources");

        g.MapGet("", (HttpContext http, ResourceManager resources) => resources.Snapshot(http.ClientId()));

        // A window reports the app's memory and gets the snapshot back (one round trip per poll).
        g.MapPost("/report", (HttpContext http, AppMemoryReport? req, ResourceManager resources) =>
        {
            if (req is not null) resources.ReportAppMemory(http.ClientId(), req.AppBytes);
            return resources.Snapshot(http.ClientId());
        });

        // "Free memory now": one policy pass as under critical pressure (idle sessions, caches, GC).
        g.MapPost("/trim", async (HttpContext http, TrimRequest? req, ResourceManager resources) =>
        {
            await resources.RunPolicyAsync(aggressive: req?.Aggressive ?? true);
            return resources.Snapshot(http.ClientId());
        });

        g.MapPost("/close-all", async (HttpContext http, CloseResourcesRequest? req, ResourceManager resources) =>
            await resources.CloseAllAsync(req?.Force ?? false, http.ClientId()));

        var c = api.MapGroup("/connections/{id}");

        c.MapGet("/resources", (HttpContext http, string id, string? database, ResourceManager resources, ConnectionStore store) =>
        {
            store.Get(id); // 404
            return resources.Describe(id, string.IsNullOrWhiteSpace(database) ? null : database, http.ClientId());
        });

        c.MapPost("/close", async (HttpContext http, string id, CloseResourcesRequest? req, ResourceManager resources) =>
            await resources.CloseAsync(id, string.IsNullOrWhiteSpace(req?.Database) ? null : req.Database, req?.Force ?? false, http.ClientId()));

        return api;
    }
}
