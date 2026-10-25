using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Providers.Sqlite;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import.Tests;

/// <summary>The module's HTTP surface over an in-memory TestServer: request binding, wire shapes, job start and the error report download.</summary>
public sealed class EndpointTests : IAsyncLifetime
{
    private readonly TempDir _d = new();
    private WebApplication _app = null!;
    private HttpClient _http = null!;
    private string _cid = "";
    private readonly CapturingPublisher _events = new();

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var s = builder.Services;
        s.Configure<JsonOptions>(o => CoreJson.Configure(o.SerializerOptions));
        s.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        var providers = new ProviderRegistry([new SqliteProvider()]);
        s.AddSingleton(new AppPaths(_d.Combine("data")));
        s.AddSingleton<ISecretStore, InMemorySecretStore>();
        s.AddSingleton(providers);
        s.AddSingleton<IEventPublisher>(_events);
        s.AddSingleton(sp => new ConnectionStore(sp.GetRequiredService<AppPaths>(), sp.GetRequiredService<ISecretStore>(), providers));
        s.AddSingleton(sp => new JobManager(_events, sp.GetRequiredService<ILogger<JobManager>>()));
        s.AddSingleton(sp => new CatalogService(providers, sp.GetRequiredService<ConnectionStore>(), _events));
        var module = new ImportModule();
        module.ConfigureServices(s);
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
        var db = _d.Combine("t.db");
        await using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={db};Pooling=False")) { await c.OpenAsync(); }
        _cid = _app.Services.GetRequiredService<ConnectionStore>().Create(new ConnectionProfile { Name = "lite", ProviderId = "sqlite", Props = new() { ["path"] = db } }, null).Id;
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        _d.Dispose();
    }

    private async Task<(int Status, JsonElement Body)> PostAsync(string path, object body)
    {
        using var res = await _http.PostAsJsonAsync(path, body, CoreJson.Options);
        var text = await res.Content.ReadAsStringAsync();
        return ((int)res.StatusCode, text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone());
    }

    [Fact]
    public async Task Preview_returns_the_wire_shape_with_effective_options()
    {
        var path = _d.File("a.csv", "id;name;price\n1;علی;1,5\n2;Bob;2,25\n");
        var (status, body) = await PostAsync("import/preview", new { path, options = new { format = "csv" }, maxRows = 10 });
        Assert.Equal(200, status);
        Assert.Equal("a.csv", body.GetProperty("fileName").GetString());
        Assert.Equal(";", body.GetProperty("options").GetProperty("delimiter").GetString());
        Assert.Equal("utf-8", body.GetProperty("options").GetProperty("encoding").GetString());
        Assert.True(body.GetProperty("options").GetProperty("hasHeader").GetBoolean());
        var cols = body.GetProperty("columns");
        Assert.Equal(3, cols.GetArrayLength());
        Assert.Equal("int", cols[0].GetProperty("inferred").GetProperty("kind").GetString());
        Assert.Equal("text", cols[1].GetProperty("inferred").GetProperty("kind").GetString());
        Assert.Equal("علی", body.GetProperty("rows")[0][1].GetString());
        Assert.False(body.GetProperty("moreRows").GetBoolean());

        // The UI re-sends the decimal separator it chose: the price column becomes a decimal.
        (_, body) = await PostAsync("import/preview", new { path, options = new { format = "csv", decimalSeparator = "," } });
        var price = body.GetProperty("columns")[2].GetProperty("inferred");
        Assert.Equal("decimal", price.GetProperty("kind").GetString());
        Assert.Equal(2, price.GetProperty("scale").GetInt32());
    }

    [Fact]
    public async Task Missing_file_is_a_validation_error()
    {
        var (status, body) = await PostAsync("import/preview", new { path = _d.Combine("nope.csv") });
        Assert.Equal(400, status);
        Assert.Equal("VALIDATION", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Capabilities_ddl_table_info_start_and_error_report()
    {
        var caps = await _http.GetFromJsonAsync<JsonElement>($"connections/{_cid}/import/capabilities");
        Assert.True(caps.GetProperty("canImport").GetBoolean());
        Assert.Equal("sqlite", caps.GetProperty("dialect").GetString());
        Assert.Contains("upsert", caps.GetProperty("modes").EnumerateArray().Select(m => m.GetString()));

        var (s1, ddl) = await PostAsync($"connections/{_cid}/import/ddl", new
        {
            table = "people", primaryKey = new[] { "id" },
            columns = new object[]
            {
                new { name = "id", inferred = new { kind = "int", nullable = false } },
                new { name = "name", inferred = new { kind = "text", length = 64, nullable = true } },
            },
        });
        Assert.Equal(200, s1);
        Assert.Contains("CREATE TABLE \"people\"", ddl.GetProperty("ddl").GetString());

        var path = _d.File("p.csv", "id,name\n1,A\n2,B\n2,C\n");
        var (_, preview) = await PostAsync("import/preview", new { path });
        var (s2, started) = await PostAsync($"connections/{_cid}/import/start", new
        {
            path,
            source = preview.GetProperty("options"),
            target = new { schema = (string?)null, table = "people", create = true },
            columns = new object[]
            {
                new { target = "id", from = new { kind = "source", index = 0 }, inferred = new { kind = "int", nullable = false }, nullable = false },
                new { target = "name", from = new { kind = "source", index = 1 }, inferred = new { kind = "text", length = 16, nullable = true } },
                new { target = "const", from = new { kind = "constant", value = "x" }, sqlType = "TEXT" },
            },
            primaryKey = new[] { "id" },
            mode = "append", onError = "skip", transaction = true,
        });
        Assert.Equal(202, s2);
        var jobId = started.GetProperty("jobId").GetString()!;
        await _app.Services.GetRequiredService<JobManager>().WaitAsync(jobId);
        var done = _events.Done(jobId)!;
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        var summary = done.Result!.Value;
        Assert.Equal("completedWithErrors", summary.GetProperty("outcome").GetString());
        Assert.Equal(2, summary.GetProperty("rowsWritten").GetInt64());
        Assert.True(summary.GetProperty("hasErrorReport").GetBoolean());
        Assert.Equal(3, summary.GetProperty("errorsSample")[0].GetProperty("row").GetInt64());

        using var report = await _http.GetAsync($"import/errors/{jobId}");
        Assert.Equal(200, (int)report.StatusCode);
        var bytes = await report.Content.ReadAsByteArrayAsync();
        Assert.Equal(0xEF, bytes[0]);
        Assert.Contains("row,column,error,id,name", Encoding.UTF8.GetString(bytes));
        using var none = await _http.GetAsync("import/errors/j_missing");
        Assert.Equal(404, (int)none.StatusCode);

        var (s3, info) = await PostAsync($"connections/{_cid}/import/table-info", new { table = "people" });
        Assert.Equal(200, s3);
        Assert.True(info.GetProperty("exists").GetBoolean());
        Assert.Equal(3, info.GetProperty("columns").GetArrayLength());
        Assert.Equal("id", info.GetProperty("primaryKey")[0].GetString());
    }

    [Fact]
    public async Task Start_validates_the_request()
    {
        var path = _d.File("p.csv", "id\n1\n");
        var (status, body) = await PostAsync($"connections/{_cid}/import/start", new
        {
            path, source = new { format = "csv" }, target = new { table = "t", create = false }, columns = Array.Empty<object>(), mode = "append", onError = "stop", transaction = true,
        });
        Assert.Equal(400, status);
        Assert.Equal("columns", body.GetProperty("error").GetProperty("detail").GetProperty("field").GetString());
    }
}
