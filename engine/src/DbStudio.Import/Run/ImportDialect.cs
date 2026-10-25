using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Import.Parsing;

namespace DbStudio.Import.Run;

/// <summary>One column of the statements built by <see cref="ImportDialect"/>.</summary>
public sealed record TargetCol(string Name, string Kind, string TypeText, int? MaxLength, bool Nullable, bool HasDefault, bool IsIdentity);

public sealed record NewColumnSpec(string Name, string SqlType, bool Nullable);

/// <summary>
/// SQL dialect knowledge of the import: quoting, default column types, CREATE TABLE, multi-row INSERT, upsert (MERGE /
/// ON CONFLICT / ON DUPLICATE KEY), update, truncate and savepoints. Pure text generation: no connection needed, unit
/// tested per dialect.
/// </summary>
public abstract class ImportDialect
{
    public abstract Dialect Dialect { get; }
    public string ProviderId { get; protected init; } = "";

    public static ImportDialect For(Dialect dialect, string providerId = "") => dialect switch
    {
        Dialect.TSql => new TSqlImportDialect { ProviderId = providerId },
        Dialect.PgSql => new PgImportDialect { ProviderId = providerId },
        Dialect.MySql => new MySqlImportDialect { ProviderId = providerId },
        Dialect.PlSql => new OracleImportDialect { ProviderId = providerId },
        Dialect.Sqlite => new SqliteImportDialect { ProviderId = providerId },
        Dialect.ClickHouse => new ClickHouseImportDialect { ProviderId = providerId },
        Dialect.Snowflake => new SnowflakeImportDialect { ProviderId = providerId },
        _ => throw new NotSupportedException($"Importing into {dialect} connections is not supported."),
    };

    // ---- capabilities
    public abstract IReadOnlyList<string> Modes { get; }
    public virtual bool Transactional => true;
    public abstract string BulkMethod { get; }
    public abstract int DefaultBatchSize { get; }
    public abstract int MaxIdentifierLength { get; }
    public abstract IReadOnlyList<string> SqlTypes { get; }
    /// <summary>Highest number of bind parameters per statement.</summary>
    public virtual int MaxParameters => 2000;
    public virtual int MaxRowsPerStatement => 1000;
    /// <summary>Insert / upsert run as one single-row statement executed with array binding (Oracle).</summary>
    public virtual bool ArrayBinding => false;

    // ---- names
    public virtual (string Open, string Close) QuoteChars => ("\"", "\"");

    public string Quote(string name)
    {
        var (o, c) = QuoteChars;
        return o + name.Replace(c, c + c, StringComparison.Ordinal) + c;
    }

    /// <summary>Case folding of identifiers created by the import (Oracle upper, PostgreSQL lower).</summary>
    public virtual string Fold(string name) => name;

    public virtual string Qualify(string? database, string? schema, string table)
    {
        var parts = new List<string>();
        if (!string.IsNullOrEmpty(database) && UsesDatabasePrefix) parts.Add(Quote(database));
        if (!string.IsNullOrEmpty(schema)) parts.Add(Quote(schema));
        parts.Add(Quote(table));
        return string.Join('.', parts);
    }

    protected virtual bool UsesDatabasePrefix => false;

    /// <summary>A usable identifier from a free text (header cell, file name): control characters and quotes become '_'.</summary>
    public static string SanitizeName(string raw, int maxLength)
    {
        var sb = new StringBuilder();
        foreach (var ch in raw.Trim())
        {
            if (char.IsControl(ch) || ch is '"' or '`' or '[' or ']' or '\\' or '\'' or ';') sb.Append('_');
            else sb.Append(ch);
        }
        var s = sb.ToString().Trim();
        if (s.Length == 0) s = "column";
        if (maxLength > 0 && s.Length > maxLength) s = s[..maxLength];
        return s;
    }

    // ---- parameters
    public virtual string Placeholder(int index) => "@p" + index.ToString(CultureInfo.InvariantCulture);
    public virtual string ParameterName(int index) => "p" + index.ToString(CultureInfo.InvariantCulture);

    // ---- types
    public abstract string SqlType(InferredType t);

    protected static string TextOr(int length, int limit, string fixedTemplate, string overflow) =>
        length <= limit ? string.Format(CultureInfo.InvariantCulture, fixedTemplate, length) : overflow;

