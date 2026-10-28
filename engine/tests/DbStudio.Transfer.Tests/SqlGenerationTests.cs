using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Transfer.Tests;

/// <summary>Type mapping and SQL text per dialect: pure, no server needed.</summary>
public sealed class SqlGenerationTests
{
    // ------------------------------------------------------------------ type mapper

    [Theory]
    [InlineData(Dialect.PgSql, "integer", Dialect.TSql, "int")]
    [InlineData(Dialect.PgSql, "bigint", Dialect.MySql, "bigint")]
    [InlineData(Dialect.PgSql, "boolean", Dialect.TSql, "bit")]
    [InlineData(Dialect.PgSql, "numeric(12,2)", Dialect.MySql, "decimal(12,2)")]
    [InlineData(Dialect.PgSql, "uuid", Dialect.TSql, "uniqueidentifier")]
    [InlineData(Dialect.PgSql, "bytea", Dialect.TSql, "varbinary(max)")]
    [InlineData(Dialect.TSql, "nvarchar(100)", Dialect.PgSql, "varchar(100)")]
    [InlineData(Dialect.TSql, "bit", Dialect.PgSql, "boolean")]
    [InlineData(Dialect.TSql, "uniqueidentifier", Dialect.PgSql, "uuid")]
    [InlineData(Dialect.TSql, "datetime2(3)", Dialect.PgSql, "timestamp(3)")]
    [InlineData(Dialect.MySql, "longtext", Dialect.PgSql, "text")]
    [InlineData(Dialect.MySql, "tinyint(1)", Dialect.PgSql, "boolean")]
    [InlineData(Dialect.Sqlite, "integer", Dialect.PgSql, "bigint")]
    public void Maps_common_types_across_dialects(Dialect from, string type, Dialect to, string expected) =>
        Assert.Equal(expected, TypeMapper.Map(from, type, to).Text, ignoreCase: true);

    [Fact]
    public void Same_dialect_keeps_a_known_type_as_written()
    {
        var known = new HashSet<string>(["varchar", "int"], StringComparer.Ordinal);
        Assert.Equal("varchar(40)", TypeMapper.Map(Dialect.PgSql, "varchar(40)", Dialect.PgSql, false, known).Text);
    }

