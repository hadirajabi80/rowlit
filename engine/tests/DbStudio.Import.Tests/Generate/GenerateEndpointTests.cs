using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Import.Generate;
using DbStudio.Providers.Sqlite;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import.Tests.Generate;

/// <summary>The generator's HTTP surface over an in-memory TestServer: routes, wire shapes (camelCase), job start, the error report download.</summary>
public sealed class GenerateEndpointTests : IAsyncLifetime
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
        var module = new GenerateModule();
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
        await using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={db};Pooling=False"))
        {
            await c.OpenAsync();
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE, age INTEGER CHECK (age BETWEEN 18 AND 30))";
            await cmd.ExecuteNonQueryAsync();
        }
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
    public async Task Generators_lists_the_catalog()
    {
        var list = await _http.GetFromJsonAsync<JsonElement>("generate/generators");
        var ids = list.EnumerateArray().Select(g => g.GetProperty("id").GetString()).ToList();
        Assert.Contains("email", ids);
        Assert.Contains("foreignKey", ids);
        Assert.Contains("skip", ids);
        var seq = list.EnumerateArray().First(g => g.GetProperty("id").GetString() == "sequence");
        Assert.Equal("Numbers", seq.GetProperty("group").GetString());
        Assert.Contains("int", seq.GetProperty("kinds").EnumerateArray().Select(k => k.GetString()));
        Assert.Equal("auto", seq.GetProperty("options").EnumerateArray().First(o => o.GetProperty("key").GetString() == "start").GetProperty("default").GetString());
    }

    [Fact]
    public async Task Plan_preview_run_and_error_report_round_trip()
    {
        var plan = await _http.GetFromJsonAsync<JsonElement>($"generate/plan?connectionId={_cid}&table=people");
        Assert.True(plan.GetProperty("canGenerate").GetBoolean());
        Assert.Equal(1000, plan.GetProperty("defaultRows").GetInt64());
        Assert.Equal("sqlite", plan.GetProperty("dialect").GetString());
        var columns = plan.GetProperty("columns").EnumerateArray().ToList();
        var age = columns.First(c => c.GetProperty("name").GetString() == "age");
        Assert.Equal("int", age.GetProperty("generator").GetString());
        Assert.Equal("18", age.GetProperty("options").GetProperty("min").GetString());
        Assert.Equal("30", age.GetProperty("options").GetProperty("max").GetString());
        var seed = plan.GetProperty("seed").GetInt64();

        // Echo the plan's columns back, as the UI does.
        var request = new
        {
            connectionId = _cid, table = "people", rows = 40, seed, previewRows = 5,
            columns = columns.Select(c => JsonSerializer.Deserialize<object>(c.GetRawText())).ToArray(),
        };
        var (ps, preview) = await PostAsync("generate/preview", request);
        Assert.Equal(200, ps);
        Assert.Equal(5, preview.GetProperty("rows").GetArrayLength());
        Assert.Equal(seed, preview.GetProperty("seed").GetInt64());
        Assert.Equal("email", preview.GetProperty("columns")[0].GetProperty("name").GetString()); // id is the rowid: left to SQLite
        Assert.Contains("@", preview.GetProperty("rows")[0][0].GetString());

        var (rs, started) = await PostAsync("generate/run", request);
        Assert.Equal(202, rs);
        var jobId = started.GetProperty("jobId").GetString()!;
        await _app.Services.GetRequiredService<JobManager>().WaitAsync(jobId);
        var done = _events.Done(jobId)!;
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        var summary = done.Result!.Value;
        Assert.Equal("completed", summary.GetProperty("outcome").GetString());
        Assert.Equal(40, summary.GetProperty("rowsWritten").GetInt64());
        Assert.False(summary.GetProperty("hasErrorReport").GetBoolean());
        Assert.True(summary.GetProperty("rowsPerSecond").GetDouble() > 0);

        using var none = await _http.GetAsync($"generate/errors/{jobId}");
        Assert.Equal(404, (int)none.StatusCode);
    }

    [Fact]
    public async Task Rejected_rows_produce_a_downloadable_csv_report()
    {
        var plan = await _http.GetFromJsonAsync<JsonElement>($"generate/plan?connectionId={_cid}&table=people");
        // email is unique: a second run with the same seed re-generates the same addresses, which the database rejects.
        var columns = plan.GetProperty("columns").EnumerateArray().Select(c => JsonSerializer.Deserialize<object>(c.GetRawText())).ToArray();
        object Req(string onError) => new { connectionId = _cid, table = "people", rows = 30, seed = 5, onError, columns };
        async Task<JsonElement> RunAsync(string onError)
        {
            var (s, started) = await PostAsync("generate/run", Req(onError));
            Assert.Equal(202, s);
            var id = started.GetProperty("jobId").GetString()!;
            await _app.Services.GetRequiredService<JobManager>().WaitAsync(id);
            var r = _events.Done(id)!.Result!.Value.Clone();
            lastJob = id;
            return r;
        }
        Assert.Equal("completed", (await RunAsync("stop")).GetProperty("outcome").GetString());
        var second = await RunAsync("skip");
        // The id column is the rowid (left to SQLite), so only the unique email collides.
        Assert.Equal("completedWithErrors", second.GetProperty("outcome").GetString());
        Assert.Equal(30, second.GetProperty("errorCount").GetInt64());
        Assert.True(second.GetProperty("hasErrorReport").GetBoolean());

        using var report = await _http.GetAsync($"generate/errors/{lastJob}");
        Assert.Equal(200, (int)report.StatusCode);
        var bytes = await report.Content.ReadAsByteArrayAsync();
        Assert.Equal(0xEF, bytes[0]); // UTF-8 BOM
        Assert.Contains("row,column,error,email,age", Encoding.UTF8.GetString(bytes));
    }

    private string lastJob = "";

    [Fact]
    public async Task Bad_requests_are_validation_errors_with_the_field()
    {
        var (s1, b1) = await PostAsync("generate/preview", new { connectionId = _cid, table = "people", rows = 0, columns = Array.Empty<object>() });
        Assert.Equal(400, s1);
        Assert.Equal("rows", b1.GetProperty("error").GetProperty("detail").GetProperty("field").GetString());

        var (s2, b2) = await PostAsync("generate/run", new { connectionId = _cid, table = "people", rows = 10, onError = "maybe", columns = Array.Empty<object>() });
        Assert.Equal(400, s2);
        Assert.Equal("onError", b2.GetProperty("error").GetProperty("detail").GetProperty("field").GetString());

        using var missing = await _http.GetAsync($"generate/plan?connectionId={_cid}&table=nope");
        Assert.Equal(404, (int)missing.StatusCode);
    }
}