    // ---- DDL
    public virtual string CreateTable(string qualifiedTable, IReadOnlyList<NewColumnSpec> columns, IReadOnlyList<string> primaryKey)
    {
        var sb = new StringBuilder();
        sb.Append("CREATE TABLE ").Append(qualifiedTable).Append(" (\n");
        var pk = new HashSet<string>(primaryKey, StringComparer.OrdinalIgnoreCase);
        var lines = columns.Select(c => "    " + Quote(c.Name) + " " + c.SqlType + (c.Nullable && !pk.Contains(c.Name) ? "" : " NOT NULL")).ToList();
        if (primaryKey.Count > 0) lines.Add("    PRIMARY KEY (" + string.Join(", ", primaryKey.Select(Quote)) + ")");
        sb.Append(string.Join(",\n", lines)).Append('\n');
        sb.Append(')');
        return sb.ToString();
    }

    public string DropTable(string qualifiedTable) => "DROP TABLE " + qualifiedTable;

    // ---- data
    public virtual string TruncateSql(string qualifiedTable) => "TRUNCATE TABLE " + qualifiedTable;
    public string DeleteAllSql(string qualifiedTable) => "DELETE FROM " + qualifiedTable;

    /// <summary>Savepoint statements (null: the dialect has none; a failed statement then does not poison the transaction).</summary>
    public virtual string? Savepoint(string name) => "SAVEPOINT " + name;
    public virtual string? RollbackToSavepoint(string name) => "ROLLBACK TO SAVEPOINT " + name;
    public virtual string? ReleaseSavepoint(string name) => "RELEASE SAVEPOINT " + name;

    /// <summary>INSERT with <paramref name="rows"/> value tuples (placeholders numbered row-major).</summary>
    public virtual string InsertSql(string table, IReadOnlyList<string> columns, int rows)
    {
        var sb = new StringBuilder();
        sb.Append("INSERT INTO ").Append(table).Append(" (").AppendJoin(", ", columns.Select(Quote)).Append(") VALUES ");
        AppendTuples(sb, columns.Count, rows, 0);
        return sb.ToString();
    }

    protected void AppendTuples(StringBuilder sb, int columns, int rows, int start)
    {
        var p = start;
        for (var r = 0; r < rows; r++)
        {
            if (r > 0) sb.Append(", ");
            sb.Append('(');
            for (var c = 0; c < columns; c++)
            {
                if (c > 0) sb.Append(", ");
                sb.Append(Placeholder(p++));
            }
            sb.Append(')');
        }
    }

