using System.Text;
using System.Text.Json;
using DbStudio.Core.Services;
using DbStudio.Import.Parsing;
using Microsoft.Data.Sqlite;

namespace DbStudio.Import.Tests;

/// <summary>End-to-end imports through the real service and job manager over SQLite (always runs).</summary>
public sealed class SqliteImportTests : IDisposable
{
    private readonly Harness _h = new();
    private readonly TempDir _d = new();

    public void Dispose() { _h.Dispose(); _d.Dispose(); }

    private static string Csv(int rows, int start = 1) =>
        "id,name,amount,created,active,note\n" + string.Concat(Enumerable.Range(start, rows).Select(i =>
            $"{i},user {i},{i}.25,2024-01-{(i % 28) + 1:00} 10:20:30,{(i % 2 == 0 ? "true" : "false")},\"سلام, \"\"دنیا\"\" {i}\"\n"));

    [Fact]
    public async Task Creates_a_table_from_csv_with_inferred_types_and_round_trips_persian_text()
    {
        var cid = _h.NewSqlite(out var db);
        var preview = await _h.PreviewAsync(_d.File("people.csv", Csv(2500)));
        Assert.Equal(6, preview.Columns.Count);
        Assert.Equal(Kinds.Int, preview.Columns[0].Inferred.Kind);
        Assert.Equal(Kinds.Decimal, preview.Columns[2].Inferred.Kind);
        Assert.Equal(Kinds.DateTime, preview.Columns[3].Inferred.Kind);
        Assert.Equal(Kinds.Bool, preview.Columns[4].Inferred.Kind);
        Assert.Equal(100, preview.Rows.Count);
        Assert.True(preview.MoreRows);

        var req = Harness.Request(preview, "people", null, null, create: true, primaryKey: ["id"], batch: 700);
        var s = await _h.RunAsync(cid, req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(2500, s.RowsRead);
        Assert.Equal(2500, s.RowsWritten);
        Assert.True(s.Committed);
        Assert.Contains("CREATE TABLE \"people\"", s.Ddl);
        Assert.Equal(2500L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM people"));
        Assert.Equal("سلام, \"دنیا\" 7", await _h.ScalarAsync(cid, "SELECT note FROM people WHERE id = 7"));
        Assert.Equal(1L, await _h.ScalarAsync(cid, "SELECT active FROM people WHERE id = 2"));
        Assert.Equal("2024-01-04 10:20:30", await _h.ScalarAsync(cid, "SELECT created FROM people WHERE id = 3"));
        Assert.True(_h.Events.Progress(_h.LastJobId) > 0);
    }

    [Fact]
    public async Task Modes_append_truncate_upsert_update_only()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount NUMERIC)");
        var p1 = await _h.PreviewAsync(_d.File("a.csv", "id,name,amount\n1,Ann,1.5\n2,Bob,2.5\n3,Cy,3.5\n"));
        var s = await _h.RunAsync(cid, Harness.Request(p1, "t", null, null, false));
        Assert.Equal(3, s.RowsWritten);
        Assert.Equal(3L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));

