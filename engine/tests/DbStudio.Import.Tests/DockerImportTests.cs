using System.Net.Sockets;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests;

/// <summary>A reachable sample server of the compose project dbstudio-it (engine/tests/docker/README.md).</summary>
public sealed record Target(string Name, string ProviderId, string Host, int Port, string? Schema, string? Database, Func<ConnectionProfile> Profile, string Password)
{
    public override string ToString() => Name;

    public bool Reachable()
    {
        if (Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0") return false;
        try
        {
            using var c = new TcpClient();
            return c.ConnectAsync(Host, Port).Wait(TimeSpan.FromSeconds(2)) && c.Connected;
        }
        catch (Exception) { return false; }
    }

    private static ConnectionProfile P(string provider, Dictionary<string, JsonNode?> props) => new() { Name = "IT " + provider, ProviderId = provider, Props = props };

    public static IEnumerable<object[]> All()
    {
        yield return [new Target("sqlserver", "sqlserver", "localhost", 14333, "dbo", "shop", () => P("sqlserver", new()
            { ["server"] = "localhost,14333", ["auth"] = "sql", ["user"] = "sa", ["database"] = "shop", ["encrypt"] = "optional", ["trustServerCertificate"] = true }), "DbStudio_Dev_2026!")];
        yield return [new Target("postgresql", "postgresql", "localhost", 15432, "public", "shop", () => P("postgresql", new()
            { ["host"] = "localhost", ["port"] = 15432, ["database"] = "shop", ["user"] = "shop", ["sslMode"] = "disable" }), "shop")];
        yield return [new Target("mysql", "mysql", "localhost", 13306, "shop", null, () => P("mysql", new()
            { ["host"] = "localhost", ["port"] = 13306, ["database"] = "shop", ["user"] = "root", ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true }), "shop")];
        yield return [new Target("mariadb", "mariadb", "localhost", 13307, "shop", null, () => P("mariadb", new()
            { ["host"] = "localhost", ["port"] = 13307, ["database"] = "shop", ["user"] = "root", ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true }), "shop")];
        yield return [new Target("oracle", "oracle", "localhost", 15211, "SHOP", null, () => P("oracle", new()
            { ["connectionType"] = "basic", ["host"] = "localhost", ["port"] = 15211, ["serviceName"] = "FREEPDB1", ["user"] = "shop", ["role"] = "normal" }), "shop")];
        yield return [new Target("clickhouse", "clickhouse", "localhost", 18123, "shop", null, () => P("clickhouse", new()
            { ["host"] = "localhost", ["port"] = 18123, ["protocol"] = "http", ["database"] = "shop", ["user"] = "shop" }), "shop")];
    }
}

/// <summary>
/// Imports a CSV into the Docker sample servers: create table, append, truncate, upsert, update-only, bad rows with and
/// without rollback. Skipped (not failed) when DBSTUDIO_IT=0 or the server is not running.
/// </summary>
public sealed class DockerImportTests : IDisposable
{
    private readonly Harness _h = new();
    private readonly TempDir _d = new();
    public void Dispose() { _h.Dispose(); _d.Dispose(); }

    private static string Csv(int rows, int start = 1) =>
        "id,name,amount,created,active,note\n" + string.Concat(Enumerable.Range(start, rows).Select(i =>
            $"{i},user {i},{i}.25,2024-01-{(i % 28) + 1:00} 10:20:30,{(i % 2 == 0 ? "true" : "false")},\"سلام, \"\"دنیا\"\" {i}\"\n"));

    private static ImportRequest Tune(ImportRequest r) { r.Source.Encoding = "utf-8"; return r; }

    [SkippableTheory]
    [MemberData(nameof(Target.All), MemberType = typeof(Target))]
    public async Task Full_import_scenario(Target t)
    {
        Skip.IfNot(t.Reachable(), $"{t.Name} is not reachable (start engine/tests/docker/compose.yml or set DBSTUDIO_IT=0).");
        var cid = _h.AddConnection(t.Profile(), t.Password);
        var d = DbStudio.Import.Run.ImportDialect.For(_h.Providers.Get(t.ProviderId).Dialect, t.ProviderId);
        var table = "imp_" + Guid.NewGuid().ToString("N")[..8];
        var q = d.Qualify(t.Database, t.Schema, d.Fold(table));
        var caps = _h.Service.Capabilities(cid);
        Assert.True(caps.CanImport);
        try
        {
            // ---- create + load 2500 rows
            var preview = await _h.PreviewAsync(_d.File("people.csv", Csv(2500)));
            var req = Harness.Request(preview, table, t.Schema, t.Database, create: true, primaryKey: ["id"], batch: 1000);
            var s = await _h.RunAsync(cid, req);
            Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error} {string.Join("; ", s.ErrorsSample.Select(e => e.Message))}");
            Assert.Equal(2500, s.RowsWritten);
            Assert.Equal(2500L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));
            Assert.Equal("سلام, \"دنیا\" 7", await _h.ScalarAsync(cid, $"SELECT {d.Quote(d.Fold("note"))} FROM {q} WHERE {d.Quote(d.Fold("id"))} = 7", t.Database));

