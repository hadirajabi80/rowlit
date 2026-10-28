using DbStudio.Core.Models;
using DbStudio.Core.Stats;

namespace DbStudio.Stats.Tests;

public sealed class StatsSqlTests
{
    [Theory]
    [InlineData(Dialect.TSql, "SELECT TOP (101) 1 AS x FROM [dbo].[orders] WHERE amount > @p0")]
    [InlineData(Dialect.PgSql, "SELECT 1 AS x FROM \"public\".\"orders\" WHERE amount > @p0 LIMIT 101")]
    [InlineData(Dialect.MySql, "SELECT 1 AS x FROM `shop`.`orders` WHERE amount > @p0 LIMIT 101")]
    public void Probe_is_bounded_and_keeps_the_filter(Dialect dialect, string inner)
    {
        var table = dialect switch
        {
            Dialect.TSql => "[dbo].[orders]",
            Dialect.PgSql => "\"public\".\"orders\"",
            _ => "`shop`.`orders`",
        };

        var sql = StatsSql.Probe(dialect, table, "amount > @p0", 100);

        Assert.Contains(inner, sql, StringComparison.Ordinal);
        Assert.StartsWith(dialect == Dialect.TSql ? "SELECT COUNT_BIG(*)" : "SELECT COUNT(*)", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Sqlite_histogram_uses_a_bounded_sample_and_integer_bucket()
    {
        var relation = new StatsRelation(Dialect.Sqlite, "\"items\"", "active = 1", 250);

        var sql = StatsSql.Histogram(relation, "price", false, 0, 100, 10);

        Assert.Contains("LIMIT 250", sql, StringComparison.Ordinal);
        Assert.Contains("active = 1", sql, StringComparison.Ordinal);
        Assert.Contains("CAST(", sql, StringComparison.Ordinal);
        Assert.Contains("GROUP BY bkt", sql, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(Dialect.TSql, "DATEDIFF_BIG")]
    [InlineData(Dialect.PgSql, "EXTRACT(EPOCH")]
    [InlineData(Dialect.MySql, "TIMESTAMPDIFF")]
    [InlineData(Dialect.Sqlite, "julianday")]
    [InlineData(Dialect.PlSql, "DATE '1970-01-01'")]
    public void Temporal_histograms_have_dialect_specific_epoch_sql(Dialect dialect, string marker) =>
        Assert.Contains(marker, StatsSql.Epoch(dialect, StatsSql.Q(dialect, "created_at")), StringComparison.OrdinalIgnoreCase);
}

public sealed class ColumnStatsServiceTests
{
    [Fact]
    public async Task Sqlite_profile_returns_nulls_distinct_top_values_and_histogram()
    {
        var env = new TestEnv();
        await using var scratch = await Scratch.CreateAsync(env, Kind.Sqlite);
        await scratch.SeedItemsAsync(rows: 60);
        var service = new ColumnStatsService(env);

        var result = await service.ProfileAsync(new ColumnStatsRequest(
            scratch.ConnectionId, scratch.Database, scratch.Schema, "items", ["price", "note", "active"]), null, CancellationToken.None);

        Assert.Equal(60, result.RowsScanned);
        Assert.False(result.Sampled);
        var price = Assert.Single(result.Columns, c => c.Name == "price");
        Assert.NotNull(price.Distinct);
        Assert.NotNull(price.Min);
        Assert.NotNull(price.Max);
        Assert.NotNull(price.Histogram);
        Assert.NotEmpty(price.Histogram!.Buckets);
        var note = Assert.Single(result.Columns, c => c.Name == "note");
        Assert.True(note.Nulls > 0);
        var active = Assert.Single(result.Columns, c => c.Name == "active");
        Assert.NotEmpty(active.Top);
    }

    [Fact]
    public async Task Read_only_connections_can_profile()
    {
        var env = new TestEnv();
        await using var scratch = await Scratch.CreateAsync(env, Kind.Sqlite, readOnly: true);
        await scratch.SeedItemsAsync(rows: 12);
        var service = new ColumnStatsService(env);

        var result = await service.ProfileAsync(new ColumnStatsRequest(
            scratch.ConnectionId, scratch.Database, scratch.Schema, "items", ["id"]), null, CancellationToken.None);

        Assert.Equal(12, result.RowsScanned);
        Assert.Equal(12, Assert.Single(result.Columns).Distinct);
    }
}
