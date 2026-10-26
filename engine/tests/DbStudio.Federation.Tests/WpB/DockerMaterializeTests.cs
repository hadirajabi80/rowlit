using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Materialize;
using DbStudio.Import.Run;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>
/// Docker IT (compose project dbstudio-it): materialize 100,000 link rows into PostgreSQL and MySQL — acceptance: under
/// 30 s with job progress — then append and replace. Skipped (not failed) when DBSTUDIO_IT=0 or the server is down.
/// </summary>
public sealed class DockerMaterializeTests : IDisposable
{
    private readonly WpBHarness _h = new();
    public void Dispose() => _h.Dispose();

    public sealed record Server(string Name, string ProviderId, int Port, string? Schema, Dictionary<string, JsonNode?> Props, string Password)
    {
        public override string ToString() => Name;
    }

    public static TheoryData<Server> Servers() => new()
    {
        new Server("postgresql", "postgresql", 15432, "public", new() { ["host"] = "localhost", ["port"] = 15432, ["database"] = "shop", ["user"] = "shop", ["sslMode"] = "disable" }, "shop"),
        new Server("mysql", "mysql", 13306, "shop", new() { ["host"] = "localhost", ["port"] = 13306, ["database"] = "shop", ["user"] = "root", ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true }, "shop"),
    };

    [SkippableTheory]
    [MemberData(nameof(Servers))]
    public async Task Materializes_100k_rows_with_progress(Server s)
    {
        Skip.IfNot(Docker.Reachable("localhost", s.Port), $"{s.Name} (dbstudio-it, port {s.Port}) is not running.");
        _h.Runtime.Exec(MaterializeTests.Source.Replace("%ROWS%", "100000"));
        var link = _h.Link();
        var cid = _h.AddConnection(new ConnectionProfile { Name = "IT " + s.Name, ProviderId = s.ProviderId, Props = s.Props }, s.Password);
        var d = ImportDialect.For(_h.Providers.Get(s.ProviderId).Dialect, s.ProviderId);
        var table = "mat_" + Guid.NewGuid().ToString("N")[..8];
        var q = d.Qualify(null, s.Schema, d.Fold(table));
        try
        {
            var sw = Stopwatch.StartNew();
            var (done, result) = await _h.RunAsync(link, new MaterializeRequest("SELECT * FROM src.big", null, null, cid, null, s.Schema, table));
            sw.Stop();
            Assert.True(done.Status == ExecutionStatus.Ok, $"{s.Name}: {done.Error}");
            Assert.Equal(100_000L, result!.Rows);
            Assert.True(sw.Elapsed < TimeSpan.FromSeconds(30), $"{s.Name}: 100k rows took {sw.Elapsed.TotalSeconds:0.0} s");
            Console.WriteLine($"{s.Name}: 100,000 rows materialized in {sw.Elapsed.TotalSeconds:0.00} s");

            var progress = _h.Events.Progress(_h.LastJobId);
            var messages = progress.Select(p => JsonSerializer.Deserialize<MaterializeProgress>(p.Message!, CoreJson.Options)!).ToList();
            Assert.Contains(messages, m => m.Phase == "writing" && m.Written > 0 && m.Written < 100_000);
            Assert.Equal(("done", 100_000L), (messages[^1].Phase, messages[^1].Written));
            Assert.True(progress.Select(p => p.Done).SequenceEqual(progress.Select(p => p.Done).Order()), "progress goes forward");

            Assert.Equal(100_000L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}")));
            Assert.Equal("name 4242", await _h.ScalarAsync(cid, $"SELECT {d.Quote("name")} FROM {q} WHERE {d.Quote("id")} = 4242"));
            Assert.Equal(5302.50m, Convert.ToDecimal(await _h.ScalarAsync(cid, $"SELECT {d.Quote("amount")} FROM {q} WHERE {d.Quote("id")} = 4242")));
            Assert.Equal("00000000-0000-0000-0000-000000004242", (await _h.ScalarAsync(cid, $"SELECT {d.Quote("uid")} FROM {q} WHERE {d.Quote("id")} = 4242"))?.ToString());

            (done, result) = await _h.RunAsync(link, new MaterializeRequest("SELECT id, name FROM src.big WHERE id < 10", null, null, cid, null, s.Schema, d.Fold(table), MaterializeModes.Append));
            Assert.True(done.Status == ExecutionStatus.Ok, $"{s.Name}: {done.Error}");
            Assert.Equal(100_010L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}")));

            (done, result) = await _h.RunAsync(link, new MaterializeRequest("SELECT id, even FROM src.big WHERE id < 5", null, null, cid, null, s.Schema, table, MaterializeModes.Replace));
            Assert.True(done.Status == ExecutionStatus.Ok, $"{s.Name}: {done.Error}");
            Assert.Equal(5L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}")));

            // a read-only connection to the same server is refused up front
            var ro = _h.AddConnection(new ConnectionProfile { Name = "IT ro " + s.Name, ProviderId = s.ProviderId, ReadOnly = true, Props = s.Props }, s.Password);
            Assert.Equal(403, Assert.Throws<EngineException>(() => _h.Materialize.Start(link, new MaterializeRequest("SELECT 1 AS x", null, null, ro, null, s.Schema, table), null)).Status);
        }
        finally
        {
            try { await _h.ExecAsync(cid, d.DropTable(q)); } catch (Exception) { /* not created */ }
        }
    }
}
