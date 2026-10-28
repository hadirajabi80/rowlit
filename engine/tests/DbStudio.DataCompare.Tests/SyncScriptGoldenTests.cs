using DbStudio.Core.DataCompare;
using DbStudio.Core.Models;
using DbStudio.Core.Transfer;

namespace DbStudio.DataCompare.Tests;

/// <summary>Golden sync scripts per dialect: deletes, updates of the changed columns only, multi-row inserts, identity handling.</summary>
public sealed class SyncScriptGoldenTests
{
    private static readonly HashSet<string> All = [DiffClasses.Changed, DiffClasses.OnlyInSource, DiffClasses.OnlyInTarget];

    private static List<SyncColumn> Columns(Dialect d, string id, string name, string price, string created, bool identity = false) =>
    [
        new("id", TypeMapper.Parse(d, id), id, true, identity, true),
        new("name", TypeMapper.Parse(d, name), name, false, false, true),
        new("price", TypeMapper.Parse(d, price), price, false, false, true),
        new("created", TypeMapper.Parse(d, created), created, false, false, true),
    ];

    private static readonly List<DataDiffRow> Diffs =
    [
        new(DiffClasses.Changed, [1, "Bob's", "10.50", "2024-01-02T03:04:05.123"], [1, "Bob", "10.50", "2024-01-02T03:04:05.123"], [1]),
        new(DiffClasses.Changed, [2, "Ann", "7", "2024-05-06T00:00:00"], [2, "Ann", "8", "2024-05-06T00:00:00"], [2, 3]),
        new(DiffClasses.OnlyInSource, [3, "New", "1.25", null], null, null),
        new(DiffClasses.OnlyInSource, [4, null, "0", "2024-12-31T23:59:59"], null, null),
        new(DiffClasses.OnlyInTarget, null, [5, "Gone", "2", null], null),
        new(DiffClasses.OnlyInTarget, null, [6, "Gone too", "3", null], null),
        new(DiffClasses.Duplicate, [7, "dup", "1", null], null, null),
    ];

    [Fact]
    public void PostgreSql_script()
    {
        var b = SyncScriptBuilder.Build(Dialect.PgSql, "public", "items", Columns(Dialect.PgSql, "integer", "varchar(100)", "numeric(10,2)", "timestamp(3)"), Diffs, true, All);
        Assert.Equal((2L, 2L, 2L), (b.Inserts, b.Updates, b.Deletes));
        Assert.Equal(
        [
            "DELETE FROM \"public\".\"items\" WHERE \"id\" IN (5, 6)",
            "UPDATE \"public\".\"items\" SET \"name\" = 'Bob''s' WHERE \"id\" = 1",
            "UPDATE \"public\".\"items\" SET \"price\" = 7, \"created\" = '2024-05-06 00:00:00' WHERE \"id\" = 2",
            "INSERT INTO \"public\".\"items\" (\"id\", \"name\", \"price\", \"created\") VALUES\n  (3, 'New', 1.25, NULL),\n  (4, NULL, 0, '2024-12-31 23:59:59')",
        ], b.Statements);
    }

    [Fact]
    public void SqlServer_script_wraps_identity_inserts()
    {
        var b = SyncScriptBuilder.Build(Dialect.TSql, "dbo", "items", Columns(Dialect.TSql, "int", "nvarchar(100)", "decimal(10,2)", "datetime2(3)", identity: true), Diffs, true, All);
        Assert.Equal("DELETE FROM [dbo].[items] WHERE [id] IN (5, 6)", b.Statements[0]);
        Assert.Equal("UPDATE [dbo].[items] SET [name] = N'Bob''s' WHERE [id] = 1", b.Statements[1]);
        Assert.Equal("UPDATE [dbo].[items] SET [price] = 7, [created] = '2024-05-06T00:00:00' WHERE [id] = 2", b.Statements[2]);
        Assert.Equal("SET IDENTITY_INSERT [dbo].[items] ON;\nINSERT INTO [dbo].[items] ([id], [name], [price], [created]) VALUES\n  (3, N'New', 1.25, NULL),\n  (4, NULL, 0, '2024-12-31T23:59:59');\nSET IDENTITY_INSERT [dbo].[items] OFF;",
            b.Statements[3]);
        Assert.Equal(4, b.Statements.Count);
    }

    [Fact]
    public void MySql_script()
    {
        var b = SyncScriptBuilder.Build(Dialect.MySql, "shop", "items", Columns(Dialect.MySql, "int", "varchar(100)", "decimal(10,2)", "datetime(3)"), Diffs, true, All);
        Assert.Equal("DELETE FROM `shop`.`items` WHERE `id` IN (5, 6)", b.Statements[0]);
        Assert.Equal("UPDATE `shop`.`items` SET `name` = 'Bob''s' WHERE `id` = 1", b.Statements[1]);
        Assert.StartsWith("INSERT INTO `shop`.`items` (`id`, `name`, `price`, `created`) VALUES", b.Statements[3]);
    }

    [Fact]
    public void Oracle_script_uses_insert_all_and_typed_literals()
    {
        var b = SyncScriptBuilder.Build(Dialect.PlSql, "SHOP", "ITEMS", Columns(Dialect.PlSql, "NUMBER(10)", "VARCHAR2(100)", "NUMBER(10,2)", "TIMESTAMP(3)"), Diffs, true, All);
        Assert.Equal("UPDATE \"SHOP\".\"ITEMS\" SET \"price\" = 7, \"created\" = TIMESTAMP '2024-05-06 00:00:00' WHERE \"id\" = 2", b.Statements[2]);
        Assert.StartsWith("INSERT ALL\n  INTO \"SHOP\".\"ITEMS\"", b.Statements[3]);
        Assert.EndsWith("SELECT 1 FROM DUAL", b.Statements[3]);
    }

