using DbStudio.Federation.Diagnostics;

namespace DbStudio.Federation.Tests.WpZero;

/// <summary>
/// WP0: libduckdb loads from the DuckDB.NET.Data.Full package on this platform, the JSON functions are linked in
/// (json_serialize_sql is what the analyzer and the builder parser use), and the lockdown settings apply.
/// </summary>
public sealed class DuckDbSmokeTests
{
    [Fact]
    public void Opens_in_memory_and_serializes_sql()
    {
        using var c = DuckDbProbe.OpenInMemory();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT json_serialize_sql('select 1')";
        var json = Assert.IsType<string>(cmd.ExecuteScalar());
        Assert.Contains("\"error\":false", json, StringComparison.Ordinal);
        Assert.Contains("SELECT_NODE", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Probe_reports_duckdb()
    {
        var info = DuckDbProbe.Info;
        Assert.Equal("duckdb", info.Engine);
        Assert.Null(info.Error);
        Assert.True(info.SerializeSql);
        Assert.StartsWith("v", info.Version, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_errors_come_back_as_data()
    {
        var ok = DuckDbProbe.SerializeSql("select c.name, sum(o.total) from crm.customers c join shop.orders o on o.customer_id = c.id group by 1");
        Assert.True(ok.Ok);
        var bad = DuckDbProbe.SerializeSql("select from where");
        Assert.True(bad.Supported);
        Assert.False(bad.Ok);
        Assert.False(string.IsNullOrEmpty(bad.Error));
    }

    [Fact]
    public void Lockdown_blocks_file_access_and_extension_autoload()
    {
        using var c = DuckDbProbe.OpenInMemory();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT current_setting('enable_external_access'), current_setting('autoinstall_known_extensions'), current_setting('autoload_known_extensions')";
        using var r = cmd.ExecuteReader();
        Assert.True(r.Read());
        Assert.False(r.GetBoolean(0));
        Assert.False(r.GetBoolean(1));
        Assert.False(r.GetBoolean(2));
        r.Close();
        cmd.CommandText = "SELECT * FROM read_csv_auto('does-not-matter.csv')";
        Assert.ThrowsAny<Exception>(() => cmd.ExecuteScalar());
    }

    [Fact]
    public void Appender_round_trip_in_alias_schema()
    {
        using var c = DuckDbProbe.OpenInMemory();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "CREATE SCHEMA crm; CREATE TABLE crm.customers (id BIGINT, name VARCHAR, total DECIMAL(38,2))";
            cmd.ExecuteNonQuery();
        }
        using (var app = c.CreateAppender("crm", "customers"))
        {
            app.CreateRow().AppendValue(1L).AppendValue("Ada").AppendValue(120.50m).EndRow();
            app.CreateRow().AppendValue(2L).AppendValue((string?)null).AppendValue(7m).EndRow();
        }
        using var q = c.CreateCommand();
        q.CommandText = "SELECT sum(total) FROM crm.customers";
        Assert.Equal(127.50m, Convert.ToDecimal(q.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture));
    }
}