    /// <summary>Insert-or-update by key. <paramref name="updateColumns"/> excludes the keys.</summary>
    public abstract string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows);

    /// <summary>UPDATE of one row: SET placeholders first, then the key placeholders.</summary>
    public virtual string UpdateSql(string table, IReadOnlyList<string> setColumns, IReadOnlyList<string> keys)
    {
        var p = 0;
        var set = string.Join(", ", setColumns.Select(c => Quote(c) + " = " + Placeholder(p++)));
        var where = string.Join(" AND ", keys.Select(k => Quote(k) + " = " + Placeholder(p++)));
        return $"UPDATE {table} SET {set} WHERE {where}";
    }

    protected static IReadOnlyList<string> NonKey(IReadOnlyList<string> columns, IReadOnlyList<string> keys) =>
        columns.Where(c => !keys.Contains(c, StringComparer.OrdinalIgnoreCase)).ToList();

    /// <summary>Rows per statement for a batch given the column count.</summary>
    public int RowsPerStatement(int columns) => Math.Max(1, Math.Min(MaxRowsPerStatement, MaxParameters / Math.Max(1, columns)));

    // ---- target type classification
    private static readonly Regex Len = new(@"\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)", RegexOptions.Compiled);

    /// <summary>Kind (Kinds.*) of a declared column type, e.g. "nvarchar(50)" or "character varying(10)".</summary>
    public virtual string Classify(string typeText, out int? maxLength)
    {
        maxLength = null;
        var t = (typeText ?? "").Trim().ToLowerInvariant();
        var m = Len.Match(t);
        int? p1 = m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
        int? p2 = m.Success && m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : null;
        var bare = Regex.Replace(t, @"\(.*?\)", "").Trim();
        bare = Regex.Replace(bare, @"^nullable\s*|^lowcardinality\s*", "").Trim();
        if (bare.StartsWith("unsigned ", StringComparison.Ordinal)) bare = bare[9..];
        bare = bare.Replace(" unsigned", "").Replace(" zerofill", "").Trim();
        // ClickHouse wrappers: Nullable(Int32), LowCardinality(String)
        var ch = Regex.Match(t, @"^(?:nullable|lowcardinality)\((.+)\)$");
        if (ch.Success) return Classify(ch.Groups[1].Value, out maxLength);

        switch (bare)
        {
            case "bit" when Dialect == Dialect.TSql: return Kinds.Bool;
            case "bool" or "boolean": return Kinds.Bool;
            case "tinyint" when Dialect == Dialect.MySql && p1 == 1: return Kinds.Bool;
            case "timestamp" when Dialect == Dialect.TSql: return Kinds.Other; // rowversion
            case "int8" when Dialect == Dialect.ClickHouse: return Kinds.Int;
            case "tinyint" or "smallint" or "mediumint" or "int" or "integer" or "int2" or "int4" or "smallserial" or "serial" or "serial4" or "serial2"
                or "int16" or "uint8" or "uint16" or "int32" or "uint32": return Kinds.Int;
            case "int8" or "bigint" or "bigserial" or "serial8" or "uint64" or "int64" or "uint128" or "int128" or "uint256" or "int256": return Kinds.BigInt;
            case "decimal" or "numeric" or "money" or "smallmoney" or "dec" or "fixed": return Kinds.Decimal;
            case "number":
                if (Dialect == Dialect.PlSql && p1 == 1 && (p2 ?? 0) == 0) return Kinds.Bool;
                if (p1 is not null && (p2 ?? 0) == 0) return p1 <= 9 ? Kinds.Int : p1 <= 18 ? Kinds.BigInt : Kinds.Decimal;
                return Kinds.Decimal;
            case "float" or "real" or "double" or "double precision" or "float4" or "float8" or "binary_float" or "binary_double" or "float32" or "float64": return Kinds.Float;
            case "date" when Dialect == Dialect.PlSql: return Kinds.DateTime;
            case "date" or "date32": return Kinds.Date;
            case "datetime" or "datetime2" or "smalldatetime" or "datetimeoffset" or "timestamp" or "timestamptz" or "timestamp with time zone"
                or "timestamp without time zone" or "timestamp with local time zone" or "timestamp_ntz" or "timestamp_ltz" or "timestamp_tz"
                or "datetime64": return Kinds.DateTime;
            case "time" or "timetz" or "time with time zone" or "time without time zone": return Kinds.Time;
            case "uniqueidentifier" or "uuid": return Kinds.Guid;
            case "binary" or "varbinary" or "blob" or "bytea" or "image" or "raw" or "long raw" or "tinyblob" or "mediumblob" or "longblob" or "bfile": return Kinds.Binary;
            case "json" or "jsonb": return Kinds.Json;
            case "char" or "varchar" or "nchar" or "nvarchar" or "character" or "character varying" or "text" or "ntext" or "clob" or "nclob" or "varchar2"
                or "nvarchar2" or "string" or "citext" or "tinytext" or "mediumtext" or "longtext" or "enum" or "set" or "xml" or "name" or "bpchar" or "fixedstring"
                or "variant" or "object" or "array" or "rowid" or "urowid" or "long":
                if (p1 is { } n && n > 0 && bare is "char" or "varchar" or "nchar" or "nvarchar" or "character" or "character varying" or "varchar2" or "nvarchar2" or "bpchar" or "fixedstring")
                    maxLength = n;
                else if (Dialect == Dialect.Snowflake && p1 is { } sn) maxLength = sn;
                return Kinds.Text;
        }
        return Kinds.Other;
    }
}

