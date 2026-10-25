using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Export;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Services;

namespace DbStudio.Core.Tests;

/// <summary>
/// Export scopes ("current filter &amp; sort", "all records", "re-run the query"): the UI sends the SELECT it generated with
/// the grid's WHERE / ORDER BY and its bind values, and the engine streams it without a row cap.
/// </summary>
public class ExportScopeTests
{
    private static async Task<(EngineEnv Env, SessionHandle Session)> SeedAsync(int rows)
    {
        var env = new EngineEnv();
        var conn = env.AddSqlite();
        var h = await env.Sessions.CreateAsync(conn.Id, null, TransactionMode.Auto, false, CancellationToken.None);
        await env.RunAsync(h.Id, "CREATE TABLE n (i INTEGER PRIMARY KEY, grp INTEGER, name TEXT)",
            $"WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < {rows}) INSERT INTO n SELECT x, x % 3, 'row ' || x FROM c");
        return (env, h);
    }

    private static QueryParam Int(string name, int v) => new(name, "int", JsonValue.Create(v));

    [Fact]
    public async Task FilteredExport_UsesTheWhereOrderByAndBindValues_WithoutARowCap()
    {
        var (env, h) = await SeedAsync(30_000);
        await using var _ = env;
        var path = Path.Combine(env.Dir, "filtered.csv");

        // 10 000 rows match: more than the console's default 10 000 cap would keep with other rows, and descending order.
        var id = env.Exports.StartQueryExport(h.Id, "SELECT *\nFROM n\nWHERE grp = @p1\nORDER BY i DESC", ExportFormats.Csv, path, new ExportOptions(),
            [Int("p1", 1)]);
        var done = await env.Events.WaitAsync<ExportDoneEvent>(e => e.ExportId == id, 30000);

        Assert.Equal(ExecutionStatus.Ok, done.Status);
        Assert.Equal(10_000, done.Rows);
        var lines = await File.ReadAllLinesAsync(path);
        Assert.Equal(10_001, lines.Length);
        Assert.Equal("i,grp,name", lines[0]);
        Assert.Equal("29998,1,row 29998", lines[1]); // 29998 % 3 = 1, largest first
        Assert.Equal("1,1,row 1", lines[^1]);
        Assert.All(lines.Skip(1), l => Assert.Equal("1", l.Split(',')[1]));
    }

    [Fact]
    public async Task AllRecordsExport_IsNotCappedAtTheDefaultMaxRows()
    {
        var (env, h) = await SeedAsync(25_000);
        await using var _ = env;
        var path = Path.Combine(env.Dir, "all.json");

        var id = env.Exports.StartQueryExport(h.Id, "SELECT *\nFROM n", ExportFormats.Json, path, new ExportOptions());
        var done = await env.Events.WaitAsync<ExportDoneEvent>(e => e.ExportId == id, 30000);

        Assert.Equal(ExecutionStatus.Ok, done.Status);
        Assert.Equal(25_000, done.Rows);
        using var doc = JsonDocument.Parse(await File.ReadAllBytesAsync(path));
        Assert.Equal(25_000, doc.RootElement.GetArrayLength());
    }

    [Fact]
    public async Task CancelledExport_ReportsCancelled_AndLeavesNoFile()
    {
        var (env, h) = await SeedAsync(10);
        await using var _ = env;
        var path = Path.Combine(env.Dir, "cancelled.csv");

        var id = env.Exports.StartQueryExport(h.Id,
            "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 5000000000) SELECT x FROM c",
            ExportFormats.Csv, path, new ExportOptions());
        await env.Events.WaitAsync<ExportProgressEvent>(e => e.ExportId == id && e.Rows > 0, 20000);
        Assert.True(env.Executions.Cancel(h.Id));
        var done = await env.Events.WaitAsync<ExportDoneEvent>(e => e.ExportId == id, 20000);

        Assert.Equal(ExecutionStatus.Cancelled, done.Status);
        Assert.False(File.Exists(path));
        Assert.False(File.Exists(path + ".partial"));
        Assert.False(h.IsReserved);
    }

