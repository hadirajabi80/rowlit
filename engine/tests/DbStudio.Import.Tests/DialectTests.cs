using DbStudio.Core.Models;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests;

public class DialectTests
{
    private static ImportDialect D(Dialect d) => ImportDialect.For(d);
    private static readonly string[] Cols = ["id", "name"];
    private static readonly string[] Key = ["id"];

    [Theory]
    [InlineData(Dialect.TSql, "[dbo].[t]", "[a]]b]")]
    [InlineData(Dialect.PgSql, "\"public\".\"t\"", "\"a\"\"b\"")]
    [InlineData(Dialect.MySql, "`s`.`t`", "`a``b`")]
    [InlineData(Dialect.PlSql, "\"S\".\"t\"", "\"a\"\"b\"")]
    [InlineData(Dialect.Sqlite, "\"t\"", "\"a\"\"b\"")]
    public void Quoting_and_qualification(Dialect dialect, string qualified, string quotedA)
    {
        var d = D(dialect);
        var schema = dialect switch { Dialect.TSql => "dbo", Dialect.PgSql => "public", Dialect.MySql => "s", Dialect.PlSql => "S", _ => null };
        Assert.Equal(qualified, d.Qualify(null, schema, "t"));
        Assert.Equal(quotedA, d.Quote(dialect == Dialect.TSql ? "a]b" : dialect == Dialect.MySql ? "a`b" : "a\"b"));
    }

    [Fact]
    public void Sql_server_and_snowflake_qualify_with_the_database()
    {
        Assert.Equal("[shop].[dbo].[t]", D(Dialect.TSql).Qualify("shop", "dbo", "t"));
        Assert.Equal("[dbo].[t]", D(Dialect.TSql).Qualify(null, "dbo", "t"));
        Assert.Equal("\"DB\".\"PUBLIC\".\"T\"", D(Dialect.Snowflake).Qualify("DB", "PUBLIC", "T"));
        Assert.Equal("`ch`.`t`", D(Dialect.ClickHouse).Qualify(null, "ch", "t"));
    }

    [Theory]
    [InlineData(Dialect.TSql, "INSERT INTO t ([id], [name]) VALUES (@p0, @p1), (@p2, @p3)")]
    [InlineData(Dialect.PgSql, "INSERT INTO t (\"id\", \"name\") VALUES (@p0, @p1), (@p2, @p3)")]
    [InlineData(Dialect.MySql, "INSERT INTO t (`id`, `name`) VALUES (@p0, @p1), (@p2, @p3)")]
    [InlineData(Dialect.Sqlite, "INSERT INTO t (\"id\", \"name\") VALUES (@p0, @p1), (@p2, @p3)")]
    [InlineData(Dialect.Snowflake, "INSERT INTO t (\"id\", \"name\") VALUES (:1, :2), (:3, :4)")]
    [InlineData(Dialect.PlSql, "INSERT INTO t (\"id\", \"name\") VALUES (:p0, :p1)")]
    public void Insert_statements(Dialect dialect, string expected) =>
        Assert.Equal(expected, D(dialect).InsertSql("t", Cols, 2));

