using System.Diagnostics;
using System.Numerics;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Engine;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>The DuckDB engine (lockdown, appender conversions, interrupt) and the SQLite fallback.</summary>
public sealed class EngineTests
{
    private static readonly DuckDbEngineFactory Factory = new();

    private static Task<IFederationEngine> OpenAsync(string engine = "duckdb", string? temp = null, long memory = 0) =>
        Factory.OpenAsync(new FederationEngineOptions(engine, memory, 2, temp), ["crm", "shop"], "crm", default);

    private static async Task<List<object?[]>> RowsAsync(IFederationEngine e, string sql)
    {
        var rows = new List<object?[]>();
        await using var r = await e.ExecuteReaderAsync(sql, null, default);
        while (await r.ReadAsync())
        {
            var row = new object?[r.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = r.IsDBNull(i) ? null : r.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    [Fact]
    public async Task Configuration_is_locked_and_files_are_out_of_reach()
    {
        var temp = Path.Combine(Path.GetTempPath(), "rowlit-eng-" + Guid.NewGuid().ToString("N")[..8]);
        await using (var e = await OpenAsync(temp: temp, memory: 600L * 1024 * 1024))
        {
            Assert.Equal("duckdb", e.Name);
            Assert.True(e.Features.HasFlag(FederationEngineFeatures.Spill));
            var settings = await RowsAsync(e, "SELECT current_setting('memory_limit'), current_setting('TimeZone'), current_setting('enable_external_access')");
            Assert.Contains("MiB", (string)settings[0][0]!);
            Assert.Equal("UTC", settings[0][1]);
            Assert.Equal(false, settings[0][2]);
            await Assert.ThrowsAnyAsync<Exception>(() => e.ExecuteNonQueryAsync("SET memory_limit = '8GB'", default));
            await Assert.ThrowsAnyAsync<Exception>(() => e.ExecuteNonQueryAsync("SET enable_external_access = true", default));
            await Assert.ThrowsAnyAsync<Exception>(() => RowsAsync(e, "SELECT * FROM read_csv('C:/Windows/win.ini')"));
            await Assert.ThrowsAnyAsync<Exception>(() => e.ExecuteNonQueryAsync("INSTALL httpfs", default));
            // unqualified names resolve to the default schema (search_path = first alias)
            await e.CreateTableAsync("crm", "t", [new FederatedColumn("a", "int", "BIGINT")], false, default);
            Assert.Empty(await RowsAsync(e, "SELECT a FROM t"));
            Assert.True(Directory.Exists(temp));
        }
        Assert.False(Directory.Exists(temp));
    }

    [Fact]
    public async Task Appender_converts_driver_and_wire_values()
    {
        await using var e = await OpenAsync();
        FederatedColumn[] cols =
        [
            new("i", "int", "BIGINT"), new("h", "int", "HUGEINT"), new("d", "decimal", "DECIMAL(38,2)"), new("f", "float", "DOUBLE"),
            new("s", "string", "VARCHAR"), new("b", "bool", "BOOLEAN"), new("dt", "date", "DATE"), new("t", "time", "TIME"),
            new("ts", "datetime", "TIMESTAMP"), new("tz", "datetimeoffset", "TIMESTAMPTZ"), new("g", "guid", "UUID"), new("bl", "binary", "BLOB"),
            new("j", "json", "JSON"),
        ];
        await e.CreateTableAsync("shop", "all_types", cols, false, default);
        var g = Guid.Parse("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11");
        using (var a = e.OpenAppender("shop", "all_types", cols))
        {
            a.AppendRow(new object?[] { 5, ulong.MaxValue, 120.5m, 1.25f, "x", true, new DateTime(2024, 1, 2, 3, 4, 5), TimeSpan.FromHours(10),
                new DateTime(2024, 1, 2, 3, 4, 5, 123), new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.FromHours(2)), g, new byte[] { 1, 2 }, "{\"a\":1}" });
            // wire values: decimals and big integers as strings, dates as ISO text, binary as BinaryValue
            a.AppendRow(new object?[] { "7", "170141183460469231731687303715884105727", "99.999", "2.5", 42, 0, "2024-02-03", "10:11:12",
                "2024-02-03T04:05:06.5", "2024-02-03T04:05:06+00:00", g.ToString(), new BinaryValue([9]), "[1]" });
            a.AppendRow(new object?[] { null, DBNull.Value, null, null, null, null, null, null, null, null, null, null, null });
            // not convertible → NULL + counted
            a.AppendRow(new object?[] { "x", "y", "z", "w", "ok", "maybe", "not a date", "nope", "never", "no", "not-a-guid", 5, "{}" });
            Assert.Equal(4, a.Rows);
            Assert.Equal(11, a.ConversionFailures);
        }
        var rows = await RowsAsync(e, "SELECT * FROM shop.all_types");
        Assert.Equal(4, rows.Count);
        Assert.Equal(5L, rows[0][0]);
        Assert.Equal(new BigInteger(ulong.MaxValue), rows[0][1]);
        Assert.Equal(120.50m, rows[0][2]);
        Assert.Equal(1.25d, rows[0][3]);
        Assert.Equal(true, rows[0][5]);
        Assert.Equal(new DateOnly(2024, 1, 2), rows[0][6]);
        Assert.Equal(new TimeOnly(10, 0), rows[0][7]);
        Assert.Equal(new DateTime(2024, 1, 2, 3, 4, 5, 123), rows[0][8]);
        Assert.Equal(new DateTime(2024, 1, 2, 1, 4, 5), rows[0][9]); // TIMESTAMPTZ is stored in UTC
        Assert.Equal(g, rows[0][10]);
        Assert.Equal(7L, rows[1][0]);
        Assert.Equal(BigInteger.Parse("170141183460469231731687303715884105727"), rows[1][1]);
        Assert.Equal(100.00m, rows[1][2]); // rounded to the column scale
        Assert.Equal("42", rows[1][4]);
        Assert.Equal(false, rows[1][5]);
        Assert.Equal(new DateOnly(2024, 2, 3), rows[1][6]);
        Assert.All(rows[2], v => Assert.Null(v));
        Assert.Equal("ok", rows[3][4]);
        Assert.Null(rows[3][0]);
    }

    [Fact]
    public async Task Interrupt_stops_a_running_query_within_a_second()
    {
        await using var e = await OpenAsync();
        var run = Task.Run(() => RowsAsync(e, "SELECT count(*) FROM range(100000000000) a"));
        await Task.Delay(400);
        var sw = Stopwatch.StartNew();
        e.Interrupt();
        await Assert.ThrowsAnyAsync<Exception>(() => run);
        Assert.True(sw.ElapsedMilliseconds < 1000, $"interrupt took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Cancellation_token_cancels_a_query()
    {
        await using var e = await OpenAsync();
        using var cts = new CancellationTokenSource(400);
        var sw = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            await using var r = await e.ExecuteReaderAsync("SELECT count(*) FROM range(100000000000) a", null, cts.Token);
            await r.ReadAsync();
        });
        Assert.True(sw.ElapsedMilliseconds < 1500, $"cancel took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Serialize_sql_parses_on_the_engine()
    {
        await using var e = await OpenAsync();
        var ast = await e.SerializeSqlAsync("select 1", default);
        Assert.True(ast.Ok);
        Assert.Contains("SELECT_NODE", ast.Json);
        var bad = await e.SerializeSqlAsync("selec 1", default);
        Assert.False(bad.Ok);
    }

    [Fact]
    public async Task Parameters_bind_by_name()
    {
        await using var e = await OpenAsync();
        await using var r = await e.ExecuteReaderAsync("SELECT $a + 1, $b", [new("a", "int", 41), new("b", "string", "x")], default);
        Assert.True(await r.ReadAsync());
        Assert.Equal(42L, Convert.ToInt64(r.GetValue(0)));
        Assert.Equal("x", r.GetValue(1));
    }

    [Fact]
    public async Task Sqlite_fallback_runs_the_builder_subset()
    {
        await using var e = await OpenAsync("sqlite");
        Assert.Equal("sqlite", e.Name);
        Assert.False(e.Features.HasFlag(FederationEngineFeatures.FullSql));
        Assert.False((await e.SerializeSqlAsync("select 1", default)).Supported);
        FederatedColumn[] a = [new("id", "int", "BIGINT"), new("name", "string", "VARCHAR")];
        FederatedColumn[] b = [new("customer_id", "int", "BIGINT"), new("total", "decimal", "DECIMAL(38,2)")];
        await e.CreateTableAsync("crm", "customers", a, false, default);
        await e.CreateTableAsync("shop", "orders", b, false, default);
        using (var ap = e.OpenAppender("crm", "customers", a))
        {
            ap.AppendRow(new object?[] { 1, "Alice" });
            ap.AppendRow(new object?[] { 2, "Bob" });
        }
        using (var ap = e.OpenAppender("shop", "orders", b))
        {
            ap.AppendRow(new object?[] { 1, 120.50m });
            ap.AppendRow(new object?[] { 1, "19.50" });
            ap.AppendRow(new object?[] { 2, 199m });
        }
        var rows = await RowsAsync(e, "SELECT c.name, sum(o.total) FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY c.name");
        Assert.Equal(2, rows.Count);
        Assert.Equal("Alice", rows[0][0]);
        Assert.Equal(140.0, Convert.ToDouble(rows[0][1]), 3);
    }
}