    [Fact]
    public async Task Export_RejectsAStatementThatIsNotASingleQuery()
    {
        var (env, h) = await SeedAsync(3);
        await using var _ = env;
        var ex = Assert.Throws<EngineException>(() =>
            env.Exports.StartQueryExport(h.Id, "SELECT 1; SELECT 2", ExportFormats.Csv, Path.Combine(env.Dir, "x.csv"), new ExportOptions()));
        Assert.Equal(ErrorCodes.Validation, ex.Code);
    }

    [Fact]
    public async Task TsvMarkdownBomAndDateFormat_ThroughTheQueryExport()
    {
        var (env, h) = await SeedAsync(3);
        await using var _ = env;
        var dir = env.Dir;

        async Task<byte[]> ExportAsync(string format, ExportOptions o)
        {
            var p = Path.Combine(dir, "out" + ExportFormats.Extension(format));
            var id = env.Exports.StartQueryExport(h.Id, "SELECT i, name FROM n WHERE i <= 2 ORDER BY i", format, p, o);
            var done = await env.Events.WaitAsync<ExportDoneEvent>(e => e.ExportId == id, 20000);
            Assert.Equal(ExecutionStatus.Ok, done.Status);
            return await File.ReadAllBytesAsync(p);
        }

        var tsv = Encoding.UTF8.GetString(await ExportAsync(ExportFormats.Tsv, new ExportOptions()));
        Assert.Equal("i\tname\r\n1\trow 1\r\n2\trow 2\r\n", tsv);

        var md = Encoding.UTF8.GetString(await ExportAsync(ExportFormats.Markdown, new ExportOptions()));
        Assert.Equal("| i | name |\n| ---: | --- |\n| 1 | row 1 |\n| 2 | row 2 |\n", md);

        var bom = await ExportAsync(ExportFormats.Csv, new ExportOptions(Bom: true));
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bom[..3]);
        Assert.StartsWith("i,name\r\n", Encoding.UTF8.GetString(bom[3..]));

        var jsonBom = await ExportAsync(ExportFormats.Json, new ExportOptions(Bom: true));
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, jsonBom[..3]);
        using (var doc = JsonDocument.Parse(jsonBom[3..])) Assert.Equal(2, doc.RootElement.GetArrayLength());

        Assert.NotEqual(new byte[] { 0xEF, 0xBB, 0xBF }, (await ExportAsync(ExportFormats.Csv, new ExportOptions()))[..3]);
    }
}

public class ExportFormatOptionTests
{
    private static readonly ColumnInfo[] Columns =
    [
        new("id", 0, "int", ColumnKinds.Int, false),
        new("born", 1, "date", ColumnKinds.Date, true),
        new("seen", 2, "datetime2", ColumnKinds.DateTime, true),
        new("note", 3, "nvarchar", ColumnKinds.String, true),
    ];