internal sealed class TSqlImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.TSql;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "SqlBulkCopy";
    public override int DefaultBatchSize => 5000;
    public override int MaxIdentifierLength => 128;
    public override (string Open, string Close) QuoteChars => ("[", "]");
    public override int MaxParameters => 2000;
    protected override bool UsesDatabasePrefix => true;
    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "bit", "tinyint", "smallint", "int", "bigint", "decimal(18,2)", "float", "real", "money", "date", "datetime2", "datetime", "time", "datetimeoffset",
        "uniqueidentifier", "nvarchar(50)", "nvarchar(255)", "nvarchar(max)", "varchar(255)", "varchar(max)", "varbinary(max)", "xml",
    ];

    public override string Savepoint(string name) => "SAVE TRANSACTION " + name;
    public override string RollbackToSavepoint(string name) => "ROLLBACK TRANSACTION " + name;
    public override string? ReleaseSavepoint(string name) => null;

    public override string Qualify(string? database, string? schema, string table) =>
        string.IsNullOrEmpty(database) ? base.Qualify(null, string.IsNullOrEmpty(schema) ? "dbo" : schema, table) : $"{Quote(database)}.{Quote(string.IsNullOrEmpty(schema) ? "dbo" : schema)}.{Quote(table)}";

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "bit",
        Kinds.Int => "int",
        Kinds.BigInt => "bigint",
        Kinds.Decimal => $"decimal({t.Precision ?? 18},{t.Scale ?? 2})",
        Kinds.Float => "float",
        Kinds.Date => "date",
        Kinds.DateTime => "datetime2(3)",
        Kinds.Time => "time(0)",
        Kinds.Guid => "uniqueidentifier",
        Kinds.Empty => "nvarchar(255)",
        _ => TextOr(t.Length ?? 255, 4000, "nvarchar({0})", "nvarchar(max)"),
    };

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder();
        sb.Append("MERGE INTO ").Append(table).Append(" AS tgt USING (VALUES ");
        AppendTuples(sb, columns.Count, rows, 0);
        sb.Append(") AS src (").AppendJoin(", ", columns.Select(Quote)).Append(") ON ");
        sb.AppendJoin(" AND ", keys.Select(k => $"tgt.{Quote(k)} = src.{Quote(k)}"));
        var set = NonKey(columns, keys);
        if (set.Count > 0) sb.Append(" WHEN MATCHED THEN UPDATE SET ").AppendJoin(", ", set.Select(c => $"tgt.{Quote(c)} = src.{Quote(c)}"));
        sb.Append(" WHEN NOT MATCHED THEN INSERT (").AppendJoin(", ", columns.Select(Quote)).Append(") VALUES (")
            .AppendJoin(", ", columns.Select(c => "src." + Quote(c))).Append(");");
        return sb.ToString();
    }
}

internal sealed class PgImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.PgSql;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "COPY (text)";
    public override int DefaultBatchSize => 5000;
    public override int MaxIdentifierLength => 63;
    public override int MaxParameters => 30000;
    public override string Fold(string name) => name.ToLowerInvariant();

    /// <summary>Explicit values for identity columns (GENERATED ALWAYS needs OVERRIDING SYSTEM VALUE).</summary>
    public bool OverrideIdentity { get; set; }

    public override string InsertSql(string table, IReadOnlyList<string> columns, int rows)
    {
        if (!OverrideIdentity) return base.InsertSql(table, columns, rows);
        var sb = new StringBuilder();
        sb.Append("INSERT INTO ").Append(table).Append(" (").AppendJoin(", ", columns.Select(Quote)).Append(") OVERRIDING SYSTEM VALUE VALUES ");
        AppendTuples(sb, columns.Count, rows, 0);
        return sb.ToString();
    }

    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "boolean", "smallint", "integer", "bigint", "numeric(18,2)", "real", "double precision", "date", "timestamp", "timestamptz", "time", "uuid",
        "varchar(50)", "varchar(255)", "text", "jsonb", "bytea",
    ];

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "boolean",
        Kinds.Int => "integer",
        Kinds.BigInt => "bigint",
        Kinds.Decimal => $"numeric({t.Precision ?? 18},{t.Scale ?? 2})",
        Kinds.Float => "double precision",
        Kinds.Date => "date",
        Kinds.DateTime => "timestamp",
        Kinds.Time => "time",
        Kinds.Guid => "uuid",
        Kinds.Empty => "text",
        _ => TextOr(t.Length ?? 255, 4000, "varchar({0})", "text"),
    };

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder(InsertSql(table, columns, rows));
        sb.Append(" ON CONFLICT (").AppendJoin(", ", keys.Select(Quote)).Append(')');
        var set = NonKey(columns, keys);
        if (set.Count == 0) sb.Append(" DO NOTHING");
        else sb.Append(" DO UPDATE SET ").AppendJoin(", ", set.Select(c => $"{Quote(c)} = EXCLUDED.{Quote(c)}"));
        return sb.ToString();
    }
}

