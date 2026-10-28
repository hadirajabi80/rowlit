using System.Net.Http.Json;
using System.Text.Json;
using DbStudio.Core.LocalHistory;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.Tests.LocalHistory;

/// <summary><c>/local-history</c> over an in-memory TestServer with the real <see cref="LocalHistoryModule"/>.</summary>
public sealed class LocalHistoryEndpointTests : IAsyncLifetime
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-localhistory-api", Guid.NewGuid().ToString("N"));
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_dir);
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var s = builder.Services;
        s.Configure<JsonOptions>(o => CoreJson.Configure(o.SerializerOptions));
        s.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        s.AddSingleton(new AppPaths(_dir));
        var module = new LocalHistoryModule();
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
            catch (BadHttpRequestException ex)
            {
                ctx.Response.StatusCode = 400;
                await ctx.Response.WriteAsJsonAsync(new { error = new { code = ErrorCodes.Validation, message = ex.Message, detail = (object?)null } }, CoreJson.Options);
            }
        });
        module.MapEndpoints(_app.MapGroup("/api/v1"));
        await _app.StartAsync();
        _http = _app.GetTestClient();
        _http.BaseAddress = new Uri("http://localhost/api/v1/");
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    private async Task<(int Status, JsonElement Body)> Send(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: CoreJson.Options);
        using var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        return ((int)res.StatusCode, string.IsNullOrEmpty(text) ? default : JsonDocument.Parse(text).RootElement.Clone());
    }

    [Fact]
    public async Task Snapshot_RoundTrip_ListGetLabelDelete()
    {
        var key = "f:C:\\Users\\me\\my queries\\report.sql";
        var (s1, a) = await Send(HttpMethod.Post, "local-history", new { key, text = "select 1", reason = "run", title = "report.sql" });
        Assert.Equal(200, s1);
        Assert.True(a.GetProperty("added").GetBoolean());
        var id = a.GetProperty("id").GetInt64();

        var (_, dup) = await Send(HttpMethod.Post, "local-history", new { key, text = "select 1", reason = "close" });
        Assert.False(dup.GetProperty("added").GetBoolean());
        await Send(HttpMethod.Post, "local-history", new { key = "t:9", text = "select 2", reason = "auto" });

        var (_, list) = await Send(HttpMethod.Get, $"local-history?key={Uri.EscapeDataString(key)}&key=t%3A9&limit=10");
        Assert.Equal(2, list.GetArrayLength());
        Assert.Equal("t:9", list[0].GetProperty("key").GetString());
        Assert.False(list[0].TryGetProperty("text", out _));

        var (_, one) = await Send(HttpMethod.Get, $"local-history/{id}");
        Assert.Equal("select 1", one.GetProperty("text").GetString());

        var (sp, patched) = await Send(HttpMethod.Patch, $"local-history/{id}", new { label = "first cut" });
        Assert.Equal(200, sp);
        Assert.Equal("first cut", patched.GetProperty("label").GetString());

        Assert.Equal(204, (await Send(HttpMethod.Delete, $"local-history/{id}")).Status);
        Assert.Equal(404, (await Send(HttpMethod.Get, $"local-history/{id}")).Status);
        Assert.Equal(404, (await Send(HttpMethod.Delete, $"local-history/{id}")).Status);
        Assert.Equal(404, (await Send(HttpMethod.Patch, $"local-history/{id}", new { label = "x" })).Status);
    }

    [Fact]
    public async Task Validation_NamesTheField()
    {
        var (s, b) = await Send(HttpMethod.Post, "local-history", new { text = "x", reason = "run" });
        Assert.Equal(400, s);
        Assert.Equal("key", b.GetProperty("error").GetProperty("detail").GetProperty("field").GetString());
        Assert.Equal(400, (await Send(HttpMethod.Get, "local-history")).Status); // no key
        Assert.Equal(400, (await Send(HttpMethod.Post, "local-history/prune", new { days = 0 })).Status);
    }

    [Fact]
    public async Task Clear_And_Prune()
    {
        await Send(HttpMethod.Post, "local-history", new { key = "k", text = "a", reason = "run" });
        await Send(HttpMethod.Post, "local-history", new { key = "k", text = "b", reason = "run" });
        var (_, p) = await Send(HttpMethod.Post, "local-history/prune", new { days = 30 });
        Assert.Equal(0, p.GetProperty("removed").GetInt32());
        var (_, c) = await Send(HttpMethod.Delete, "local-history?key=k");
        Assert.Equal(2, c.GetProperty("removed").GetInt32());
        var (_, list) = await Send(HttpMethod.Get, "local-history?key=k");
        Assert.Equal(0, list.GetArrayLength());
    }
}
