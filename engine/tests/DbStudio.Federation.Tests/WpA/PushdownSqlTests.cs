using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Pushdown;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>Push-down SQL snapshots for the eight source dialects (after each dialect's <see cref="PushdownSql.Accept"/>).</summary>
public sealed class PushdownSqlTests
{
    private const string Guid1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    private static SourceTable Orders(JsonObject? options = null) => new("Orders", "orders", null, "sales", ObjectTypes.Table,
    [
        Cat.Col("Id", ColumnKinds.Int, "int", true), Cat.Col("CustomerId", ColumnKinds.Int), Cat.Col("Total", ColumnKinds.Decimal, "decimal(12,2)"),
        Cat.Col("Status", ColumnKinds.String), Cat.Col("OrderDate", ColumnKinds.DateTime), Cat.Col("Day", ColumnKinds.Date),
        Cat.Col("Active", ColumnKinds.Bool), Cat.Col("Uid", ColumnKinds.Guid), Cat.Col("Note", ColumnKinds.String),
    ], ["Id"], [], Options: options);

    private static PushdownPredicate P(string column, string op, params (string Kind, string Value)[] values) =>
        new(column, op, values.Select(v => new PushdownLiteral(v.Kind, v.Value)).ToList());

    private static FetchRequest Request(SourceTable? table = null, long? limit = null) => new()
    {
        Table = table ?? Orders(),
        Columns = ["Id", "CustomerId", "Total", "Status", "OrderDate", "Day", "Active", "Uid", "Note"],
        Predicates =
        [
            P("Status", PushdownOps.Eq, (ColumnKinds.String, "paid")),
            P("Note", PushdownOps.Eq, (ColumnKinds.String, @"it's \ x")),
            P("Total", PushdownOps.Between, (ColumnKinds.Int, "10"), (ColumnKinds.Decimal, "99.5")),
            P("OrderDate", PushdownOps.Ge, (ColumnKinds.DateTime, "2024-01-01T10:00:00")),
            P("Day", PushdownOps.Eq, (ColumnKinds.Date, "2024-01-02")),
            P("Id", PushdownOps.In, (ColumnKinds.Int, "1"), (ColumnKinds.Int, "2"), (ColumnKinds.Int, "3")),
            P("Status", PushdownOps.Like, (ColumnKinds.String, "p[a]%")),
            P("Active", PushdownOps.Eq, (ColumnKinds.Bool, "true")),
            P("Uid", PushdownOps.Eq, (ColumnKinds.Guid, Guid1)),
            P("CustomerId", PushdownOps.IsNotNull),
        ],
        Limit = limit,
        MaxRows = 1000,
        Timeout = TimeSpan.FromSeconds(30),
    };

    private static string Render(Dialect d, FetchRequest? r = null)
    {
        var accepted = PushdownSql.Accept(d, r ?? Request());
        return PushdownSql.Render(d, new SourceObjectName(null, accepted.Table.Schema, accepted.Table.Name), accepted);
    }

    [Fact]
    public void Tsql() => Assert.Equal(
        "SELECT TOP (1001) [Id], [CustomerId], [Total], [Status], [OrderDate], [Day], [Active], [Uid], [Note] FROM [sales].[Orders] " +
        "WHERE [Status] = N'paid' AND [Note] = N'it''s \\ x' AND [Total] BETWEEN 10 AND 99.5 AND [OrderDate] >= CAST('2024-01-01T10:00:00' AS datetime2) " +
        "AND [Day] = CAST('2024-01-02' AS date) AND [Id] IN (1, 2, 3) AND [Status] LIKE N'p[[]a]%' AND [Active] = 1 AND [Uid] = '" + Guid1 + "' " +
        "AND [CustomerId] IS NOT NULL",
        Render(Dialect.TSql));

    [Fact]
    public void Oracle() => Assert.Equal(
        "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" " +
        "WHERE \"Status\" = 'paid' AND \"Note\" = 'it''s \\ x' AND \"Total\" BETWEEN 10 AND 99.5 AND \"OrderDate\" >= TIMESTAMP '2024-01-01 10:00:00' " +
        "AND \"Day\" = DATE '2024-01-02' AND \"Id\" IN (1, 2, 3) AND \"Status\" LIKE 'p[a]%' AND \"Active\" = 1 AND \"Uid\" = '" + Guid1 + "' " +
        "AND \"CustomerId\" IS NOT NULL FETCH FIRST 1001 ROWS ONLY",
        Render(Dialect.PlSql));

    [Fact]
    public void PostgreSql() => Assert.Equal(
        "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" " +
        "WHERE \"Status\" = 'paid' AND \"Note\" = 'it''s \\ x' AND \"Total\" BETWEEN 10 AND 99.5 AND \"OrderDate\" >= TIMESTAMP '2024-01-01 10:00:00' " +
        "AND \"Day\" = DATE '2024-01-02' AND \"Id\" IN (1, 2, 3) AND \"Status\" LIKE 'p[a]%' AND \"Active\" = TRUE AND \"Uid\" = '" + Guid1 + "'::uuid " +
        "AND \"CustomerId\" IS NOT NULL LIMIT 1001",
        Render(Dialect.PgSql));

    [Fact]
    public void MySql() => Assert.Equal(
        "SELECT `Id`, `CustomerId`, `Total`, `Status`, `OrderDate`, `Day`, `Active`, `Uid`, `Note` FROM `sales`.`Orders` " +
        "WHERE `Status` = 'paid' AND `Note` = 'it''s \\\\ x' AND `Total` BETWEEN 10 AND 99.5 AND `OrderDate` >= '2024-01-01 10:00:00' " +
        "AND `Day` = DATE '2024-01-02' AND `Id` IN (1, 2, 3) AND `Status` LIKE 'p[a]%' AND `Active` = TRUE AND `Uid` = '" + Guid1 + "' " +
        "AND `CustomerId` IS NOT NULL LIMIT 1001",
        Render(Dialect.MySql));

    [Fact]
    public void ClickHouse_drops_datetime_predicates() => Assert.Equal(
        "SELECT `Id`, `CustomerId`, `Total`, `Status`, `OrderDate`, `Day`, `Active`, `Uid`, `Note` FROM `sales`.`Orders` " +
        "WHERE `Status` = 'paid' AND `Note` = 'it''s \\\\ x' AND `Total` BETWEEN 10 AND 99.5 " +
        "AND `Day` = toDate('2024-01-02') AND `Id` IN (1, 2, 3) AND `Status` LIKE 'p[a]%' AND `Active` = TRUE AND `Uid` = toUUID('" + Guid1 + "') " +
        "AND `CustomerId` IS NOT NULL LIMIT 1001",
        Render(Dialect.ClickHouse));

    [Fact]
    public void Sqlite_keeps_only_numbers_and_text() => Assert.Equal(
        "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" " +
        "WHERE \"Status\" = 'paid' AND \"Note\" = 'it''s \\ x' AND \"Total\" BETWEEN 10 AND 99.5 " +
        "AND \"Id\" IN (1, 2, 3) AND \"Status\" LIKE 'p[a]%' AND \"CustomerId\" IS NOT NULL LIMIT 1001",
        Render(Dialect.Sqlite));

    [Fact]
    public void Snowflake() => Assert.Equal(
        "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" " +
        "WHERE \"Status\" = 'paid' AND \"Note\" = 'it''s \\\\ x' AND \"Total\" BETWEEN 10 AND 99.5 AND \"OrderDate\" >= '2024-01-01 10:00:00'::TIMESTAMP_NTZ " +
        "AND \"Day\" = '2024-01-02'::DATE AND \"Id\" IN (1, 2, 3) AND \"Status\" LIKE 'p[a]%' AND \"Active\" = TRUE AND \"Uid\" = '" + Guid1 + "' " +
        "AND \"CustomerId\" IS NOT NULL LIMIT 1001",
        Render(Dialect.Snowflake));

    [Fact]
    public void Cassandra_pushes_nothing_without_the_whole_partition_key() => Assert.Equal(
        "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" LIMIT 1001",
        Render(Dialect.Cql));

    [Fact]
    public void Cassandra_pushes_partition_key_equality_only()
    {
        var table = Orders(new JsonObject { [PushdownSql.PartitionKeyOption] = new JsonArray("Status", "Uid") });
        Assert.Equal(
            "SELECT \"Id\", \"CustomerId\", \"Total\", \"Status\", \"OrderDate\", \"Day\", \"Active\", \"Uid\", \"Note\" FROM \"sales\".\"Orders\" " +
            "WHERE \"Status\" = 'paid' AND \"Uid\" = " + Guid1 + " LIMIT 1001",
            Render(Dialect.Cql, Request(table)));
        // a pushed limit is only right when every predicate is applied at the source
        var accepted = PushdownSql.Accept(Dialect.Cql, Request(table, limit: 5));
        Assert.Null(accepted.Limit);
        var onlyKey = Request(table, limit: 5) with
        {
            Predicates = [P("Status", PushdownOps.Eq, (ColumnKinds.String, "x")), P("Uid", PushdownOps.Eq, (ColumnKinds.Guid, Guid1))],
            MaxRows = 5,
        };
        Assert.Equal(5, PushdownSql.Accept(Dialect.Cql, onlyKey).Limit);
    }

    [Fact]
    public void Pushed_limit_uses_each_dialects_syntax_and_is_dropped_with_a_predicate()
    {
        var r = new FetchRequest
        {
            Table = Orders(),
            Columns = ["Id"],
            Predicates = [P("Day", PushdownOps.Eq, (ColumnKinds.Date, "2024-01-02"))],
            Limit = 10,
            MaxRows = 10,
            Timeout = TimeSpan.FromSeconds(1),
        };
        Assert.Equal("SELECT TOP (10) [Id] FROM [sales].[Orders] WHERE [Day] = CAST('2024-01-02' AS date)", Render(Dialect.TSql, r));
        Assert.Equal("SELECT \"Id\" FROM \"sales\".\"Orders\" WHERE \"Day\" = DATE '2024-01-02' FETCH FIRST 10 ROWS ONLY", Render(Dialect.PlSql, r));
        Assert.Equal("SELECT `Id` FROM `sales`.`Orders` WHERE `Day` = DATE '2024-01-02' LIMIT 10", Render(Dialect.MySql, r));
        var sqlite = PushdownSql.Accept(Dialect.Sqlite, r);
        Assert.Empty(sqlite.Predicates);
        Assert.Null(sqlite.Limit);
    }

    [Fact]
    public void Like_with_backslash_never_pushes()
    {
        var r = Request() with { Predicates = [P("Status", PushdownOps.Like, (ColumnKinds.String, @"a\_b%"))] };
        Assert.Empty(PushdownSql.Accept(Dialect.PgSql, r).Predicates);
    }

    [Fact]
    public void Uncapped_fetch_has_no_limit()
    {
        var r = Request() with { Predicates = [], MaxRows = long.MaxValue };
        Assert.Equal("SELECT [Id], [CustomerId], [Total], [Status], [OrderDate], [Day], [Active], [Uid], [Note] FROM [sales].[Orders]", Render(Dialect.TSql, r));
    }
}