    [Fact]
    public void Unbounded_text_key_becomes_bounded_where_the_target_cannot_index_it()
    {
        var mapped = TypeMapper.Map(Dialect.PgSql, "text", Dialect.MySql, isKey: true);
        Assert.StartsWith("varchar(", mapped.Text, StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("nvarchar(", TypeMapper.Map(Dialect.PgSql, "text", Dialect.TSql, isKey: true).Text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("max", TypeMapper.Map(Dialect.PgSql, "text", Dialect.TSql, isKey: true).Text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Lossy_conversions_carry_a_note()
    {
        // MySQL has no arrays: copied as text with a note
        var m = TypeMapper.Map(Dialect.PgSql, "integer[]", Dialect.MySql);
        Assert.NotNull(m.Note);
    }

    [Fact]
    public void Every_target_dialect_gets_a_type_for_every_canonical_kind()
    {
        Dialect[] targets = [Dialect.TSql, Dialect.PgSql, Dialect.MySql, Dialect.Sqlite, Dialect.PlSql, Dialect.ClickHouse];
        foreach (var kind in Enum.GetValues<TypeKind>())
            foreach (var d in targets)
                Assert.False(string.IsNullOrWhiteSpace(TypeMapper.Render(new CanonType(kind), d).Text), $"{kind} -> {d}");
    }

    // ------------------------------------------------------------------ literals

    private static readonly CanonType Text = new(TypeKind.Text);

    [Theory]
    [InlineData(Dialect.TSql, "N'O''Brien'")]
    [InlineData(Dialect.PgSql, "'O''Brien'")]
    [InlineData(Dialect.MySql, "'O''Brien'")]
    [InlineData(Dialect.Sqlite, "'O''Brien'")]
    [InlineData(Dialect.PlSql, "'O''Brien'")]
    public void String_literals_are_escaped_per_dialect(Dialect d, string expected) => Assert.Equal(expected, TransferSql.Literal(d, "O'Brien", Text));

    [Fact]
    public void MySql_escapes_backslashes_and_PostgreSql_drops_nul()
    {
        Assert.Equal(@"'a\\b'", TransferSql.Literal(Dialect.MySql, @"a\b", Text));
        Assert.Equal("'ab'", TransferSql.Literal(Dialect.PgSql, "a\0b", Text));
    }

    [Fact]
    public void Booleans_numbers_and_binary_follow_the_target()
    {
        var b = new CanonType(TypeKind.Boolean);
        Assert.Equal("TRUE", TransferSql.Literal(Dialect.PgSql, true, b));
        Assert.Equal("1", TransferSql.Literal(Dialect.TSql, true, b));
        Assert.Equal("0", TransferSql.Literal(Dialect.MySql, "false", b));
        var i = new CanonType(TypeKind.Int, Bits: 64);
        Assert.Equal("9007199254740993", TransferSql.Literal(Dialect.PgSql, "9007199254740993", i));
        Assert.Equal("NULL", TransferSql.Literal(Dialect.PgSql, null, i));
        var bin = new CanonType(TypeKind.Blob);
        var bytes = new BinaryValue([0, 1, 255]);
        Assert.Equal("0x0001FF", TransferSql.Literal(Dialect.TSql, bytes, bin));
        Assert.Equal("'\\x0001FF'", TransferSql.Literal(Dialect.PgSql, bytes, bin));
        Assert.Equal("X'0001FF'", TransferSql.Literal(Dialect.Sqlite, bytes, bin));
        Assert.Equal("HEXTORAW('0001FF')", TransferSql.Literal(Dialect.PlSql, bytes, bin));
        Assert.Equal("unhex('0001FF')", TransferSql.Literal(Dialect.ClickHouse, bytes, bin));
    }

    [Fact]
    public void Temporal_literals_respect_precision_and_offsets()
    {
        var ts = new CanonType(TypeKind.DateTime, Precision: 3);
        Assert.Equal("'2026-01-05 10:00:00.123'", TransferSql.Literal(Dialect.PgSql, "2026-01-05T10:00:00.1234567", ts));
        Assert.Equal("TIMESTAMP '2026-01-05 10:00:00.123'", TransferSql.Literal(Dialect.PlSql, "2026-01-05T10:00:00.123", ts));
        Assert.Equal("DATE '2026-01-05'", TransferSql.Literal(Dialect.PlSql, "2026-01-05", new CanonType(TypeKind.Date)));
        // an offset on a column without a time zone becomes UTC
        Assert.Equal("'2026-01-05 08:00:00'", TransferSql.Literal(Dialect.MySql, "2026-01-05T10:00:00+02:00", new CanonType(TypeKind.DateTime, Precision: 0)));
        // ... and is kept for timestamptz
        Assert.Equal("'2026-01-05 10:00:00+02:00'", TransferSql.Literal(Dialect.PgSql, "2026-01-05T10:00:00+02:00", new CanonType(TypeKind.DateTimeTz, Precision: 0)));
    }

    // ------------------------------------------------------------------ statements

    private static readonly TargetColumn[] Cols =
    [
        new("id", new CanonType(TypeKind.Int), "int", true, true),
        new("name", new CanonType(TypeKind.VarChar, 50), "varchar(50)", false, false),
    ];

    private static readonly object?[][] Rows = [[1, "a"], [2, "b"]];

    [Fact]
    public void Insert_is_one_multi_row_statement()
    {
        var sql = Assert.Single(TransferSql.BuildInsert(Dialect.PgSql, "\"t\"", Cols, Rows, new InsertMode(false, false)));
        Assert.Equal("INSERT INTO \"t\" (\"id\", \"name\") VALUES\n  (1, 'a'),\n  (2, 'b')", sql);
    }

    [Fact]
    public void Identity_values_are_written_explicitly()
    {
        var ms = Assert.Single(TransferSql.BuildInsert(Dialect.TSql, "[t]", Cols, Rows, new InsertMode(true, false)));
        Assert.StartsWith("SET IDENTITY_INSERT [t] ON;", ms);
        Assert.EndsWith("SET IDENTITY_INSERT [t] OFF;", ms);
        var pg = Assert.Single(TransferSql.BuildInsert(Dialect.PgSql, "\"t\"", Cols, Rows, new InsertMode(true, false)));
        Assert.Contains("OVERRIDING SYSTEM VALUE", pg);
    }

    [Fact]
    public void Upsert_uses_the_dialects_own_syntax()
    {
        var mode = new InsertMode(false, true);
        Assert.Contains("ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\"", TransferSql.BuildInsert(Dialect.PgSql, "\"t\"", Cols, Rows, mode)[0]);
        Assert.Contains("ON CONFLICT (\"id\") DO UPDATE SET \"name\" = excluded.\"name\"", TransferSql.BuildInsert(Dialect.Sqlite, "\"t\"", Cols, Rows, mode)[0]);
        Assert.Contains("ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)", TransferSql.BuildInsert(Dialect.MySql, "`t`", Cols, Rows, mode)[0]);
        var ms = TransferSql.BuildInsert(Dialect.TSql, "[t]", Cols, Rows, mode)[0];
        Assert.StartsWith("MERGE INTO [t] AS tgt USING (VALUES", ms);
        Assert.Contains("WHEN MATCHED THEN UPDATE SET tgt.[name] = src.[name]", ms);
        var ora = TransferSql.BuildInsert(Dialect.PlSql, "\"T\"", Cols, Rows, mode)[0];
        Assert.Contains("FROM DUAL", ora);
        Assert.Contains("WHEN NOT MATCHED THEN INSERT", ora);
    }

    [Fact]
    public void Oracle_inserts_with_insert_all()
    {
        var sql = Assert.Single(TransferSql.BuildInsert(Dialect.PlSql, "\"T\"", Cols, Rows, new InsertMode(false, false)));
        Assert.StartsWith("INSERT ALL", sql);
        Assert.EndsWith("SELECT 1 FROM DUAL", sql);
    }

    [Fact]
    public void Schema_creation_is_idempotent_or_absent()
    {
        Assert.Equal("CREATE SCHEMA IF NOT EXISTS \"x\"", TransferSql.CreateSchema(Dialect.PgSql, "x"));
        Assert.Equal("CREATE DATABASE IF NOT EXISTS `x`", TransferSql.CreateSchema(Dialect.MySql, "x"));
        Assert.StartsWith("IF SCHEMA_ID(N'x') IS NULL", TransferSql.CreateSchema(Dialect.TSql, "x"));
        Assert.Null(TransferSql.CreateSchema(Dialect.Sqlite, "main"));
        Assert.Null(TransferSql.CreateSchema(Dialect.PlSql, "X"));
    }

    [Fact]
    public void Name_case_auto_follows_the_target()
    {
        Assert.Equal("orders", TransferSql.CaseFold("Orders", NameCases.Auto, Dialect.PgSql));
        Assert.Equal("ORDERS", TransferSql.CaseFold("Orders", NameCases.Auto, Dialect.PlSql));
        Assert.Equal("Orders", TransferSql.CaseFold("Orders", NameCases.Auto, Dialect.TSql));
        Assert.Equal("orders", TransferSql.CaseFold("Orders", NameCases.Lower, Dialect.TSql));
    }

    [Fact]
    public void Identity_reset_is_PostgreSql_only()
    {
        Assert.Contains("pg_get_serial_sequence('\"s\".\"t\"', 'id')", TransferSql.ResetIdentity(Dialect.PgSql, "s", "t", "id"));
        Assert.Null(TransferSql.ResetIdentity(Dialect.MySql, "s", "t", "id"));
    }
}
