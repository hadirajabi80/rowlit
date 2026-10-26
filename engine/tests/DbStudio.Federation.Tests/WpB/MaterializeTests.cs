using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Materialize;
using DbStudio.Import.Run;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>Materialize into SQLite (no Docker): modes, progress, preview, refusals. The link query runs on a real DuckDB.</summary>
public sealed class MaterializeTests : IDisposable
{
    private readonly WpBHarness _h = new();
    public void Dispose() => _h.Dispose();

    internal const string Source = """
        CREATE SCHEMA src;
        CREATE TABLE src.big AS SELECT
            range AS id,
            'name ' || range AS name,
            CAST(range * 1.25 AS DECIMAL(18,2)) AS amount,
            range % 2 = 0 AS even,
            DATE '2024-01-01' + CAST(range % 28 AS INTEGER) AS day,
            TIMESTAMP '2024-01-01 10:00:00' + to_seconds(range) AS at,
            TIME '08:30:00' AS t,
            CAST('00000000-0000-0000-0000-' || lpad(CAST(range AS VARCHAR), 12, '0') AS UUID) AS uid,
            CAST(NULL AS VARCHAR) AS empty,
            range / 4 AS ratio
        FROM range(%ROWS%)
        """;

    private string Setup(int rows = 1000)
    {
        _h.Runtime.Exec(Source.Replace("%ROWS%", rows.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        return _h.Link();
    }

    private static MaterializeRequest Req(string target, string table, string mode = MaterializeModes.Create, string sql = "SELECT * FROM src.big", int? batch = 250) =>
        new(sql, null, null, target, null, null, table, mode, batch);

    [Fact]
    public async Task Create_replace_append_into_sqlite()
    {
        var link = Setup();
        var target = _h.NewSqlite(out _);

        var (done, result) = await _h.RunAsync(link, Req(target, "Big Copy"));
        Assert.True(done.Status == ExecutionStatus.Ok, done.Error);
        Assert.Equal((1000L, "Big Copy"), (result!.Rows, result.Table));
        Assert.Equal(1000L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM \"Big Copy\"")));
        Assert.Equal("name 7", await _h.ScalarAsync(target, "SELECT name FROM \"Big Copy\" WHERE id = 7"));
        Assert.Equal(8.75, Convert.ToDouble(await _h.ScalarAsync(target, "SELECT amount FROM \"Big Copy\" WHERE id = 7")));
        Assert.Equal(0L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT even FROM \"Big Copy\" WHERE id = 7")));
        Assert.StartsWith("2024-01-08", (string)(await _h.ScalarAsync(target, "SELECT day FROM \"Big Copy\" WHERE id = 7"))!, StringComparison.Ordinal);
        Assert.StartsWith("2024-01-01 10:00:07", (string)(await _h.ScalarAsync(target, "SELECT at FROM \"Big Copy\" WHERE id = 7"))!, StringComparison.Ordinal);
        Assert.Null(await _h.ScalarAsync(target, "SELECT empty FROM \"Big Copy\" WHERE id = 7"));

        // progress: fetching (from the runtime's fetch progress), writing, done
        var phases = _h.Events.Progress(_h.LastJobId).Select(p => JsonSerializer.Deserialize<MaterializeProgress>(p.Message!, CoreJson.Options)!.Phase).Distinct().ToList();
        Assert.Contains("fetching", phases);
        Assert.Contains("writing", phases);
        Assert.Equal("done", phases[^1]);
        Assert.Equal(1000, _h.Events.Progress(_h.LastJobId)[^1].Done);
        var last = System.Text.Json.Nodes.JsonNode.Parse(_h.Events.Progress(_h.LastJobId)[^1].Message!)!;
        Assert.Equal((1000L, "done"), ((long)last["rows"]!, (string)last["phase"]!)); // the wizard reads {rows,total,phase}
        Assert.Equal("Big Copy", result.Table);

        // create again: refused, the table is kept
        (done, _) = await _h.RunAsync(link, Req(target, "Big Copy"));
        Assert.Equal(ExecutionStatus.Error, done.Status);
        Assert.Contains("already exists", done.Error, StringComparison.Ordinal);

        // replace with a smaller result
        (done, result) = await _h.RunAsync(link, Req(target, "Big Copy", MaterializeModes.Replace, "SELECT id, name FROM src.big WHERE id < 10"));
        Assert.True(done.Status == ExecutionStatus.Ok, done.Error);
        Assert.Equal(10L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM \"Big Copy\"")));
        Assert.Equal(0L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '%rowlit%'")));

        // append (columns matched by name, any case)
        (done, result) = await _h.RunAsync(link, Req(target, "Big Copy", MaterializeModes.Append, "SELECT name AS NAME, id FROM src.big WHERE id BETWEEN 100 AND 104"));
        Assert.True(done.Status == ExecutionStatus.Ok, done.Error);
        Assert.Equal(5L, result!.Rows);
        Assert.Equal(15L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM \"Big Copy\"")));

        // append a column the table does not have
        (done, _) = await _h.RunAsync(link, Req(target, "Big Copy", MaterializeModes.Append, "SELECT id, amount FROM src.big"));
        Assert.Equal(ExecutionStatus.Error, done.Status);
        Assert.Contains("no column amount", done.Error, StringComparison.Ordinal);
        Assert.Equal(15L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM \"Big Copy\"")));
    }

    [Fact]
    public async Task A_failing_query_leaves_no_table()
    {
        var link = Setup(10);
        var target = _h.NewSqlite(out _);
        var (done, _) = await _h.RunAsync(link, Req(target, "never", sql: "SELECT CAST(name AS INTEGER) AS n FROM src.big"));
        Assert.Equal(ExecutionStatus.Error, done.Status);
        Assert.Equal(0L, Convert.ToInt64(await _h.ScalarAsync(target, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'never'")));
    }

    [Fact]
    public async Task Preview_shows_the_ddl_and_reads_one_row_per_source()
    {
        var link = Setup(10);
        var target = _h.NewSqlite(out _);
        var p = await _h.Materialize.PreviewAsync(link, Req(target, "copy", sql: "SELECT id, name, amount, uid FROM src.big;"), default);
        Assert.Equal("sqlite", p.Dialect);
        Assert.False(p.TableExists);
        Assert.StartsWith("CREATE TABLE \"copy\" (", p.Ddl, StringComparison.Ordinal);
        Assert.Equal(["id", "name", "amount", "uid"], p.Columns.Select(c => c.Name));
        Assert.Equal([ColumnKinds.Int, ColumnKinds.String, ColumnKinds.Decimal, ColumnKinds.String], p.Columns.Select(c => c.Kind)); // SQLite keeps uuids as TEXT
        Assert.Contains("SELECT * FROM (\nSELECT id, name, amount, uid FROM src.big\n) AS q LIMIT 0", _h.Runtime.Queries[^1], StringComparison.Ordinal);

        var append = await _h.Materialize.PreviewAsync(link, Req(target, "copy", MaterializeModes.Append), default);
        Assert.Null(append.Ddl);
        Assert.Contains(append.Warnings, w => w.Contains("does not exist", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Materializes_a_linked_view()
    {
        var link = Setup(20);
        var target = _h.NewSqlite(out _);
        var view = _h.Views.Save(link, "new", new LinkedViewInput("evens", null, "SELECT id FROM src.big WHERE even", null));
        var (done, result) = await _h.RunAsync(link, new MaterializeRequest(null, view.Id, null, target, null, null, "evens"));
        Assert.True(done.Status == ExecutionStatus.Ok, done.Error);
        Assert.Equal(10L, result!.Rows);
    }

    [Fact]
    public void Refuses_read_only_and_bad_requests()
    {
        var link = Setup(1);
        var ro = _h.NewSqlite(out _, readOnly: true);
        var e = Assert.Throws<EngineException>(() => _h.Materialize.Start(link, Req(ro, "x"), null));
        Assert.Equal((403, ErrorCodes.ReadOnly), (e.Status, e.Code));
        var target = _h.NewSqlite(out _);
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Materialize.Start(link, Req(target, " "), null)).Status);
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Materialize.Start(link, Req(target, "x", "merge"), null)).Status);
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Materialize.Start(link, Req(target, "x", sql: " "), null)).Status);
        Assert.Equal(404, Assert.Throws<EngineException>(() => _h.Materialize.Start(link, Req("c_missing", "x"), null)).Status);
        Assert.Equal(404, Assert.Throws<EngineException>(() => _h.Materialize.Start("l_unknown", Req(target, "x"), null)).Status);
    }

    [Fact]
    public void Column_names_and_types_map_per_dialect()
    {
        var cols = new List<ColumnInfo>
        {
            new("Total Amount", 0, "DECIMAL(18,2)", ColumnKinds.Decimal, true, Precision: 18, Scale: 2),
            new("total amount", 1, "VARCHAR", ColumnKinds.String, true),
            new("at", 2, "TIMESTAMP WITH TIME ZONE", ColumnKinds.DateTimeOffset, true),
            new("payload", 3, "BLOB", ColumnKinds.Binary, true),
            new("doc", 4, "JSON", ColumnKinds.Json, true),
        };
        var pg = MaterializeService.MapForCreate(ImportDialect.For(Dialect.PgSql, "postgresql"), cols);
        Assert.Equal(["total amount", "total amount_2", "at", "payload", "doc"], pg.Specs.Select(s => s.Name));
        Assert.Equal(["numeric(18,2)", "text", "timestamp", "bytea", "jsonb"], pg.Specs.Select(s => s.SqlType));
        Assert.Contains(pg.Warnings, w => w.Contains("UTC", StringComparison.Ordinal));
        var my = MaterializeService.MapForCreate(ImportDialect.For(Dialect.MySql, "mysql"), cols);
        Assert.Equal(["decimal(18,2)", "longtext", "datetime(6)", "longblob", "json"], my.Specs.Select(s => s.SqlType));
        Assert.Equal("ALTER TABLE \"public\".\"t_tmp\" RENAME TO \"t\"", MaterializeService.RenameSql(ImportDialect.For(Dialect.PgSql), null, "public", "t_tmp", "t"));
        Assert.Equal("RENAME TABLE `shop`.`t_tmp` TO `shop`.`t`", MaterializeService.RenameSql(ImportDialect.For(Dialect.MySql), null, "shop", "t_tmp", "t"));
        Assert.Equal("EXEC sys.sp_rename N'[dbo].[t_tmp]', N't'", MaterializeService.RenameSql(ImportDialect.For(Dialect.TSql), null, null, "t_tmp", "t"));
    }

    [Fact]
    public void Normalizes_duckdb_values()
    {
        Assert.Equal(5L, MaterializeService.Normalize(5));
        Assert.Equal(5L, MaterializeService.Normalize((ulong)5));
        Assert.Equal(new DateTime(2024, 1, 2), MaterializeService.Normalize(new DateOnly(2024, 1, 2)));
        Assert.Equal(new TimeSpan(8, 30, 0), MaterializeService.Normalize(new TimeOnly(8, 30)));
        Assert.Equal(new DateTime(2024, 1, 1, 9, 0, 0), MaterializeService.Normalize(new DateTimeOffset(2024, 1, 1, 10, 0, 0, TimeSpan.FromHours(1))));
        Assert.Equal(12345678901234567890m, MaterializeService.Normalize(System.Numerics.BigInteger.Parse("12345678901234567890")));
    }
}
