using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Queries;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Providers.MySql;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Sqlite;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>The /links routes over a TestServer: FederationModule's wiring with a fake ILinkRuntime (WP-A's seam).</summary>
public sealed class LinkEndpointTests : IAsyncLifetime
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "rowlit-links-ep-" + Guid.NewGuid().ToString("N"));
    private readonly CapturingPublisher _events = new();
    private readonly FakeLinkRuntime _runtime = new();
    private WebApplication _app = null!;
    private HttpClient _http = null!;
    private string _sqlite = "", _readOnly = "", _pg = "", _mysql = "";

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var s = builder.Services;
        s.Configure<JsonOptions>(o => CoreJson.Configure(o.SerializerOptions));
        s.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        var providers = new ProviderRegistry([new SqliteProvider(), new PostgreSqlProvider(), new MySqlProvider()]);
        var paths = new AppPaths(Path.Combine(_dir, "data"));
        s.AddSingleton(paths);
        s.AddSingleton<ISecretStore, InMemorySecretStore>();
        s.AddSingleton(providers);
        s.AddSingleton<IEventPublisher>(_events);
        s.AddSingleton(sp => new ConnectionStore(paths, sp.GetRequiredService<ISecretStore>(), providers));
        s.AddSingleton(sp => new JobManager(_events, sp.GetRequiredService<ILogger<JobManager>>()));
        s.AddSingleton(sp => new CatalogService(providers, sp.GetRequiredService<ConnectionStore>(), _events));
        s.AddSingleton(new SavedQueryStore(paths));
        var module = new FederationModule();
        module.ConfigureServices(s);
        s.AddSingleton<ILinkRuntime>(_runtime); // after the module: the fake wins over WP0's / WP-A's registration
        _app = builder.Build();
        _app.Use(async (ctx, next) =>
        {
            try { await next(ctx); }
            catch (EngineException ex)
            {
                ctx.Response.StatusCode = ex.Status;
                await ctx.Response.WriteAsJsonAsync(new { error = new { code = ex.Code, message = ex.Message, detail = ex.Detail } }, CoreJson.Options);
            }
        });
        module.MapEndpoints(_app.MapGroup("/api/v1"));
        await _app.StartAsync();
        _http = _app.GetTestClient();
        _http.BaseAddress = new Uri("http://localhost/api/v1/");

        var store = _app.Services.GetRequiredService<ConnectionStore>();
        Directory.CreateDirectory(_dir);
        string Lite(bool ro)
        {
            var db = Path.Combine(_dir, Guid.NewGuid().ToString("N")[..8] + ".db");
            using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={db};Pooling=False")) c.Open();
            return store.Create(new ConnectionProfile { Name = ro ? "lite ro" : "lite", ProviderId = "sqlite", ReadOnly = ro, Props = new() { ["path"] = db } }, null).Id;
        }
        _sqlite = Lite(false);
        _readOnly = Lite(true);
        _pg = store.Create(new ConnectionProfile { Name = "pg", ProviderId = "postgresql", Props = new() { ["host"] = "pg.local", ["port"] = 5432, ["database"] = "dw", ["user"] = "etl" } }, "pw-pg").Id;
        _mysql = store.Create(new ConnectionProfile { Name = "shop mysql", ProviderId = "mysql", Props = new() { ["host"] = "my.local", ["port"] = 3306, ["database"] = "shop", ["user"] = "shop" } }, "pw-secret").Id;

        _runtime.Links["l1"] = new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "crm", ConnectionId = _mysql, Schema = "shop", Tables = [new MountedTable { Name = "customers" }] },
                new LinkMember { Alias = "files", Kind = LinkMemberKinds.Files, Tables = [new MountedTable { Name = "C:/x.csv", As = "x" }] },
            ],
        };
        _runtime.Catalog = new LinkCatalog(
        [
            new LinkCatalogSchema("crm", LinkMemberKinds.Connection, _mysql, "mysql",
            [
                new SourceTable("customers", "customers", null, "shop", "table",
                    [new SourceColumn("id", "int", "int", false, true), new SourceColumn("name", "varchar(100)", "string", true), new SourceColumn("country", "char(2)", "string", true)], ["id"], []),
            ], []),
            new LinkCatalogSchema("shop", LinkMemberKinds.Connection, _pg, "postgresql",
            [
                new SourceTable("orders", "orders", "dw", "public", "table",
                    [new SourceColumn("id", "int4", "int", false, true), new SourceColumn("customer_id", "int4", "int", true), new SourceColumn("status", "text", "string", true),
                     new SourceColumn("total", "numeric(10,2)", "decimal", true)], ["id"], []),
            ], []),
        ], []);
        _runtime.Exec("CREATE SCHEMA src; CREATE TABLE src.big AS SELECT range AS id, 'n' || range AS name FROM range(42)");
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        _runtime.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private static StringContent Body(object o) => new(JsonSerializer.Serialize(o, CoreJson.Options), Encoding.UTF8, "application/json");

    private async Task<(HttpStatusCode Status, JsonNode? Json)> Send(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, path) { Content = body is null ? null : Body(body) };
        using var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        return (res.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text));
    }

    [Fact]
    public async Task Engine_validate_catalog_and_plan()
    {
        var (status, json) = await Send(HttpMethod.Get, "links/engine");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("duckdb", (string?)json!["engine"]);

        (status, json) = await Send(HttpMethod.Post, "links/validate", new LinkValidateRequest(new LinkDefinition(), null, true));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.True((bool)json!["ok"]!);
        (status, json) = await Send(HttpMethod.Post, "links/validate", new { id = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal(ErrorCodes.Validation, (string?)json!["error"]!["code"]);

        (status, json) = await Send(HttpMethod.Get, "links/l1/catalog?refresh=true");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("crm", (string?)json!["schemas"]![0]!["alias"]);
        (status, _) = await Send(HttpMethod.Get, "links/nope/catalog");
        Assert.Equal(HttpStatusCode.NotFound, status);

        (status, json) = await Send(HttpMethod.Post, "links/l1/plan", new PlanRequest("SELECT 1"));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("SELECT 1", (string?)json!["warnings"]![0]!["message"]);
        (status, _) = await Send(HttpMethod.Post, "links/l1/plan", new { sql = "" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    [Fact]
    public async Task Compile_and_parse()
    {
        var seed = BuilderGoldenTests.Load("b-000-seed.json");
        var (status, json) = await Send(HttpMethod.Post, "links/l1/compile", new CompileRequest(seed.Model, Plan: true));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(seed.Sql, (string?)json!["sql"]);
        Assert.Equal("fp1", (string?)json["params"]![0]!["name"]);
        Assert.Equal(seed.Sql, (string?)json["plan"]!["warnings"]![0]!["message"]);

        (status, json) = await Send(HttpMethod.Post, "links/l1/compile", new { plan = false });
        Assert.Equal(HttpStatusCode.BadRequest, status);
        (status, json) = await Send(HttpMethod.Post, "links/l1/compile", new CompileRequest(new BuilderModel()));
        Assert.Equal(HttpStatusCode.BadRequest, status);

        (status, json) = await Send(HttpMethod.Post, "links/l1/parse", new ParseRequest("SELECT c.name, o.total FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id WHERE o.status = 'paid'"));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("customers", (string?)json!["model"]!["tables"]![0]!["table"]);
        Assert.Equal("t2.status", (string?)json["model"]!["filter"]!["items"]![0]!["column"]);

        (status, json) = await Send(HttpMethod.Post, "links/l1/parse", new ParseRequest("SELECT * FROM crm.customers UNION ALL SELECT * FROM crm.customers"));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Null(json!["model"]);
        Assert.Contains("UNION", (string?)json["reason"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Linked_views_crud()
    {
        var model = BuilderGoldenTests.Load("b-000-seed.json").Model;
        var (status, json) = await Send(HttpMethod.Put, "links/l1/views/new", new LinkedViewInput("Paid", "only paid", "SELECT 1", model));
        Assert.Equal(HttpStatusCode.OK, status);
        var id = (string)json!["id"]!;
        Assert.Equal("customers", (string?)json["builder"]!["tables"]![0]!["table"]);

        (status, json) = await Send(HttpMethod.Get, "links/l1/views");
        Assert.Equal("Paid", (string?)json!.AsArray().Single()!["name"]);

        (status, json) = await Send(HttpMethod.Put, $"links/l1/views/{id}", new LinkedViewInput("Paid 2", null, "SELECT 2", null));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(("Paid 2", "SELECT 2"), ((string?)json!["name"], (string?)json["sql"]));

        // The views are saved queries of the link (explorer Queries node, schema "views").
        var saved = _app.Services.GetRequiredService<SavedQueryStore>().List("l1").Single();
        Assert.Equal(LinkIds.ViewsSchema, saved.Schema);

        (status, _) = await Send(HttpMethod.Delete, $"links/l1/views/{id}");
        Assert.Equal(HttpStatusCode.NoContent, status);
        (status, _) = await Send(HttpMethod.Delete, $"links/l1/views/{id}");
        Assert.Equal(HttpStatusCode.NotFound, status);
        (status, _) = await Send(HttpMethod.Get, "links/nope/views");
        Assert.Equal(HttpStatusCode.NotFound, status);
    }

    [Fact]
    public async Task Materialize_preview_start_and_refusals()
    {
        var req = new MaterializeRequest("SELECT * FROM src.big", null, null, _sqlite, null, null, "copy");
        var (status, json) = await Send(HttpMethod.Post, "links/l1/materialize/preview", req);
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.StartsWith("CREATE TABLE", (string?)json!["ddl"], StringComparison.Ordinal);

        (status, json) = await Send(HttpMethod.Post, "links/l1/materialize", req);
        Assert.Equal(HttpStatusCode.Accepted, status);
        var jobId = (string)json!["jobId"]!;
        await _app.Services.GetRequiredService<JobManager>().WaitAsync(jobId);
        var done = _events.Done(jobId)!;
        Assert.True(done.Status == ExecutionStatus.Ok, done.Error);
        Assert.Equal(42, done.Result!.Value.GetProperty("rows").GetInt64());
        Assert.Equal(Materialize.MaterializeService.JobKind, done.Kind);

        (status, json) = await Send(HttpMethod.Post, "links/l1/materialize", req with { TargetConnectionId = _readOnly });
        Assert.Equal(HttpStatusCode.Forbidden, status);
        Assert.Equal(ErrorCodes.ReadOnly, (string?)json!["error"]!["code"]);
        (status, _) = await Send(HttpMethod.Post, "links/l1/materialize", new { sql = "SELECT 1" });
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    [Fact]
    public async Task Native_script_never_contains_the_password()
    {
        var (status, json) = await Send(HttpMethod.Post, "links/l1/native-script", new NativeScriptRequest(_pg, "CRM"));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(("pgsql", NativeLinkKinds.Fdw), ((string?)json!["dialect"], (string?)json["kind"]));
        var script = (string)json["script"]!;
        Assert.Contains("mysql_fdw", script, StringComparison.Ordinal);
        Assert.Contains("IMPORT FOREIGN SCHEMA \"shop\" LIMIT TO (customers)", script, StringComparison.Ordinal);
        Assert.DoesNotContain("pw-secret", script, StringComparison.Ordinal);
        Assert.Contains("<password>", script, StringComparison.Ordinal);

        (status, _) = await Send(HttpMethod.Post, "links/l1/native-script", new NativeScriptRequest(_sqlite, "crm"));
        Assert.Equal(HttpStatusCode.BadRequest, status);
        (status, _) = await Send(HttpMethod.Post, "links/l1/native-script", new NativeScriptRequest(_pg, "files"));
        Assert.Equal(HttpStatusCode.BadRequest, status);
        (status, _) = await Send(HttpMethod.Post, "links/l1/native-script", new NativeScriptRequest(_pg, "nobody"));
        Assert.Equal(HttpStatusCode.NotFound, status);
    }

    [Fact]
    public async Task Refresh_sources_with_and_without_a_body()
    {
        var (status, json) = await Send(HttpMethod.Post, "links/l1/refresh-sources");
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(3, (int)json!["invalidated"]!);
        (status, _) = await Send(HttpMethod.Post, "links/l1/refresh-sources", new RefreshSourcesRequest("s1", [new LinkTableRef("crm", "customers")]));
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal((null, null), (_runtime.Refreshes[0].Session, _runtime.Refreshes[0].Tables));
        Assert.Equal(("s1", "crm.customers"), (_runtime.Refreshes[1].Session, _runtime.Refreshes[1].Tables![0].ToString()));
    }
}