    [Fact]
    public void Upsert_statements_per_dialect()
    {
        Assert.Equal("INSERT INTO t (\"id\", \"name\") VALUES (@p0, @p1) ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\"",
            D(Dialect.PgSql).UpsertSql("t", Cols, Key, 1));
        Assert.Equal("INSERT INTO t (\"id\", \"name\") VALUES (@p0, @p1) ON CONFLICT (\"id\") DO UPDATE SET \"name\" = excluded.\"name\"",
            D(Dialect.Sqlite).UpsertSql("t", Cols, Key, 1));
        Assert.Equal("INSERT INTO t (`id`, `name`) VALUES (@p0, @p1) ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)",
            D(Dialect.MySql).UpsertSql("t", Cols, Key, 1));
        Assert.Equal("MERGE INTO t AS tgt USING (VALUES (@p0, @p1)) AS src ([id], [name]) ON tgt.[id] = src.[id] " +
                     "WHEN MATCHED THEN UPDATE SET tgt.[name] = src.[name] WHEN NOT MATCHED THEN INSERT ([id], [name]) VALUES (src.[id], src.[name]);",
            D(Dialect.TSql).UpsertSql("t", Cols, Key, 1));
        Assert.Equal("MERGE INTO t tgt USING (SELECT :p0 AS s0, :p1 AS s1 FROM dual) src ON (tgt.\"id\" = src.s0) " +
                     "WHEN MATCHED THEN UPDATE SET tgt.\"name\" = src.s1 WHEN NOT MATCHED THEN INSERT (\"id\", \"name\") VALUES (src.s0, src.s1)",
            D(Dialect.PlSql).UpsertSql("t", Cols, Key, 1));
        var sf = D(Dialect.Snowflake).UpsertSql("t", Cols, Key, 2);
        Assert.Contains("FROM VALUES (:1, :2), (:3, :4)", sf);
        Assert.Contains("WHEN MATCHED THEN UPDATE SET tgt.\"name\" = src.S1", sf);
    }

    [Fact]
    public void Upsert_with_only_key_columns_does_nothing_on_conflict()
    {
        Assert.EndsWith("DO NOTHING", D(Dialect.PgSql).UpsertSql("t", Key, Key, 1));
        Assert.DoesNotContain("WHEN MATCHED", D(Dialect.TSql).UpsertSql("t", Key, Key, 1));
        Assert.EndsWith("`id` = `id`", D(Dialect.MySql).UpsertSql("t", Key, Key, 1));
    }

    [Fact]
    public void Update_statement_orders_set_then_key_placeholders()
    {
        Assert.Equal("UPDATE t SET [name] = @p0 WHERE [id] = @p1", D(Dialect.TSql).UpdateSql("t", ["name"], Key));
        Assert.Equal("UPDATE t SET \"name\" = :p0 WHERE \"id\" = :p1", D(Dialect.PlSql).UpdateSql("t", ["name"], Key));
    }

    [Fact]
    public void Unsupported_modes_are_rejected_for_clickhouse()
    {
        var ch = D(Dialect.ClickHouse);
        Assert.DoesNotContain("upsert", ch.Modes);
        Assert.Throws<NotSupportedException>(() => ch.UpsertSql("t", Cols, Key, 1));
        Assert.False(ch.Transactional);
    }

    [Fact]
    public void Truncate_and_savepoints()
    {
        Assert.Equal("TRUNCATE TABLE t", D(Dialect.PgSql).TruncateSql("t"));
        Assert.Equal("DELETE FROM t", D(Dialect.Sqlite).TruncateSql("t"));
        Assert.Equal("SAVE TRANSACTION s1", D(Dialect.TSql).Savepoint("s1"));
        Assert.Equal("ROLLBACK TRANSACTION s1", D(Dialect.TSql).RollbackToSavepoint("s1"));
        Assert.Equal("SAVEPOINT s1", D(Dialect.PgSql).Savepoint("s1"));
        Assert.Equal("ROLLBACK TO SAVEPOINT s1", D(Dialect.PgSql).RollbackToSavepoint("s1"));
        Assert.Null(D(Dialect.Snowflake).Savepoint("s1"));
    }

    [Fact]
    public void Row_chunking_respects_parameter_limits()
    {
        Assert.Equal(1000, D(Dialect.TSql).RowsPerStatement(2));
        Assert.Equal(100, D(Dialect.TSql).RowsPerStatement(20));
        Assert.Equal(1, D(Dialect.TSql).RowsPerStatement(5000));
        Assert.Equal(500, D(Dialect.Sqlite).RowsPerStatement(3));
    }

