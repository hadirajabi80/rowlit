using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using DbStudio.Core.DataCompare;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.DataCompare.Tests;

/// <summary><c>/data-compare</c> over an in-memory TestServer with the real <see cref="DataCompareModule"/> and SQLite files.</summary>
public sealed class EndpointTests : IAsyncLifetime
{
    private sealed class Events : IEventPublisher
    {
        public ConcurrentQueue<EngineEvent> All { get; } = new();
        public void Publish(EngineEvent ev) => All.Enqueue(ev);
    }

    private readonly TestEnv _env = new();
    private readonly Events _events = new();
    private Scratch _src = null!;
    private Scratch _dst = null!;
    private WebApplication _app = null!;
    private HttpClient _http = null!;

    public async Task InitializeAsync()
    {
        _src = await Scratch.CreateAsync(_env, Kind.Sqlite);
        _dst = await Scratch.CreateAsync(_env, Kind.Sqlite);
        await _src.SeedItemsAsync();
        await _dst.SeedItemsAsync();
        await _dst.MutateAsync();

        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var s = builder.Services;
        s.Configure<JsonOptions>(o => CoreJson.Configure(o.SerializerOptions));
        s.AddSingleton<ITransferEnvironment>(_env);
        s.AddSingleton<IEventPublisher>(_events);
        s.AddSingleton<JobManager>();
        var module = new DataCompareModule();
        module.ConfigureServices(s);
        _app = builder.Build();
        _app.Use(async (ctx, next) =>
        {
            try { await next(ctx); }
            catch (EngineException ex)
            {
                ctx.Response.StatusCode = ex.Status;
                await ctx.Response.WriteAsJsonAsync(new { error = new { code = ex.Code, message = ex.Message } }, CoreJson.Options);
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
        await _src.DisposeAsync();
        await _dst.DisposeAsync();
    }

    private async Task<(int Status, JsonElement Body)> Send(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: CoreJson.Options);
        using var res = await _http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        return ((int)res.StatusCode, string.IsNullOrEmpty(text) ? default : JsonDocument.Parse(text).RootElement.Clone());
    }

    private async Task<JobDoneEvent> DoneAsync(string jobId)
    {
        await _app.Services.GetRequiredService<JobManager>().WaitAsync(jobId);
        for (var i = 0; i < 100; i++)
        {
            if (_events.All.OfType<JobDoneEvent>().FirstOrDefault(e => e.JobId == jobId) is { } done) return done;
            await Task.Delay(20);
        }
        throw new TimeoutException(jobId);
    }

    [Fact]
    public async Task Columns_compare_job_rows_script_and_apply_job_over_http()
    {
        var request = new DataCompareRequest(_src.Side("items"), _dst.Side("items"));
        var (st, preview) = await Send(HttpMethod.Post, "data-compare/columns", request);
        Assert.Equal(200, st);
        Assert.Equal("id", preview.GetProperty("keyColumns")[0].GetString());
        Assert.True(preview.GetProperty("sync").GetProperty("toTarget").GetBoolean());

        var (st2, started) = await Send(HttpMethod.Post, "data-compare", request);
        Assert.Equal(202, st2);
        var done = await DoneAsync(started.GetProperty("jobId").GetString()!);
        Assert.Equal(ExecutionStatus.Ok, done.Status);
        Assert.Contains(_events.All.OfType<JobProgressEvent>(), e => e.JobId == done.JobId && e.Message!.Contains("\"phase\"", StringComparison.Ordinal));
        var result = done.Result!.Value;
        Assert.Equal(5, result.GetProperty("counts").GetProperty("changed").GetInt64());
        var id = result.GetProperty("compareId").GetString()!;

        var (st3, page) = await Send(HttpMethod.Get, $"data-compare/{id}/rows?class=onlyInTarget&offset=0&limit=2");
        Assert.Equal(200, st3);
        Assert.Equal(4, page.GetProperty("total").GetInt32());
        Assert.Equal(2, page.GetProperty("rows").GetArrayLength());
        Assert.Equal("onlyInTarget", page.GetProperty("rows")[0].GetProperty("class").GetString());
        Assert.Equal(400, (await Send(HttpMethod.Get, $"data-compare/{id}/rows?class=bogus")).Status);

        var (st4, script) = await Send(HttpMethod.Post, $"data-compare/{id}/script", new DataSyncRequest([DiffClasses.Changed]));
        Assert.Equal(200, st4);
        Assert.Equal(5, script.GetProperty("updates").GetInt64());
        Assert.Equal(0, script.GetProperty("inserts").GetInt64());

        var (st5, apply) = await Send(HttpMethod.Post, $"data-compare/{id}/apply", new DataApplyRequest());
        Assert.Equal(202, st5);
        var applied = await DoneAsync(apply.GetProperty("jobId").GetString()!);
        Assert.Equal(ExecutionStatus.Ok, applied.Status);
        Assert.Equal("ok", applied.Result!.Value.GetProperty("status").GetString());

        Assert.Equal(204, (await Send(HttpMethod.Delete, $"data-compare/{id}")).Status);
        Assert.Equal(404, (await Send(HttpMethod.Get, $"data-compare/{id}/rows")).Status);
        Assert.Equal(400, (await Send(HttpMethod.Post, "data-compare", new DataCompareRequest(_src.Side("items"), _src.Side("items")))).Status);
    }
}