        var p2 = await _h.PreviewAsync(_d.File("b.csv", "id,name,amount\n10,Dee,9\n11,Eve,8\n"));
        await _h.RunAsync(cid, Harness.Request(p2, "t", null, null, false));
        Assert.Equal(5L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));

        await _h.RunAsync(cid, Harness.Request(p2, "t", null, null, false, mode: "truncateInsert"));
        Assert.Equal(2L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));

        var p3 = await _h.PreviewAsync(_d.File("c.csv", "id,name,amount\n10,Dora,90\n12,Fay,7\n"));
        s = await _h.RunAsync(cid, Harness.Request(p3, "t", null, null, false, mode: "upsert", keys: ["id"]));
        Assert.Equal(2, s.RowsWritten);
        Assert.Equal(3L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));
        Assert.Equal("Dora", await _h.ScalarAsync(cid, "SELECT name FROM t WHERE id = 10"));

        var p4 = await _h.PreviewAsync(_d.File("d.csv", "id,name,amount\n10,Dan,1\n999,Nobody,1\n"));
        s = await _h.RunAsync(cid, Harness.Request(p4, "t", null, null, false, mode: "updateOnly", keys: ["id"]));
        Assert.Equal(1, s.RowsWritten);
        Assert.Equal(1, s.RowsSkipped);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal("Dan", await _h.ScalarAsync(cid, "SELECT name FROM t WHERE id = 10"));
        Assert.Equal(3L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));
    }

    [Fact]
    public async Task Skip_mode_logs_bad_rows_and_writes_the_good_ones()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qty INTEGER)");
        var path = _d.File("bad.csv", "id,name,qty\n1,A,5\n2,B,abc\n3,,7\n4,D,8\n4,Dup,9\n5,E,\n");
        var p = await _h.PreviewAsync(path);
        var req = Harness.Request(p, "t", null, null, false, onError: "skip", batch: 10);
        var s = await _h.RunAsync(cid, req);
        Assert.Equal("completedWithErrors", s.Outcome);
        Assert.Equal(6, s.RowsRead);
        Assert.Equal(3, s.RowsWritten); // rows 1, 4, 5
        Assert.Equal(3, s.ErrorCount);
        Assert.Equal(3, s.ErrorsSample.Count);
        Assert.Contains(s.ErrorsSample, e => e.Row == 2 && e.Column == "qty");
        Assert.Contains(s.ErrorsSample, e => e.Row == 3 && e.Column == "name" && e.Message.Contains("NULL"));
        Assert.Contains(s.ErrorsSample, e => e.Row == 5 && e.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase));
        Assert.True(s.HasErrorReport);
        var report = File.ReadAllText(_h.Service.ErrorReportPath(_h.LastJobId)!);
        Assert.StartsWith("﻿row,column,error,id,name,qty", report);
        Assert.Contains("abc", report);
        Assert.Equal(3L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));
    }

    [Fact]
    public async Task Stop_mode_with_transaction_rolls_everything_back_and_drops_a_created_table()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE t (id INTEGER PRIMARY KEY, qty INTEGER)");
        var p = await _h.PreviewAsync(_d.File("s.csv", "id,qty\n1,1\n2,2\n3,x\n4,4\n"));
        var s = await _h.RunAsync(cid, Harness.Request(p, "t", null, null, false, onError: "stop", transaction: true));
        Assert.Equal("failed", s.Outcome);
        Assert.Contains("Row 3", s.Error);
        Assert.True(s.RolledBack);
        Assert.False(s.Committed);
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));

        // Without the transaction, batches before the failure stay.
        s = await _h.RunAsync(cid, Harness.Request(p, "t", null, null, false, onError: "stop", transaction: false, batch: 1));
        Assert.Equal("failed", s.Outcome);
        Assert.False(s.RolledBack);
        Assert.Equal(2L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t"));

        // A created table disappears again when its import is rolled back.
        var dup = await _h.PreviewAsync(_d.File("dup.csv", "id,qty\n1,1\n2,2\n2,3\n"));
        s = await _h.RunAsync(cid, Harness.Request(dup, "t2", null, null, true, onError: "stop", transaction: true, primaryKey: ["id"]));
        Assert.Equal("failed", s.Outcome);
        Assert.Contains("Row 3", s.Error);
        Assert.Null(s.CreatedTable);
        await Assert.ThrowsAnyAsync<SqliteException>(() => _h.ScalarAsync(cid, "SELECT COUNT(*) FROM t2"));
    }

    [Fact]
    public async Task Constants_expressions_and_column_subsets()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE t (n INTEGER, src TEXT, label TEXT, at TEXT, uid TEXT, f TEXT)");
        var p = await _h.PreviewAsync(_d.File("x.csv", "a,b\n1,x\n2,y\n"));
        var req = Harness.Request(p, "t", null, null, false);
        req.Columns =
        [
            new() { Target = "n", From = new() { Kind = "expression", Name = "rowNumber" } },
            new() { Target = "src", From = new() { Kind = "source", Index = 1 } },
            new() { Target = "label", From = new() { Kind = "constant", Value = "fixed" } },
            new() { Target = "at", From = new() { Kind = "expression", Name = "utcNow" } },
            new() { Target = "uid", From = new() { Kind = "expression", Name = "uuid" } },
            new() { Target = "f", From = new() { Kind = "expression", Name = "fileName" } },
        ];
        var s = await _h.RunAsync(cid, req);
        Assert.Equal(2, s.RowsWritten);
        Assert.Equal("fixed", await _h.ScalarAsync(cid, "SELECT label FROM t WHERE n = 2"));
        Assert.Equal("y", await _h.ScalarAsync(cid, "SELECT src FROM t WHERE n = 2"));
        Assert.Equal("x.csv", await _h.ScalarAsync(cid, "SELECT f FROM t WHERE n = 1"));
        Assert.Equal(36, ((string)(await _h.ScalarAsync(cid, "SELECT uid FROM t WHERE n = 1"))!).Length);
    }

    [Fact]
    public async Task Json_xlsx_and_ndjson_import()
    {
        var cid = _h.NewSqlite(out _);
        var pj = await _h.PreviewAsync(_d.File("a.json", """{"data":[{"id":1,"name":"علی","address":{"city":"تهران"}},{"id":2,"name":"Bob","address":{"city":"Rome"}}]}"""));
        Assert.Contains("data", pj.JsonPaths!);
        var s = await _h.RunAsync(cid, Harness.Request(pj, "j", null, null, true, name: n => n.Replace('.', '_')));
        Assert.Equal(2, s.RowsWritten);
        Assert.Equal("تهران", await _h.ScalarAsync(cid, "SELECT address_city FROM j WHERE id = 1"));

        var pn = await _h.PreviewAsync(_d.File("a.ndjson", "{\"k\":1,\"v\":\"a\"}\n{\"k\":2,\"v\":\"b\"}\n{\"k\":3,\"v\":null}\n"));
        s = await _h.RunAsync(cid, Harness.Request(pn, "nd", null, null, true));
        Assert.Equal(3, s.RowsWritten);
        Assert.Equal(1L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM nd WHERE v IS NULL"));

        var xlsx = _d.Combine("w.xlsx");
        using (var fs = File.Create(xlsx))
        {
            var cols = new[] { new DbStudio.Core.Models.ColumnInfo("id", 0, "int", "int", false), new DbStudio.Core.Models.ColumnInfo("name", 1, "text", "string", true) };
            var w = DbStudio.Core.Export.ExportFormats.Create("xlsx", fs, new DbStudio.Core.Export.ExportOptions(), DbStudio.Core.Models.Dialect.Sqlite);
            await w.BeginAsync(cols, default);
            await w.WriteRowAsync([1, "علی"], default);
            await w.WriteRowAsync([2, "x"], default);
            await w.EndAsync(default);
            await w.DisposeAsync();
        }
        var px = await _h.PreviewAsync(xlsx);
        Assert.Single(px.Sheets!);
        s = await _h.RunAsync(cid, Harness.Request(px, "x", null, null, true));
        Assert.Equal(2, s.RowsWritten);
        Assert.Equal("علی", await _h.ScalarAsync(cid, "SELECT name FROM x WHERE id = 1"));
    }

    [Fact]
    public async Task Read_only_connections_and_unsupported_modes_are_refused()
    {
        var cid = _h.NewSqlite(out var db);
        await _h.ExecAsync(cid, "CREATE TABLE t (id INTEGER)");
        var ro = _h.AddConnection(new DbStudio.Core.Models.ConnectionProfile { Name = "ro", ProviderId = "sqlite", ReadOnly = true, Props = new() { ["path"] = db } }, null);
        var p = await _h.PreviewAsync(_d.File("a.csv", "id\n1\n"));
        var ex = Assert.Throws<EngineException>(() => _h.Service.Start(ro, Harness.Request(p, "t", null, null, false), null));
        Assert.Equal(403, ex.Status);
        Assert.False(_h.Service.Capabilities(ro).CanImport);
        Assert.True(_h.Service.Capabilities(cid).CanImport);
        Assert.Throws<EngineException>(() => _h.Service.Start(cid, Harness.Request(p, "t", null, null, false, mode: "upsert"), null)); // keys missing
        var missing = await Assert.ThrowsAsync<InvalidOperationException>(() => _h.RunAsync(cid, Harness.Request(p, "missing_table", null, null, false)));
        Assert.Contains("not found", missing.Message);
    }

    [Fact]
    public async Task Cancel_stops_a_running_import_and_rolls_back()
    {
        var cid = _h.NewSqlite(out _);
        var path = _d.Combine("big.csv");
        using (var w = new StreamWriter(path, false, new UTF8Encoding(false)))
        {
            w.WriteLine("id,v");
            for (var i = 0; i < 300_000; i++) w.WriteLine($"{i},value {i}");
        }
        var p = await _h.PreviewAsync(path);
        var req = Harness.Request(p, "big", null, null, true, batch: 200);
        var jobId = _h.Service.Start(cid, req, null);
        for (var i = 0; i < 200 && _h.Events.Progress(jobId) < 3 && _h.Events.Done(jobId) is null; i++) await Task.Delay(20);
        Assert.True(_h.Jobs.Cancel(jobId));
        await _h.Jobs.WaitAsync(jobId);
        var done = _h.Events.Done(jobId)!;
        var s = done.Result!.Value.Deserialize<DbStudio.Import.Run.ImportSummary>(CoreJson.Options)!;
        Assert.Equal("cancelled", s.Outcome);
        Assert.True(s.RolledBack);
        Assert.True(s.RowsRead < 300_000);
        // The table created by the cancelled run is dropped again.
        await Assert.ThrowsAnyAsync<SqliteException>(() => _h.ScalarAsync(cid, "SELECT COUNT(*) FROM big"));
    }

    [Fact]
    public async Task Table_info_ddl_preview_and_capabilities()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE t (id INTEGER PRIMARY KEY, name VARCHAR(10) NOT NULL, email TEXT UNIQUE)");
        var info = await _h.Service.TableInfoAsync(cid, new() { Table = "t" }, default);
        Assert.True(info.Exists);
        Assert.Equal(["id"], info.PrimaryKey);
        Assert.Equal(3, info.Columns.Count);
        Assert.Contains(info.UniqueKeys, k => k.SequenceEqual(["email"]));
        Assert.False((await _h.Service.TableInfoAsync(cid, new() { Table = "nope" }, default)).Exists);
        var ddl = _h.Service.Ddl(cid, new()
        {
            Table = "n", PrimaryKey = ["id"],
            Columns = [new() { Name = "id", Inferred = new(Kinds.Int) }, new() { Name = "t", Inferred = new(Kinds.Text, 40), SqlType = "TEXT" }],
        });
        Assert.Contains("\"id\" INTEGER NOT NULL", ddl.Ddl);
        Assert.Contains("PRIMARY KEY (\"id\")", ddl.Ddl);
        Assert.Equal("TEXT", ddl.Columns[1].SqlType);
        var caps = _h.Service.Capabilities(cid);
        Assert.Contains("upsert", caps.Modes);
        Assert.Equal("sqlite", caps.ProviderId);
    }
}