    [Theory]
    [InlineData(Dialect.TSql, Kinds.Int, "int")]
    [InlineData(Dialect.TSql, Kinds.Text, "nvarchar(64)")]
    [InlineData(Dialect.TSql, Kinds.DateTime, "datetime2(3)")]
    [InlineData(Dialect.PgSql, Kinds.Text, "varchar(64)")]
    [InlineData(Dialect.PgSql, Kinds.Float, "double precision")]
    [InlineData(Dialect.MySql, Kinds.Bool, "tinyint(1)")]
    [InlineData(Dialect.MySql, Kinds.Guid, "char(36)")]
    [InlineData(Dialect.PlSql, Kinds.Int, "NUMBER(10)")]
    [InlineData(Dialect.PlSql, Kinds.Text, "NVARCHAR2(64)")]
    [InlineData(Dialect.Sqlite, Kinds.Decimal, "NUMERIC")]
    [InlineData(Dialect.ClickHouse, Kinds.DateTime, "DateTime64(3)")]
    [InlineData(Dialect.Snowflake, Kinds.Bool, "BOOLEAN")]
    public void Default_types_per_dialect(Dialect dialect, string kind, string expected)
    {
        var t = new InferredType(kind, kind == Kinds.Text ? 64 : null, kind == Kinds.Decimal ? 18 : null, kind == Kinds.Decimal ? 2 : null);
        Assert.Equal(expected, D(dialect).SqlType(t));
    }

    [Fact]
    public void Long_text_uses_the_large_type()
    {
        var big = new InferredType(Kinds.Text, 20000);
        Assert.Equal("nvarchar(max)", D(Dialect.TSql).SqlType(big));
        Assert.Equal("text", D(Dialect.PgSql).SqlType(big));
        Assert.Equal("longtext", D(Dialect.MySql).SqlType(big));
        Assert.Equal("NCLOB", D(Dialect.PlSql).SqlType(big));
        Assert.Equal("decimal(18,2)", D(Dialect.TSql).SqlType(new InferredType(Kinds.Decimal, null, 18, 2)));
    }

    [Fact]
    public void Create_table_ddl()
    {
        var specs = new[] { new NewColumnSpec("id", "int", false), new NewColumnSpec("name", "nvarchar(50)", true) };
        Assert.Equal("CREATE TABLE [dbo].[t] (\n    [id] int NOT NULL,\n    [name] nvarchar(50),\n    PRIMARY KEY ([id])\n)",
            D(Dialect.TSql).CreateTable("[dbo].[t]", specs, ["id"]));
        var ch = D(Dialect.ClickHouse).CreateTable("`t`", [new NewColumnSpec("id", "Int32", false), new NewColumnSpec("n", "String", true)], ["id"]);
        Assert.Contains("`n` Nullable(String)", ch);
        Assert.Contains("ENGINE = MergeTree ORDER BY (`id`)", ch);
        Assert.Contains("ORDER BY tuple()", D(Dialect.ClickHouse).CreateTable("`t`", [new NewColumnSpec("n", "String", true)], []));
    }

    [Fact]
    public void Identifier_folding_and_sanitising()
    {
        Assert.Equal("CUSTOMER", D(Dialect.PlSql).Fold("Customer"));
        Assert.Equal("customer", D(Dialect.PgSql).Fold("Customer"));
        Assert.Equal("Customer", D(Dialect.TSql).Fold("Customer"));
        Assert.Equal("a_b_c", ImportDialect.SanitizeName("a\"b`c", 100));
        Assert.Equal("column", ImportDialect.SanitizeName("  ", 100));
        Assert.Equal("نام کاربر", ImportDialect.SanitizeName("نام کاربر", 100));
        Assert.Equal(5, ImportDialect.SanitizeName("abcdefgh", 5).Length);
    }

