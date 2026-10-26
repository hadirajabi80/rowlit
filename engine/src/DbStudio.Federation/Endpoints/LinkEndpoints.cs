using DbStudio.Core.Services;
using DbStudio.Federation.Builder;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Materialize;
using DbStudio.Federation.Native;
using DbStudio.Federation.Views;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace DbStudio.Federation.Endpoints;

/// <summary>
/// The <c>/links</c> routes of Contracts/LinkApi.cs (validate, catalog, compile, parse, plan, views, materialize,
/// native-script, refresh-sources), mapped by FederationModule (block LINKS-WPB). Everything goes through
/// <see cref="ILinkRuntime"/>; bodies are null-checked (400 VALIDATION), results use <see cref="CoreJson.Options"/>.
/// </summary>
public static class LinkEndpoints
{
    public static void Map(RouteGroupBuilder links)
    {
        links.MapPost("/validate", async (LinkValidateRequest? req, ILinkRuntime runtime, CancellationToken ct) =>
        {
            if (req?.Definition is null) throw EngineException.Validation("definition is required.", new { field = "definition" });
            return Json(await runtime.ValidateAsync(req.Definition, req.Id, req.Probe, ct).ConfigureAwait(false));
        });

        links.MapGet("/{cid}/catalog", async (string cid, bool? refresh, ILinkRuntime runtime, CancellationToken ct) =>
            Json(await runtime.CatalogAsync(cid, refresh ?? false, ct).ConfigureAwait(false)));

        links.MapPost("/{cid}/compile", async (string cid, CompileRequest? req, ILinkRuntime runtime, CancellationToken ct) =>
        {
            if (req?.Model is null) throw EngineException.Validation("model is required.", new { field = "model" });
            runtime.Definition(cid);
            var catalog = BuilderCatalog.From(await runtime.CatalogAsync(cid, false, ct).ConfigureAwait(false));
            var result = BuilderCompiler.Compile(req.Model, catalog);
            if (req.Plan) result = result with { Plan = await runtime.PlanAsync(cid, result.Sql, result.Params, ct).ConfigureAwait(false) };
            return Json(result);
        });

        links.MapPost("/{cid}/parse", async (string cid, ParseRequest? req, ILinkRuntime runtime, CancellationToken ct) =>
        {
            if (req?.Sql is null) throw EngineException.Validation("sql is required.", new { field = "sql" });
            runtime.Definition(cid);
            BuilderCatalog catalog;
            // Without the catalog, alias.table.column and as.column references still resolve.
            try { catalog = BuilderCatalog.From(await runtime.CatalogAsync(cid, false, ct).ConfigureAwait(false)); }
            catch (EngineException e) when (e.Status is 501 or 503) { catalog = BuilderCatalog.Empty; }
            return Json(await BuilderParser.ParseAsync(req.Sql, catalog, runtime.SerializeSqlAsync, ct).ConfigureAwait(false));
        });

        links.MapPost("/{cid}/plan", async (string cid, PlanRequest? req, ILinkRuntime runtime, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req?.Sql)) throw EngineException.Validation("sql is required.", new { field = "sql" });
            return Json(await runtime.PlanAsync(cid, req.Sql, req.Params, ct).ConfigureAwait(false));
        });

        // ---- linked views
        links.MapGet("/{cid}/views", (string cid, ILinkRuntime runtime, LinkedViewStore views) =>
        {
            runtime.Definition(cid);
            return Json(views.List(cid));
        });

        links.MapPut("/{cid}/views/{id}", (string cid, string id, LinkedViewInput? input, ILinkRuntime runtime, LinkedViewStore views) =>
        {
            runtime.Definition(cid);
            return Json(views.Save(cid, id, input));
        });

        links.MapDelete("/{cid}/views/{id}", (string cid, string id, ILinkRuntime runtime, LinkedViewStore views) =>
        {
            runtime.Definition(cid);
            views.Delete(cid, id);
            return Results.NoContent();
        });

        // ---- materialize
        links.MapPost("/{cid}/materialize/preview", async (string cid, MaterializeRequest? req, MaterializeService svc, CancellationToken ct) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            return Json(await svc.PreviewAsync(cid, req, ct).ConfigureAwait(false));
        });

        links.MapPost("/{cid}/materialize", (string cid, MaterializeRequest? req, MaterializeService svc, HttpContext http) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            var jobId = svc.Start(cid, req, ClientPresence.Normalize(http.Request.Headers["X-DbStudio-Client"].ToString()));
            return Results.Json(new JobStarted(jobId), CoreJson.Options, statusCode: StatusCodes.Status202Accepted);
        });

        // ---- native links
        links.MapPost("/{cid}/native-script", async (string cid, NativeScriptRequest? req, ILinkRuntime runtime, ConnectionStore connections,
            ProviderRegistry providers, CancellationToken ct) =>
        {
            if (req is null) throw EngineException.Validation("A request body is required.");
            if (string.IsNullOrWhiteSpace(req.TargetConnectionId)) throw EngineException.Validation("targetConnectionId is required.", new { field = "targetConnectionId" });
            if (string.IsNullOrWhiteSpace(req.MemberAlias)) throw EngineException.Validation("memberAlias is required.", new { field = "memberAlias" });
            var definition = runtime.Definition(cid);
            var member = definition.FindMember(req.MemberAlias) ?? throw EngineException.NotFound($"Member '{req.MemberAlias}'");
            if (member.Kind != LinkMemberKinds.Connection || string.IsNullOrEmpty(member.ConnectionId))
                throw EngineException.Validation("Native links reach database servers: a files member has none.", new { field = "memberAlias" });
            var target = connections.Get(req.TargetConnectionId);
            if (target.ProviderId == LinkIds.ProviderId) throw EngineException.Validation("The target must be a database connection, not a linked database.", new { field = "targetConnectionId" });
            var targetProvider = providers.Find(target.ProviderId)
                                 ?? throw EngineException.Validation($"'{target.Name}' is not a relational connection.", new { field = "targetConnectionId" });
            var memberProfile = connections.Get(member.ConnectionId);
            IReadOnlyList<SourceTable>? tables = null;
            try
            {
                var catalog = await runtime.CatalogAsync(cid, false, ct).ConfigureAwait(false);
                tables = catalog.Schemas.FirstOrDefault(s => string.Equals(s.Alias, member.Alias, StringComparison.OrdinalIgnoreCase)) is { Error: null } s ? s.Tables : null;
            }
            catch (EngineException) { /* scripts without column lists */ }
            var source = new NativeLinkSource(member.Alias, memberProfile.ProviderId, memberProfile, member.Database, member.Schema, member.AllTables, member.Tables, tables);
            var result = NativeLinkScripter.Script(targetProvider.Dialect, targetProvider.Id, source, req.Kind, req.Name);
            if (target.ReadOnly)
                result = result with { Notes = [.. result.Notes, $"The connection '{target.Name}' is read-only: run the script from a writable connection to the same server."] };
            return Json(result);
        });

        // ---- source cache
        links.MapPost("/{cid}/refresh-sources", async (string cid, HttpRequest http, ILinkRuntime runtime, CancellationToken ct) =>
        {
            RefreshSourcesRequest? req = null;
            if (http.ContentLength is > 0 || http.Headers.TransferEncoding.Count > 0)
                req = await http.ReadFromJsonAsync<RefreshSourcesRequest>(CoreJson.Options, ct).ConfigureAwait(false);
            req ??= new RefreshSourcesRequest();
            var n = await runtime.RefreshSourcesAsync(cid, req.SessionId, req.Tables, ct).ConfigureAwait(false);
            return Json(new RefreshSourcesResult(n));
        });
    }

    private static IResult Json<T>(T value) => Results.Json(value, CoreJson.Options);
}