    [Fact]
    public void Sqlite_keys_of_text_match_byte_for_byte()
    {
        var cols = new List<SyncColumn>
        {
            new("day", TypeMapper.Parse(Dialect.Sqlite, "date"), "date", true, false, true),
            new("v", TypeMapper.Parse(Dialect.Sqlite, "text"), "text", false, false, true),
        };
        var diffs = new List<DataDiffRow>
        {
            new(DiffClasses.Changed, ["2024-01-02", "new"], ["2024-01-02T00:00:00", "old"], [1]),
            new(DiffClasses.OnlyInTarget, null, ["2024-01-03T00:00:00", "x"], null),
        };
        var b = SyncScriptBuilder.Build(Dialect.Sqlite, "main", "days", cols, diffs, true, All);
        Assert.Equal("DELETE FROM \"days\" WHERE \"day\" IN ('2024-01-03T00:00:00')", b.Statements[0]);
        Assert.Equal("UPDATE \"days\" SET \"v\" = 'new' WHERE \"day\" = '2024-01-02T00:00:00'", b.Statements[1]);
    }

    [Fact]
    public void Direction_to_source_inverts_the_classes_and_composite_keys_use_or_groups()
    {
        var cols = new List<SyncColumn>
        {
            new("a", TypeMapper.Parse(Dialect.PgSql, "integer"), "integer", true, false, true),
            new("b", TypeMapper.Parse(Dialect.PgSql, "text"), "text", true, false, true),
            new("v", TypeMapper.Parse(Dialect.PgSql, "text"), "text", false, false, true),
            new("calc", TypeMapper.Parse(Dialect.PgSql, "integer"), "integer", false, false, false),
        };
        var diffs = new List<DataDiffRow>
        {
            new(DiffClasses.OnlyInSource, [1, "x", "s", 5], null, null),
            new(DiffClasses.OnlyInSource, [2, null, "s", 5], null, null),
            new(DiffClasses.OnlyInTarget, null, [3, "y", "t", 6], null),
            new(DiffClasses.Changed, [4, "z", "s", 1], [4, "z", "t", 2], [3]),
        };
        var b = SyncScriptBuilder.Build(Dialect.PgSql, "public", "pairs", cols, diffs, false, All);
        Assert.Equal("DELETE FROM \"public\".\"pairs\" WHERE (\"a\" = 1 AND \"b\" = 'x') OR (\"a\" = 2 AND \"b\" IS NULL)", b.Statements[0]);
        Assert.Equal("INSERT INTO \"public\".\"pairs\" (\"a\", \"b\", \"v\") VALUES\n  (3, 'y', 't')", b.Statements[1]);
        Assert.Equal(2, b.Statements.Count);
        // the changed row differs only in a computed column: nothing to update
        Assert.Contains(b.Warnings, w => w.Contains("cannot be written", StringComparison.Ordinal));
    }

    [Fact]
    public void Classes_filter_what_is_scripted_and_the_text_terminates_statements()
    {
        var b = SyncScriptBuilder.Build(Dialect.TSql, "dbo", "items", Columns(Dialect.TSql, "int", "nvarchar(100)", "decimal(10,2)", "datetime2(3)"), Diffs, true,
            new HashSet<string> { DiffClasses.OnlyInTarget });
        Assert.Single(b.Statements);
        Assert.Equal((0L, 0L, 2L), (b.Inserts, b.Updates, b.Deletes));
        var text = SyncScriptBuilder.Text(Dialect.TSql, "Rowlit data synchronization\nTarget: x", b);
        Assert.StartsWith("-- Rowlit data synchronization\n-- Target: x\n\nDELETE FROM [dbo].[items] WHERE [id] IN (5, 6);\nGO", text);
    }

    [Fact]
    public void Read_sql_orders_by_the_key_with_binary_collations()
    {
        var text = TypeMapper.Parse(Dialect.TSql, "nvarchar(20)");
        var num = TypeMapper.Parse(Dialect.TSql, "int");
        var sql = DataCompareSql.Select(Dialect.TSql, "[dbo].[t]", ["[code]", "[id]", "[v]"], "v > 1",
            [("[code]", ValueFamily.Text, text, true), ("[id]", ValueFamily.Numeric, num, false)]);
        Assert.Equal("SELECT [code], [id], [v] FROM [dbo].[t] WHERE v > 1 ORDER BY CASE WHEN [code] IS NULL THEN 0 ELSE 1 END, [code] COLLATE Latin1_General_BIN2, [id]", sql);
        Assert.Equal("CAST(\"c\" AS text) COLLATE \"C\"", DataCompareSql.OrderExpression(Dialect.PgSql, "\"c\"", ValueFamily.Text, text));
        Assert.Equal("CAST(CONVERT(`c` USING utf8mb4) AS BINARY)", DataCompareSql.OrderExpression(Dialect.MySql, "`c`", ValueFamily.Text, text));
        Assert.Equal("NLSSORT(\"C\", 'NLS_SORT=BINARY')", DataCompareSql.OrderExpression(Dialect.PlSql, "\"C\"", ValueFamily.Text, text));
        Assert.Equal("SELECT * FROM (\nselect 1 as x\n) dcq", "SELECT * FROM " + DataCompareSql.QueryFrom("select 1 as x;"));
        Assert.Throws<DbStudio.Core.Services.EngineException>(() => DataCompareSql.CheckWhere("1=1; drop table t", "where"));
        Assert.Throws<DbStudio.Core.Services.EngineException>(() => DataCompareSql.CheckQuery("select 1; select 2", "query"));
        DataCompareSql.CheckWhere("name = 'a;b'", "where");
    }
}