            var info = await _h.Service.TableInfoAsync(cid, new TableRefDto { Database = t.Database, Schema = t.Schema, Table = d.Fold(table) }, default);
            Assert.True(info.Exists);
            Assert.Equal(6, info.Columns.Count);

            // ---- append into the existing table
            var p2 = await _h.PreviewAsync(_d.File("more.csv", Csv(3, 5000)));
            var existing = Harness.Request(p2, d.Fold(table), t.Schema, t.Database, create: false);
            s = await _h.RunAsync(cid, existing);
            Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error} {string.Join("; ", s.ErrorsSample.Select(e => e.Message))}");
            Assert.Equal(2503L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));

            // ---- truncate + insert
            existing.Mode = "truncateInsert";
            s = await _h.RunAsync(cid, existing);
            Assert.Equal("completed", s.Outcome);
            Assert.Equal(3L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));

            if (caps.Modes.Contains("upsert"))
            {
                var p3 = await _h.PreviewAsync(_d.File("up.csv", "id,name,amount,created,active,note\n5000,Changed,1.5,2024-02-02 00:00:00,true,n1\n7000,Brand new,2.5,2024-02-03 00:00:00,false,n2\n"));
                var up = Harness.Request(p3, d.Fold(table), t.Schema, t.Database, create: false, mode: "upsert", keys: ["id"]);
                s = await _h.RunAsync(cid, up);
                Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error} {string.Join("; ", s.ErrorsSample.Select(e => e.Message))}");
                Assert.Equal(4L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));
                Assert.Equal("Changed", await _h.ScalarAsync(cid, $"SELECT {d.Quote(d.Fold("name"))} FROM {q} WHERE {d.Quote(d.Fold("id"))} = 5000", t.Database));

                var p4 = await _h.PreviewAsync(_d.File("upd.csv", "id,name\n5000,Updated\n424242,Ghost\n"));
                var upd = Harness.Request(p4, d.Fold(table), t.Schema, t.Database, create: false, mode: "updateOnly", keys: ["id"]);
                s = await _h.RunAsync(cid, upd);
                Assert.Equal("completed", s.Outcome);
                Assert.Equal(1, s.RowsWritten);
                Assert.Equal(1, s.RowsSkipped);
                Assert.Equal("Updated", await _h.ScalarAsync(cid, $"SELECT {d.Quote(d.Fold("name"))} FROM {q} WHERE {d.Quote(d.Fold("id"))} = 5000", t.Database));
            }

            if (caps.Transactional)
            {
                // ---- a bad row (primary key clash) with skip: the others land, the bad one is reported
                var p5 = await _h.PreviewAsync(_d.File("dups.csv", "id,name,amount,created,active,note\n8001,ok1,1,2024-01-01 00:00:00,true,a\n8002,ok2,1,2024-01-01 00:00:00,true,a\n8001,dup,1,2024-01-01 00:00:00,true,a\n8003,ok3,1,2024-01-01 00:00:00,true,a\n"));
                var skip = Harness.Request(p5, d.Fold(table), t.Schema, t.Database, create: false, onError: "skip", batch: 100);
                var before = Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database));
                s = await _h.RunAsync(cid, skip);
                Assert.True(s.Outcome == "completedWithErrors", $"{t.Name}: {s.Outcome} {s.Error}");
                Assert.Equal(3, s.RowsWritten);
                Assert.Equal(1, s.ErrorCount);
                Assert.Equal(3, s.ErrorsSample[0].Row);
                Assert.Equal(before + 3, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));

                // ---- stop on error inside a transaction rolls everything back
                var p6 = await _h.PreviewAsync(_d.File("dups2.csv", "id,name,amount,created,active,note\n9001,ok1,1,2024-01-01 00:00:00,true,a\n9001,dup,1,2024-01-01 00:00:00,true,a\n"));
                var stop = Harness.Request(p6, d.Fold(table), t.Schema, t.Database, create: false, onError: "stop", transaction: true);
                var before2 = Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database));
                s = await _h.RunAsync(cid, stop);
                Assert.Equal("failed", s.Outcome);
                Assert.True(s.RolledBack);
                Assert.Equal(before2, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {q}", t.Database)));
            }
        }
        finally
        {
            try { await _h.ExecAsync(cid, d.DropTable(q), t.Database); } catch (Exception) { /* not created */ }
        }
    }
}