    [Theory]
    [InlineData(Dialect.TSql, "nvarchar(50)", Kinds.Text, 50)]
    [InlineData(Dialect.TSql, "nvarchar(max)", Kinds.Text, null)]
    [InlineData(Dialect.TSql, "bit", Kinds.Bool, null)]
    [InlineData(Dialect.TSql, "datetime2(7)", Kinds.DateTime, null)]
    [InlineData(Dialect.TSql, "decimal(10,2)", Kinds.Decimal, null)]
    [InlineData(Dialect.TSql, "uniqueidentifier", Kinds.Guid, null)]
    [InlineData(Dialect.TSql, "varbinary(max)", Kinds.Binary, null)]
    [InlineData(Dialect.TSql, "timestamp", Kinds.Other, null)]
    [InlineData(Dialect.PgSql, "character varying(30)", Kinds.Text, 30)]
    [InlineData(Dialect.PgSql, "integer", Kinds.Int, null)]
    [InlineData(Dialect.PgSql, "bigint", Kinds.BigInt, null)]
    [InlineData(Dialect.PgSql, "timestamp without time zone", Kinds.DateTime, null)]
    [InlineData(Dialect.PgSql, "jsonb", Kinds.Json, null)]
    [InlineData(Dialect.PgSql, "bytea", Kinds.Binary, null)]
    [InlineData(Dialect.PgSql, "interval", Kinds.Other, null)]
    [InlineData(Dialect.MySql, "tinyint(1)", Kinds.Bool, null)]
    [InlineData(Dialect.MySql, "int unsigned", Kinds.Int, null)]
    [InlineData(Dialect.MySql, "varchar(255)", Kinds.Text, 255)]
    [InlineData(Dialect.PlSql, "NUMBER(9)", Kinds.Int, null)]
    [InlineData(Dialect.PlSql, "NUMBER(10)", Kinds.BigInt, null)]
    [InlineData(Dialect.PlSql, "NUMBER(1)", Kinds.Bool, null)]
    [InlineData(Dialect.PlSql, "NUMBER(12,2)", Kinds.Decimal, null)]
    [InlineData(Dialect.PlSql, "DATE", Kinds.DateTime, null)]
    [InlineData(Dialect.PlSql, "NVARCHAR2(100)", Kinds.Text, 100)]
    [InlineData(Dialect.Sqlite, "INTEGER", Kinds.Int, null)]
    [InlineData(Dialect.ClickHouse, "Nullable(Int64)", Kinds.BigInt, null)]
    [InlineData(Dialect.ClickHouse, "Int8", Kinds.Int, null)]
    [InlineData(Dialect.ClickHouse, "LowCardinality(String)", Kinds.Text, null)]
    [InlineData(Dialect.ClickHouse, "DateTime64(3)", Kinds.DateTime, null)]
    [InlineData(Dialect.Snowflake, "NUMBER(38,0)", Kinds.Decimal, null)]
    [InlineData(Dialect.Snowflake, "VARCHAR(16777216)", Kinds.Text, 16777216)]
    public void Target_types_are_classified(Dialect dialect, string type, string kind, int? maxLength)
    {
        Assert.Equal(kind, D(dialect).Classify(type, out var max));
        Assert.Equal(maxLength, max);
    }

    [Fact]
    public void Pg_identity_override_and_bulk_text()
    {
        var pg = (PgImportDialect)D(Dialect.PgSql);
        pg.OverrideIdentity = true;
        Assert.Contains("OVERRIDING SYSTEM VALUE", pg.InsertSql("t", Cols, 1));
        var col = new TargetCol("c", Kinds.Text, "text", null, true, false, false);
        Assert.Equal("t", TargetWriter.CopyText(true, col));
        Assert.Equal("\\xDEAD", TargetWriter.CopyText(new byte[] { 0xDE, 0xAD }, col));
        Assert.Equal("2024-01-02 03:04:05", TargetWriter.CopyText(new DateTime(2024, 1, 2, 3, 4, 5), col));
        Assert.Equal("1.5", TargetWriter.CopyText(1.5m, col));
    }
}
