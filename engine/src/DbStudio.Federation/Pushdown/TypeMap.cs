using System.Globalization;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Pushdown;

/// <summary>
/// Type map of linked databases (plan-links 1, "Type map", docs/wp-notes/links/WP-A.md):
/// <list type="bullet">
/// <item>source type text (catalog <c>TypeText</c>) → <see cref="ColumnKinds"/> (<see cref="KindOf"/>, ClickHouse
/// <c>Nullable(…)</c>/<c>LowCardinality(…)</c> unwrapped, MySQL <c>unsigned</c>, Oracle/Snowflake <c>NUMBER(p,0)</c> → int);</item>
/// <item>kind → engine type (<see cref="EngineType"/>): int → BIGINT (unsigned 64-bit, 128-bit, NUMBER(19..38,0) →
/// HUGEINT; 256-bit → VARCHAR), float → DOUBLE, decimal(p,s) → DECIMAL(38,s) (p &gt; 38 → VARCHAR + decimalWidened;
/// no precision → DOUBLE), string → VARCHAR, bool → BOOLEAN, date → DATE, time → TIME, datetime → TIMESTAMP,
/// datetimeoffset → TIMESTAMPTZ (UTC), guid → UUID, binary → BLOB, json → JSON, xml / other → VARCHAR;</item>
/// <item>DuckDB result column types → console kinds (<see cref="ResultKind"/>).</item>
/// </list>
/// </summary>
public static partial class TypeMap
{
    /// <summary>The kind of a source column type text of <paramref name="dialect"/>.</summary>
    public static string KindOf(string? sourceType, Dialect? dialect)
    {
        if (string.IsNullOrWhiteSpace(sourceType)) return ColumnKinds.Other;
        var raw = Unwrap(sourceType.Trim());
        var lower = raw.ToLowerInvariant();
        var (precision, scale) = PrecisionScale(raw);

        switch (dialect)
        {
            case Dialect.ClickHouse:
                return ClickHouseKind(lower);
            case Dialect.Cql:
                return CqlKind(lower);
            case Dialect.PlSql or Dialect.Snowflake when Head(lower) is "number" or "numeric" or "decimal":
                return precision is not null && (scale ?? 0) == 0 ? ColumnKinds.Int : ColumnKinds.Decimal;
            case Dialect.Snowflake:
            {
                var head = Head(lower);
                if (head is "timestamp_tz" or "timestamp_ltz") return ColumnKinds.DateTimeOffset;
                if (head is "timestamp_ntz" or "timestamp" or "datetime") return ColumnKinds.DateTime;
                if (head is "variant" or "object" or "array") return ColumnKinds.Json;
                if (head is "int" or "integer" or "bigint" or "smallint" or "tinyint" or "byteint") return ColumnKinds.Int;
                if (head is "float" or "float4" or "float8" or "double" or "real" or "double precision") return ColumnKinds.Float;
                break;
            }
            case Dialect.PgSql:
            {
                var head = Head(lower);
                if (lower.EndsWith("[]", StringComparison.Ordinal)) return ColumnKinds.Other;
                if (head is "jsonb" or "json") return ColumnKinds.Json;
                if (head is "time" or "time without time zone") return ColumnKinds.Time;
                if (head.StartsWith("time with", StringComparison.Ordinal) || head == "timetz") return ColumnKinds.String;
                if (head is "timestamptz") return ColumnKinds.DateTimeOffset;
                if (head is "int2" or "int4" or "int8" or "serial" or "bigserial" or "smallserial" or "oid") return ColumnKinds.Int;
                if (head is "float4" or "float8") return ColumnKinds.Float;
                if (head is "bool") return ColumnKinds.Bool;
                if (head is "bytea") return ColumnKinds.Binary;
                if (head is "citext" or "name" or "bpchar" or "inet" or "cidr" or "macaddr" or "interval") return ColumnKinds.String;
                break;
            }
            case Dialect.MySql:
            {
                var head = Head(lower.Replace(" unsigned", "", StringComparison.Ordinal).Replace(" zerofill", "", StringComparison.Ordinal)
                    .Replace(" signed", "", StringComparison.Ordinal));
                if (head is "year") return ColumnKinds.Int;
                if (head is "enum" or "set" or "tinytext" or "mediumtext" or "longtext") return ColumnKinds.String;
                if (head is "tinyblob" or "mediumblob" or "longblob") return ColumnKinds.Binary;
                if (head is "timestamp") return ColumnKinds.DateTime;
                if (head is "bit") return precision is null or 1 ? ColumnKinds.Bool : ColumnKinds.Int;
                if (head is "json") return ColumnKinds.Json;
                lower = head;
                break;
            }
            case Dialect.TSql:
            {
                var head = Head(lower);
                if (head is "timestamp" or "rowversion") return ColumnKinds.Binary; // rowversion, not a date
                break;
            }
        }

        if (lower.StartsWith("timestamp", StringComparison.Ordinal) && lower.Contains("without time zone", StringComparison.Ordinal)) return ColumnKinds.DateTime;
        var kind = ValueConverter.KindFor(null, lower, dialect);
        return kind == ColumnKinds.Cursor ? ColumnKinds.Other : kind;
    }

