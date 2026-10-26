using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Pushdown;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>Source type → kind → engine type, and DuckDB result types → console kinds.</summary>
public sealed class TypeMapTests
{
    [Theory]
    [InlineData(Dialect.TSql, "int", ColumnKinds.Int)]
    [InlineData(Dialect.TSql, "decimal(12,2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.TSql, "nvarchar(100)", ColumnKinds.String)]
    [InlineData(Dialect.TSql, "datetime2(7)", ColumnKinds.DateTime)]
    [InlineData(Dialect.TSql, "datetimeoffset(7)", ColumnKinds.DateTimeOffset)]
    [InlineData(Dialect.TSql, "uniqueidentifier", ColumnKinds.Guid)]
    [InlineData(Dialect.TSql, "bit", ColumnKinds.Bool)]
    [InlineData(Dialect.TSql, "timestamp", ColumnKinds.Binary)]
    [InlineData(Dialect.TSql, "money", ColumnKinds.Decimal)]
    [InlineData(Dialect.PlSql, "NUMBER(10)", ColumnKinds.Int)]
    [InlineData(Dialect.PlSql, "NUMBER(12,2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.PlSql, "NUMBER", ColumnKinds.Decimal)]
    [InlineData(Dialect.PlSql, "DATE", ColumnKinds.DateTime)]
    [InlineData(Dialect.PlSql, "VARCHAR2(100)", ColumnKinds.String)]
    [InlineData(Dialect.PlSql, "TIMESTAMP(6) WITH TIME ZONE", ColumnKinds.DateTimeOffset)]
    [InlineData(Dialect.PgSql, "integer", ColumnKinds.Int)]
    [InlineData(Dialect.PgSql, "numeric(10,2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.PgSql, "character varying(50)", ColumnKinds.String)]
    [InlineData(Dialect.PgSql, "timestamp without time zone", ColumnKinds.DateTime)]
    [InlineData(Dialect.PgSql, "timestamp with time zone", ColumnKinds.DateTimeOffset)]
    [InlineData(Dialect.PgSql, "time without time zone", ColumnKinds.Time)]
    [InlineData(Dialect.PgSql, "jsonb", ColumnKinds.Json)]
    [InlineData(Dialect.PgSql, "bytea", ColumnKinds.Binary)]
    [InlineData(Dialect.PgSql, "text[]", ColumnKinds.Other)]
    [InlineData(Dialect.MySql, "bigint unsigned", ColumnKinds.Int)]
    [InlineData(Dialect.MySql, "int(11)", ColumnKinds.Int)]
    [InlineData(Dialect.MySql, "decimal(10,2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.MySql, "enum('a','b')", ColumnKinds.String)]
    [InlineData(Dialect.MySql, "timestamp", ColumnKinds.DateTime)]
    [InlineData(Dialect.MySql, "longtext", ColumnKinds.String)]
    [InlineData(Dialect.ClickHouse, "Nullable(Int32)", ColumnKinds.Int)]
    [InlineData(Dialect.ClickHouse, "LowCardinality(Nullable(String))", ColumnKinds.String)]
    [InlineData(Dialect.ClickHouse, "Decimal(18, 2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.ClickHouse, "DateTime64(3, 'UTC')", ColumnKinds.DateTime)]
    [InlineData(Dialect.ClickHouse, "UUID", ColumnKinds.Guid)]
    [InlineData(Dialect.ClickHouse, "Array(String)", ColumnKinds.Other)]
    [InlineData(Dialect.Snowflake, "NUMBER(38,0)", ColumnKinds.Int)]
    [InlineData(Dialect.Snowflake, "TIMESTAMP_TZ(9)", ColumnKinds.DateTimeOffset)]
    [InlineData(Dialect.Snowflake, "VARIANT", ColumnKinds.Json)]
    [InlineData(Dialect.Cql, "timeuuid", ColumnKinds.Guid)]
    [InlineData(Dialect.Cql, "timestamp", ColumnKinds.DateTimeOffset)]
    [InlineData(Dialect.Cql, "map<text, int>", ColumnKinds.Json)]
    [InlineData(Dialect.Sqlite, "INTEGER", ColumnKinds.Int)]
    [InlineData(Dialect.Sqlite, "NUMERIC(12,2)", ColumnKinds.Decimal)]
    [InlineData(Dialect.Sqlite, "TEXT", ColumnKinds.String)]
    public void Source_types_map_to_kinds(Dialect dialect, string type, string kind) => Assert.Equal(kind, TypeMap.KindOf(type, dialect));

    [Theory]
    [InlineData(Dialect.TSql, "int", "BIGINT")]
    [InlineData(Dialect.TSql, "decimal(12,2)", "DECIMAL(38,2)")]
    [InlineData(Dialect.TSql, "money", "DECIMAL(38,4)")]
    [InlineData(Dialect.MySql, "bigint unsigned", "HUGEINT")]
    [InlineData(Dialect.ClickHouse, "UInt64", "HUGEINT")]
    [InlineData(Dialect.ClickHouse, "Int256", "VARCHAR")]
    [InlineData(Dialect.ClickHouse, "Decimal64(4)", "DECIMAL(38,4)")]
    [InlineData(Dialect.Snowflake, "NUMBER(38,0)", "HUGEINT")]
    [InlineData(Dialect.PlSql, "NUMBER", "DOUBLE")]
    [InlineData(Dialect.PgSql, "double precision", "DOUBLE")]
    [InlineData(Dialect.PgSql, "text", "VARCHAR")]
    [InlineData(Dialect.PgSql, "boolean", "BOOLEAN")]
    [InlineData(Dialect.PgSql, "date", "DATE")]
    [InlineData(Dialect.PgSql, "time without time zone", "TIME")]
    [InlineData(Dialect.PgSql, "timestamp without time zone", "TIMESTAMP")]
    [InlineData(Dialect.PgSql, "timestamp with time zone", "TIMESTAMPTZ")]
    [InlineData(Dialect.PgSql, "uuid", "UUID")]
    [InlineData(Dialect.PgSql, "bytea", "BLOB")]
    [InlineData(Dialect.PgSql, "jsonb", "JSON")]
    [InlineData(Dialect.TSql, "xml", "VARCHAR")]
    [InlineData(Dialect.TSql, "geography", "VARCHAR")]
    public void Kinds_map_to_engine_types(Dialect dialect, string type, string engineType)
    {
        var (p, s) = TypeMap.PrecisionScale(type);
        var col = new SourceColumn("c", type, TypeMap.KindOf(type, dialect), true, Precision: p, Scale: s);
        Assert.Equal(engineType, TypeMap.EngineType(col, out var warning));
        Assert.Null(warning);
    }

    [Fact]
    public void Decimals_wider_than_38_are_read_as_text_with_a_warning()
    {
        var col = new SourceColumn("big", "Decimal(76, 10)", ColumnKinds.Decimal, true, Precision: 76, Scale: 10);
        Assert.Equal("VARCHAR", TypeMap.EngineType(col, out var warning));
        Assert.Contains("DECIMAL(38)", warning);
    }

    [Theory]
    [InlineData("BigInt", ColumnKinds.Int)]
    [InlineData("HugeInt", ColumnKinds.Int)]
    [InlineData("UnsignedBigInt", ColumnKinds.Int)]
    [InlineData("Decimal", ColumnKinds.Decimal)]
    [InlineData("Double", ColumnKinds.Float)]
    [InlineData("Varchar", ColumnKinds.String)]
    [InlineData("Boolean", ColumnKinds.Bool)]
    [InlineData("Date", ColumnKinds.Date)]
    [InlineData("Time", ColumnKinds.Time)]
    [InlineData("Timestamp", ColumnKinds.DateTime)]
    [InlineData("TimestampTz", ColumnKinds.DateTimeOffset)]
    [InlineData("Uuid", ColumnKinds.Guid)]
    [InlineData("Blob", ColumnKinds.Binary)]
    [InlineData("List", ColumnKinds.Json)]
    [InlineData("Struct", ColumnKinds.Json)]
    [InlineData("Interval", ColumnKinds.String)]
    public void Result_types_map_to_console_kinds(string duckType, string kind) => Assert.Equal(kind, TypeMap.ResultKind(duckType, null));
}