internal sealed class MySqlImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.MySql;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "Batched multi-row INSERT";
    public override int DefaultBatchSize => 1000;
    public override int MaxIdentifierLength => 64;
    public override int MaxParameters => 60000;
    public override (string Open, string Close) QuoteChars => ("`", "`");
    protected override bool UsesDatabasePrefix => false;
    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "tinyint(1)", "smallint", "int", "bigint", "decimal(18,2)", "float", "double", "date", "datetime(6)", "time", "char(36)",
        "varchar(50)", "varchar(255)", "text", "longtext", "json", "blob",
    ];

    public override string Qualify(string? database, string? schema, string table) =>
        string.IsNullOrEmpty(schema) ? Quote(table) : $"{Quote(schema)}.{Quote(table)}";

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "tinyint(1)",
        Kinds.Int => "int",
        Kinds.BigInt => "bigint",
        Kinds.Decimal => $"decimal({Math.Min(65, t.Precision ?? 18)},{t.Scale ?? 2})",
        Kinds.Float => "double",
        Kinds.Date => "date",
        Kinds.DateTime => "datetime(6)",
        Kinds.Time => "time",
        Kinds.Guid => "char(36)",
        Kinds.Empty => "varchar(255)",
        _ => (t.Length ?? 255) <= 255 ? $"varchar({t.Length ?? 255})" : (t.Length ?? 0) <= 16000 ? "text" : "longtext",
    };

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder(InsertSql(table, columns, rows));
        var set = NonKey(columns, keys);
        sb.Append(" ON DUPLICATE KEY UPDATE ");
        if (set.Count == 0) sb.Append(Quote(keys[0])).Append(" = ").Append(Quote(keys[0]));
        else sb.AppendJoin(", ", set.Select(c => $"{Quote(c)} = VALUES({Quote(c)})"));
        return sb.ToString();
    }
}