    private static string Head(string lower)
    {
        var open = lower.IndexOf('(');
        var s = open < 0 ? lower : lower[..open] + (lower.IndexOf(')', open) is var close and > 0 ? lower[(close + 1)..] : "");
        return string.Join(' ', s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>ClickHouse <c>Nullable(T)</c>, <c>LowCardinality(T)</c> and <c>SimpleAggregateFunction(f, T)</c> → <c>T</c>.</summary>
    private static string Unwrap(string type)
    {
        while (true)
        {
            var m = WrapperPattern().Match(type);
            if (!m.Success) return type;
            type = m.Groups["inner"].Value.Trim();
        }
    }

    [GeneratedRegex(@"^(?:Nullable|LowCardinality|SimpleAggregateFunction\s*\(\s*\w+\s*,)\s*\((?<inner>.*)\)\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex WrapperPattern();

    private static string ClickHouseKind(string lower)
    {
        var head = Head(lower);
        if (head.StartsWith("int", StringComparison.Ordinal) || head.StartsWith("uint", StringComparison.Ordinal)) return ColumnKinds.Int;
        if (head.StartsWith("float", StringComparison.Ordinal)) return ColumnKinds.Float;
        if (head.StartsWith("decimal", StringComparison.Ordinal)) return ColumnKinds.Decimal;
        if (head is "string" or "fixedstring" or "ipv4" or "ipv6" or "enum8" or "enum16" or "enum") return ColumnKinds.String;
        if (head is "date" or "date32") return ColumnKinds.Date;
        if (head is "datetime" or "datetime64") return ColumnKinds.DateTime;
        if (head is "uuid") return ColumnKinds.Guid;
        if (head is "bool" or "boolean") return ColumnKinds.Bool;
        if (head is "json" or "object") return ColumnKinds.Json;
        return ColumnKinds.Other;
    }

    private static string CqlKind(string lower)
    {
        var head = Head(lower);
        if (head.StartsWith("frozen", StringComparison.Ordinal) || head.Contains('<', StringComparison.Ordinal)) return ColumnKinds.Json;
        return head switch
        {
            "text" or "varchar" or "ascii" or "inet" or "duration" => ColumnKinds.String,
            "int" or "bigint" or "smallint" or "tinyint" or "counter" or "varint" => ColumnKinds.Int,
            "decimal" => ColumnKinds.Decimal,
            "float" or "double" => ColumnKinds.Float,
            "boolean" => ColumnKinds.Bool,
            "uuid" or "timeuuid" => ColumnKinds.Guid,
            "timestamp" => ColumnKinds.DateTimeOffset,
            "date" => ColumnKinds.Date,
            "time" => ColumnKinds.Time,
            "blob" => ColumnKinds.Binary,
            _ => ColumnKinds.Other,
        };
    }

    /// <summary>(precision, scale) from "decimal(12,2)", "NUMBER(10)", "Decimal(38, 4)", "Decimal64(4)"; nulls when absent.</summary>
    public static (int? Precision, int? Scale) PrecisionScale(string? type)
    {
        if (string.IsNullOrEmpty(type)) return (null, null);
        var m = ArgsPattern().Match(type);
        if (!m.Success) return (null, null);
        int? p = int.TryParse(m.Groups["p"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pv) ? pv : null;
        int? s = m.Groups["s"].Success && int.TryParse(m.Groups["s"].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) ? sv : null;
        var lower = type.ToLowerInvariant();
        // ClickHouse Decimal32(S)/Decimal64(S)/Decimal128(S)/Decimal256(S): the argument is the scale.
        var chDec = DecimalNPattern().Match(lower);
        if (chDec.Success)
        {
            var bits = int.Parse(chDec.Groups["bits"].Value, CultureInfo.InvariantCulture);
            return (bits switch { 32 => 9, 64 => 18, 128 => 38, _ => 76 }, p);
        }
        return (p, s);
    }

    [GeneratedRegex(@"\(\s*(?<p>\d+)\s*(?:,\s*(?<s>-?\d+)\s*)?\)")]
    private static partial Regex ArgsPattern();

    [GeneratedRegex(@"decimal(?<bits>32|64|128|256)\s*\(")]
    private static partial Regex DecimalNPattern();

    /// <summary>The engine column of a source column (plus a decimalWidened warning when a decimal is read as VARCHAR).</summary>
    public static FederatedColumn ToEngine(SourceColumn column, out string? warning)
    {
        var type = EngineType(column, out warning);
        return new FederatedColumn(column.Name, column.Kind, type, column.Nullable, column.SourceType);
    }

    /// <summary>The DuckDB type of a source column.</summary>
    public static string EngineType(SourceColumn column, out string? warning)
    {
        warning = null;
        var lower = Unwrap(column.SourceType ?? "").ToLowerInvariant();
        switch (column.Kind)
        {
            case ColumnKinds.Int:
            {
                if (lower.Contains("256", StringComparison.Ordinal) && (lower.StartsWith("int", StringComparison.Ordinal) || lower.StartsWith("uint", StringComparison.Ordinal)))
                    return "VARCHAR";
                var wide = lower.StartsWith("uint64", StringComparison.Ordinal) || lower.StartsWith("int128", StringComparison.Ordinal)
                           || lower.StartsWith("uint128", StringComparison.Ordinal) || lower.Contains("bigint unsigned", StringComparison.Ordinal)
                           || lower.StartsWith("varint", StringComparison.Ordinal) || lower.StartsWith("hugeint", StringComparison.Ordinal)
                           || (column.Precision ?? PrecisionScale(column.SourceType).Precision) is > 18;
                return wide ? "HUGEINT" : "BIGINT";
            }
            case ColumnKinds.Float:
                return "DOUBLE";
            case ColumnKinds.Decimal:
            {
                var (p, s) = column.Precision is not null ? (column.Precision, column.Scale) : PrecisionScale(column.SourceType);
                if (lower.StartsWith("money", StringComparison.Ordinal) || lower.StartsWith("smallmoney", StringComparison.Ordinal)) (p, s) = (19, 4);
                if (p is null) return "DOUBLE";
                if (p > 38)
                {
                    warning = $"{column.Name}: {column.SourceType} is wider than DECIMAL(38) and is read as VARCHAR.";
                    return "VARCHAR";
                }
                var scale = Math.Clamp(s ?? 0, 0, 38);
                return $"DECIMAL(38,{scale.ToString(CultureInfo.InvariantCulture)})";
            }
            case ColumnKinds.String: return "VARCHAR";
            case ColumnKinds.Bool: return "BOOLEAN";
            case ColumnKinds.Date: return "DATE";
            case ColumnKinds.Time: return "TIME";
            case ColumnKinds.DateTime: return "TIMESTAMP";
            case ColumnKinds.DateTimeOffset: return "TIMESTAMPTZ";
            case ColumnKinds.Guid: return "UUID";
            case ColumnKinds.Binary: return "BLOB";
            case ColumnKinds.Json: return "JSON";
            default: return "VARCHAR";
        }
    }

    /// <summary>
    /// Console kind of a DuckDB result column from DuckDB.NET's type name (<c>GetDataTypeName</c>: "BigInt", "Decimal",
    /// "TimestampTz", "List"…) or SQL type text ("DECIMAL(38,2)", "TIMESTAMP WITH TIME ZONE").
    /// </summary>
    public static string ResultKind(string? duckTypeName, Type? clrType)
    {
        var t = (duckTypeName ?? "").Trim().ToLowerInvariant().Replace("_", "", StringComparison.Ordinal);
        var open = t.IndexOf('(');
        if (open >= 0) t = t[..open].Trim();
        switch (t)
        {
            case "bigint" or "integer" or "smallint" or "tinyint" or "hugeint" or "uhugeint" or "unsignedbigint" or "unsignedinteger"
                or "unsignedsmallint" or "unsignedtinyint" or "ubigint" or "uinteger" or "usmallint" or "utinyint" or "int" or "int8" or "int4":
                return ColumnKinds.Int;
            case "double" or "float" or "real":
                return ColumnKinds.Float;
            case "decimal" or "numeric" or "varint" or "bignum":
                return t is "decimal" or "numeric" ? ColumnKinds.Decimal : ColumnKinds.String;
            case "varchar" or "text" or "string" or "enum" or "interval" or "bit" or "bitstring":
                return ColumnKinds.String;
            case "boolean" or "bool":
                return ColumnKinds.Bool;
            case "date":
                return ColumnKinds.Date;
            case "time" or "timetz" or "timens":
                return ColumnKinds.Time;
            case "timestamp" or "timestampns" or "timestampms" or "timestamps" or "datetime":
                return ColumnKinds.DateTime;
            case "timestamptz" or "timestamp with time zone":
                return ColumnKinds.DateTimeOffset;
            case "uuid":
                return ColumnKinds.Guid;
            case "blob" or "bytea":
                return ColumnKinds.Binary;
            case "json":
                return ColumnKinds.Json;
            case "list" or "struct" or "map" or "array" or "union":
                return ColumnKinds.Json;
        }
        if (t.StartsWith("timestamp with time zone", StringComparison.Ordinal)) return ColumnKinds.DateTimeOffset;
        return ValueConverter.KindFor(clrType, duckTypeName, Dialect.DuckDb);
    }

    /// <summary>SQL spelling of a DuckDB.NET type name for result metadata ("BigInt" → "BIGINT", "TimestampTz" → "TIMESTAMPTZ").</summary>
    public static string ResultTypeText(string? duckTypeName) => (duckTypeName ?? "").ToLowerInvariant() switch
    {
        "unsignedbigint" => "UBIGINT",
        "unsignedinteger" => "UINTEGER",
        "unsignedsmallint" => "USMALLINT",
        "unsignedtinyint" => "UTINYINT",
        "hugeint" => "HUGEINT",
        "unsignedhugeint" => "UHUGEINT",
        var other => other.ToUpperInvariant(),
    };
}