    private static async Task<string> WriteAsync(string format, ExportOptions options, Dialect dialect, params object?[][] rows)
    {
        using var ms = new MemoryStream();
        await using (var w = ExportFormats.Create(format, ms, options, dialect))
        {
            await w.BeginAsync(Columns, CancellationToken.None);
            foreach (var r in rows) await w.WriteRowAsync(r, CancellationToken.None);
            await w.EndAsync(CancellationToken.None);
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    [Theory]
    [InlineData("2026-03-09", "dd/MM/yyyy", "09/03/2026")]
    [InlineData("2026-03-09T14:05:06", "yyyy-MM-dd HH:mm:ss", "2026-03-09 14:05:06")]
    [InlineData("2026-03-09T14:05:06.1234567", "HH:mm:ss.fff", "14:05:06.123")]
    [InlineData("2026-03-09T14:05:06.5", "ss.ffff", "06.5000")]
    [InlineData("2026-03-09T14:05:06Z", "yyyy-MM-dd HH:mm zzz", "2026-03-09 14:05 +00:00")]
    [InlineData("2026-03-09T14:05:06+03:30", "yy/M/d 'at' HH", "26/M/d at 14")]
    [InlineData("14:05:06", "HH.mm", "14.05")]
    [InlineData("not a date", "dd/MM/yyyy", "not a date")]
    [InlineData("2026-03-09", "", "2026-03-09")]
    public void DateFormat_Patterns(string text, string pattern, string expected) =>
        Assert.Equal(expected, ExportDateFormat.Format(text, pattern));

    [Fact]
    public async Task Csv_AppliesTheDatePatternToDateColumnsOnly_AndKeepsNullText()
    {
        var csv = await WriteAsync(ExportFormats.Csv, new ExportOptions(DateFormat: "dd/MM/yyyy HH:mm", NullAs: "-"), Dialect.TSql,
            [1, "2026-03-09", "2026-03-09T14:05:06", "2026-03-09"],
            [2, null, null, null]);
        Assert.Equal("id,born,seen,note\r\n1,09/03/2026 00:00,09/03/2026 14:05,2026-03-09\r\n2,-,-,-\r\n", csv);
    }

    [Fact]
    public async Task Json_AppliesTheDatePattern()
    {
        var json = await WriteAsync(ExportFormats.Json, new ExportOptions(DateFormat: "yyyy/MM/dd"), Dialect.TSql, [1, "2026-03-09", "2026-03-09T14:05:06", "x"]);
        using var doc = JsonDocument.Parse(json);
        var o = doc.RootElement[0];
        Assert.Equal("2026/03/09", o.GetProperty("born").GetString());
        Assert.Equal("2026/03/09", o.GetProperty("seen").GetString());
        Assert.Equal("x", o.GetProperty("note").GetString());
    }

    [Fact]
    public async Task Tsv_IsTabSeparated_EvenWhenAnotherDelimiterIsGiven()
    {
        var tsv = await WriteAsync(ExportFormats.Tsv, new ExportOptions(Delimiter: ";", Header: false), Dialect.TSql, [1, null, null, "a;b"]);
        Assert.Equal("1\t\t\ta;b\r\n", tsv);
    }

    [Fact]
    public async Task Markdown_EscapesPipesAndLineBreaks_AndRightAlignsNumbers()
    {
        var md = await WriteAsync(ExportFormats.Markdown, new ExportOptions(), Dialect.TSql, [1, null, null, "a|b\r\nc"]);
        Assert.Equal("| id | born | seen | note |\n| ---: | --- | --- | --- |\n| 1 | NULL | NULL | a\\|b<br>c |\n", md);
    }

    [Fact]
    public async Task SqlInsert_TargetDialectOverridesTheSessionDialect()
    {
        var sql = await WriteAsync(ExportFormats.SqlInsert, new ExportOptions(TableName: "people", TargetDialect: Dialect.MySql), Dialect.TSql,
            [1, null, null, "it's"]);
        Assert.Equal("INSERT INTO people (id, born, seen, note) VALUES (1, NULL, NULL, 'it''s');\r\n", sql.Replace("\\'", "''"));
    }

    [Fact]
    public async Task Xlsx_SheetNameOption()
    {
        using var ms = new MemoryStream();
        await using (var w = ExportFormats.Create(ExportFormats.Xlsx, ms, new ExportOptions(SheetName: "Customers 2026"), Dialect.TSql))
        {
            await w.BeginAsync(Columns, CancellationToken.None);
            await w.WriteRowAsync([1, null, null, "a"], CancellationToken.None);
            await w.EndAsync(CancellationToken.None);
        }
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(ms.ToArray()));
        using var wb = new StreamReader(zip.GetEntry("xl/workbook.xml")!.Open());
        Assert.Contains("name=\"Customers 2026\"", await wb.ReadToEndAsync());
    }
}