internal sealed class OracleImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.PlSql;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "Array binding";
    public override int DefaultBatchSize => 1000;
    public override int MaxIdentifierLength => 128;
    public override bool ArrayBinding => true;
    public override string Fold(string name) => name.ToUpperInvariant();
    public override string Placeholder(int index) => ":p" + index.ToString(CultureInfo.InvariantCulture);
    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "NUMBER(1)", "NUMBER(10)", "NUMBER(19)", "NUMBER(18,2)", "BINARY_DOUBLE", "DATE", "TIMESTAMP", "RAW(16)", "VARCHAR2(36)",
        "NVARCHAR2(50)", "NVARCHAR2(255)", "NVARCHAR2(2000)", "NCLOB", "BLOB",
    ];

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "NUMBER(1)",
        Kinds.Int => "NUMBER(10)",
        Kinds.BigInt => "NUMBER(19)",
        Kinds.Decimal => $"NUMBER({t.Precision ?? 18},{t.Scale ?? 2})",
        Kinds.Float => "BINARY_DOUBLE",
        Kinds.Date => "DATE",
        Kinds.DateTime => "TIMESTAMP",
        Kinds.Time => "VARCHAR2(16)",
        Kinds.Guid => "VARCHAR2(36)",
        Kinds.Empty => "NVARCHAR2(255)",
        _ => TextOr(t.Length ?? 255, 2000, "NVARCHAR2({0})", "NCLOB"),
    };

    public override string InsertSql(string table, IReadOnlyList<string> columns, int rows) =>
        $"INSERT INTO {table} ({string.Join(", ", columns.Select(Quote))}) VALUES ({string.Join(", ", columns.Select((_, i) => Placeholder(i)))})";

    public override string Savepoint(string name) => "SAVEPOINT " + name;
    public override string? ReleaseSavepoint(string name) => null;

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder();
        sb.Append("MERGE INTO ").Append(table).Append(" tgt USING (SELECT ")
            .AppendJoin(", ", columns.Select((_, i) => $"{Placeholder(i)} AS s{i}")).Append(" FROM dual) src ON (");
        sb.AppendJoin(" AND ", keys.Select(k => $"tgt.{Quote(k)} = src.s{IndexOf(columns, k)}")).Append(')');
        var set = NonKey(columns, keys);
        if (set.Count > 0)
            sb.Append(" WHEN MATCHED THEN UPDATE SET ").AppendJoin(", ", set.Select(c => $"tgt.{Quote(c)} = src.s{IndexOf(columns, c)}"));
        sb.Append(" WHEN NOT MATCHED THEN INSERT (").AppendJoin(", ", columns.Select(Quote)).Append(") VALUES (")
            .AppendJoin(", ", columns.Select((_, i) => $"src.s{i}")).Append(')');
        return sb.ToString();
    }

    private static int IndexOf(IReadOnlyList<string> columns, string name)
    {
        for (var i = 0; i < columns.Count; i++) if (string.Equals(columns[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }
}

internal sealed class SqliteImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.Sqlite;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "Batched multi-row INSERT";
    public override int DefaultBatchSize => 1000;
    public override int MaxIdentifierLength => 255;
    public override int MaxParameters => 30000;
    public override int MaxRowsPerStatement => 500;
    public override IReadOnlyList<string> SqlTypes { get; } = ["INTEGER", "REAL", "NUMERIC", "TEXT", "BLOB", "DATE", "DATETIME", "BOOLEAN"];

    public override string Qualify(string? database, string? schema, string table) =>
        string.IsNullOrEmpty(schema) || schema == "main" ? Quote(table) : $"{Quote(schema)}.{Quote(table)}";

    public override string TruncateSql(string qualifiedTable) => "DELETE FROM " + qualifiedTable;

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "BOOLEAN",
        Kinds.Int or Kinds.BigInt => "INTEGER",
        Kinds.Decimal => "NUMERIC",
        Kinds.Float => "REAL",
        Kinds.Date => "DATE",
        Kinds.DateTime => "DATETIME",
        _ => "TEXT",
    };

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder(InsertSql(table, columns, rows));
        sb.Append(" ON CONFLICT (").AppendJoin(", ", keys.Select(Quote)).Append(')');
        var set = NonKey(columns, keys);
        if (set.Count == 0) sb.Append(" DO NOTHING");
        else sb.Append(" DO UPDATE SET ").AppendJoin(", ", set.Select(c => $"{Quote(c)} = excluded.{Quote(c)}"));
        return sb.ToString();
    }
}

internal sealed class ClickHouseImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.ClickHouse;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert"];
    public override bool Transactional => false;
    public override string BulkMethod => "Native bulk insert";
    public override int DefaultBatchSize => 10000;
    public override int MaxIdentifierLength => 255;
    public override (string Open, string Close) QuoteChars => ("`", "`");
    public override string? Savepoint(string name) => null;
    public override string? RollbackToSavepoint(string name) => null;
    public override string? ReleaseSavepoint(string name) => null;
    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "Bool", "Int8", "Int16", "Int32", "Int64", "UInt32", "UInt64", "Decimal(18,2)", "Float32", "Float64", "Date", "Date32", "DateTime", "DateTime64(3)", "UUID", "String",
    ];

    public override string Qualify(string? database, string? schema, string table)
    {
        var db = !string.IsNullOrEmpty(schema) ? schema : database;
        return string.IsNullOrEmpty(db) ? Quote(table) : $"{Quote(db)}.{Quote(table)}";
    }

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "Bool",
        Kinds.Int => "Int32",
        Kinds.BigInt => "Int64",
        Kinds.Decimal => $"Decimal({Math.Min(76, t.Precision ?? 18)},{t.Scale ?? 2})",
        Kinds.Float => "Float64",
        Kinds.Date => "Date32",
        Kinds.DateTime => "DateTime64(3)",
        Kinds.Guid => "UUID",
        _ => "String",
    };

    public override string CreateTable(string qualifiedTable, IReadOnlyList<NewColumnSpec> columns, IReadOnlyList<string> primaryKey)
    {
        var pk = new HashSet<string>(primaryKey, StringComparer.OrdinalIgnoreCase);
        var sb = new StringBuilder();
        sb.Append("CREATE TABLE ").Append(qualifiedTable).Append(" (\n");
        sb.Append(string.Join(",\n", columns.Select(c =>
            "    " + Quote(c.Name) + " " + (c.Nullable && !pk.Contains(c.Name) && !c.SqlType.StartsWith("Nullable(", StringComparison.OrdinalIgnoreCase) ? $"Nullable({c.SqlType})" : c.SqlType)))).Append('\n');
        sb.Append(") ENGINE = MergeTree ORDER BY ").Append(primaryKey.Count > 0 ? "(" + string.Join(", ", primaryKey.Select(Quote)) + ")" : "tuple()");
        return sb.ToString();
    }

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows) =>
        throw new NotSupportedException("ClickHouse has no upsert; import in append mode (use a ReplacingMergeTree table to deduplicate).");

    public override string UpdateSql(string table, IReadOnlyList<string> setColumns, IReadOnlyList<string> keys) =>
        throw new NotSupportedException("Update-only import is not supported for ClickHouse.");
}

internal sealed class SnowflakeImportDialect : ImportDialect
{
    public override Dialect Dialect => Dialect.Snowflake;
    public override IReadOnlyList<string> Modes => ["append", "truncateInsert", "upsert", "updateOnly"];
    public override string BulkMethod => "Batched multi-row INSERT";
    public override int DefaultBatchSize => 1000;
    public override int MaxIdentifierLength => 255;
    public override int MaxParameters => 8000;
    public override int MaxRowsPerStatement => 1000;
    protected override bool UsesDatabasePrefix => true;
    public override string Fold(string name) => name.ToUpperInvariant();
    public override string Placeholder(int index) => ":" + (index + 1).ToString(CultureInfo.InvariantCulture);
    public override string ParameterName(int index) => (index + 1).ToString(CultureInfo.InvariantCulture);
    public override string? Savepoint(string name) => null;
    public override string? RollbackToSavepoint(string name) => null;
    public override string? ReleaseSavepoint(string name) => null;
    public override IReadOnlyList<string> SqlTypes { get; } =
    [
        "BOOLEAN", "INTEGER", "BIGINT", "NUMBER(18,2)", "FLOAT", "DATE", "TIMESTAMP_NTZ", "TIME", "VARCHAR(255)", "VARCHAR", "VARIANT", "BINARY",
    ];

    public override string SqlType(InferredType t) => t.Kind switch
    {
        Kinds.Bool => "BOOLEAN",
        Kinds.Int => "INTEGER",
        Kinds.BigInt => "BIGINT",
        Kinds.Decimal => $"NUMBER({t.Precision ?? 18},{t.Scale ?? 2})",
        Kinds.Float => "FLOAT",
        Kinds.Date => "DATE",
        Kinds.DateTime => "TIMESTAMP_NTZ",
        Kinds.Time => "TIME",
        Kinds.Guid => "VARCHAR(36)",
        Kinds.Empty => "VARCHAR(255)",
        _ => TextOr(t.Length ?? 255, 4000, "VARCHAR({0})", "VARCHAR"),
    };

    public override string UpsertSql(string table, IReadOnlyList<string> columns, IReadOnlyList<string> keys, int rows)
    {
        var sb = new StringBuilder();
        sb.Append("MERGE INTO ").Append(table).Append(" tgt USING (SELECT ")
            .AppendJoin(", ", columns.Select((_, i) => $"${i + 1} AS S{i}")).Append(" FROM VALUES ");
        AppendTuples(sb, columns.Count, rows, 0);
        sb.Append(") src ON ");
        sb.AppendJoin(" AND ", keys.Select(k => $"tgt.{Quote(k)} = src.S{Index(columns, k)}"));
        var set = NonKey(columns, keys);
        if (set.Count > 0) sb.Append(" WHEN MATCHED THEN UPDATE SET ").AppendJoin(", ", set.Select(c => $"tgt.{Quote(c)} = src.S{Index(columns, c)}"));
        sb.Append(" WHEN NOT MATCHED THEN INSERT (").AppendJoin(", ", columns.Select(Quote)).Append(") VALUES (")
            .AppendJoin(", ", columns.Select((_, i) => $"src.S{i}")).Append(')');
        return sb.ToString();
    }

    private static int Index(IReadOnlyList<string> columns, string name)
    {
        for (var i = 0; i < columns.Count; i++) if (string.Equals(columns[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }
}
