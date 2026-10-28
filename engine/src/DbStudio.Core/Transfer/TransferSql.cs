using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.Transfer;

/// <summary>A column of the target table as the writer needs it.</summary>
/// <param name="TypeText">The target column type as written in the DDL.</param>
public sealed record TargetColumn(string Name, CanonType Type, string TypeText, bool Identity, bool IsKey);

/// <summary>How a batch of rows is written.</summary>
/// <param name="IdentityInsert">The table has an identity column whose values are copied (SQL Server needs IDENTITY_INSERT).</param>
/// <param name="Upsert">Insert new rows and update existing ones (needs <see cref="TransferSql.BuildInsert"/> key columns).</param>
public sealed record InsertMode(bool IdentityInsert, bool Upsert);

/// <summary>
/// Dialect specific SQL of a data transfer: quoting, value literals, INSERT / upsert batches, truncate, drop, identity reset.
/// Rows arrive as wire values (see <see cref="ValueConverter"/>) and are written as literals, so the same code serves a live
/// target and the "Dump SQL file" target.
/// </summary>
public static partial class TransferSql
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // ------------------------------------------------------------------ names

    public static string Quote(Dialect d, string name) => DialectInfo.QuoteIdentifier(d, name);

    /// <summary>Qualified table name. SQLite is single-schema (the "main" qualifier is only added for attached databases).</summary>
    public static string Qualified(Dialect d, string? schema, string table)
    {
        if (string.IsNullOrEmpty(schema) || d == Dialect.Sqlite && schema.Equals("main", StringComparison.OrdinalIgnoreCase))
            return Quote(d, table);
        return Quote(d, schema) + "." + Quote(d, table);
    }

    public static string CaseFold(string name, string mode, Dialect target) => mode switch
    {
        NameCases.Lower => name.ToLowerInvariant(),
        NameCases.Upper => name.ToUpperInvariant(),
        NameCases.Auto => target switch
        {
            Dialect.PgSql => name.ToLowerInvariant(),
            Dialect.PlSql or Dialect.Snowflake => name.ToUpperInvariant(),
            _ => name,
        },
        _ => name,
    };

    // ------------------------------------------------------------------ literals

    [GeneratedRegex(@"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")]
    private static partial Regex NumberRegex();

    [GeneratedRegex(@"^(?<date>-?\d{4,6}-\d\d-\d\d)(?:[T ](?<time>\d\d:\d\d:\d\d)(?<frac>\.\d+)?)?\s*(?<off>Z|[+-]\d\d(?::?\d\d)?)?$")]
    private static partial Regex DateTimeRegex();

    [GeneratedRegex(@"^(?<time>\d\d:\d\d:\d\d)(?<frac>\.\d+)?$")]
    private static partial Regex TimeRegex();

    public static string Literal(Dialect d, object? wire, CanonType t, string typeText = "")
    {
        if (wire is TruncatedValue tv) wire = tv.Full;
        if (wire is null || wire is CursorValue) return "NULL";
        switch (t.Kind)
        {
            case TypeKind.Boolean:
                return wire switch
                {
                    bool b => Bool(d, b, typeText),
                    string s => Bool(d, s.Trim().ToLowerInvariant() is "1" or "true" or "t" or "y" or "yes" or "on", typeText),
                    BinaryValue => "NULL",
                    _ => Bool(d, Convert.ToDouble(wire, Inv) != 0, typeText),
                };
            case TypeKind.Int or TypeKind.Decimal:
                return Number(d, wire);
            case TypeKind.Float:
                return Float(d, wire);
            case TypeKind.Date or TypeKind.Time or TypeKind.DateTime or TypeKind.DateTimeTz:
                return wire is string ts ? Temporal(d, t, ts, typeText) : Str(d, Text(wire));
            case TypeKind.Guid:
                return wire is string g && d == Dialect.Cql && Guid.TryParse(g, out _) ? g : Str(d, Text(wire));
            case TypeKind.Binary or TypeKind.VarBinary or TypeKind.Blob:
                return wire switch
                {
                    BinaryValue bin => Binary(d, bin.Full),
                    string s => Binary(d, Encoding.UTF8.GetBytes(s)),
                    _ => Binary(d, Encoding.UTF8.GetBytes(Text(wire))),
                };
            default:
            {
                var text = wire is BinaryValue b2 ? Convert.ToBase64String(b2.Full) : Text(wire);
                if (d == Dialect.Snowflake && t.Kind == TypeKind.Json && typeText.StartsWith("VARIANT", StringComparison.OrdinalIgnoreCase))
                    return "PARSE_JSON(" + Str(d, text) + ")";
                return Str(d, text);
            }
        }
    }

    private static string Text(object wire) => wire switch
    {
        string s => s,
        bool b => b ? "true" : "false",
        double dd => dd.ToString("R", Inv),
        float f => f.ToString("R", Inv),
        BinaryValue bv => Convert.ToBase64String(bv.Full),
        IFormattable f => f.ToString(null, Inv),
        _ => wire.ToString() ?? "",
    };

    public static string Bool(Dialect d, bool v, string typeText = "") => d switch
    {
        Dialect.PgSql or Dialect.Snowflake => v ? "TRUE" : "FALSE",
        Dialect.ClickHouse or Dialect.Cql => v ? "true" : "false",
        Dialect.PlSql when typeText.Equals("BOOLEAN", StringComparison.OrdinalIgnoreCase) => v ? "TRUE" : "FALSE",
        _ => v ? "1" : "0",
    };

    private static string Number(Dialect d, object wire)
    {
        switch (wire)
        {
            case bool b: return b ? "1" : "0";
            case double dd: return double.IsFinite(dd) ? dd.ToString("R", Inv) : "NULL";
            case float f: return float.IsFinite(f) ? f.ToString("R", Inv) : "NULL";
            case string s:
            {
                var v = s.Trim();
                if (NumberRegex().IsMatch(v)) return v.StartsWith('+') ? v[1..] : v;
                if (v.Equals("true", StringComparison.OrdinalIgnoreCase)) return "1";
                if (v.Equals("false", StringComparison.OrdinalIgnoreCase)) return "0";
                return Str(d, s);
            }
            default: return Convert.ToString(wire, Inv) ?? "NULL";
        }
    }

    private static string Float(Dialect d, object wire)
    {
        if (wire is string s)
        {
            switch (s)
            {
                case "NaN": return d == Dialect.PgSql ? "'NaN'" : d == Dialect.ClickHouse ? "nan" : "NULL";
                case "Infinity": return d == Dialect.PgSql ? "'Infinity'" : d == Dialect.ClickHouse ? "inf" : "NULL";
                case "-Infinity": return d == Dialect.PgSql ? "'-Infinity'" : d == Dialect.ClickHouse ? "-inf" : "NULL";
            }
        }
        return Number(d, wire);
    }

    /// <summary>Quoted string literal of the dialect.</summary>
    public static string Str(Dialect d, string s)
    {
        switch (d)
        {
            case Dialect.TSql:
                return "N'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";
            case Dialect.MySql or Dialect.ClickHouse or Dialect.Snowflake:
            {
                var e = s.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("'", "''", StringComparison.Ordinal);
                if (d == Dialect.MySql || d == Dialect.ClickHouse) e = e.Replace("\0", "\\0", StringComparison.Ordinal);
                return "'" + e + "'";
            }
            case Dialect.PgSql:
                return "'" + s.Replace("\0", "", StringComparison.Ordinal).Replace("'", "''", StringComparison.Ordinal) + "'";
            case Dialect.PlSql when s.Length > 2000:
            {
                var parts = new List<string>();
                for (var i = 0; i < s.Length; i += 2000)
                    parts.Add("TO_CLOB('" + s.Substring(i, Math.Min(2000, s.Length - i)).Replace("'", "''", StringComparison.Ordinal) + "')");
                return string.Join(" || ", parts);
            }
            default:
                return "'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";
        }
    }

    public static string Binary(Dialect d, byte[] bytes)
    {
        var hex = Convert.ToHexString(bytes);
        switch (d)
        {
            case Dialect.TSql: return "0x" + hex;
            case Dialect.Cql: return "0x" + hex;
            case Dialect.MySql: return "X'" + hex + "'";
            case Dialect.Sqlite: return "X'" + hex + "'";
            case Dialect.PgSql: return "'\\x" + hex + "'";
            case Dialect.ClickHouse: return "unhex('" + hex + "')";
            case Dialect.Snowflake: return "TO_BINARY('" + hex + "', 'HEX')";
            case Dialect.PlSql:
                if (bytes.Length == 0) return "NULL";
                if (hex.Length <= 4000) return "HEXTORAW('" + hex + "')";
                var parts = new List<string>();
                for (var i = 0; i < hex.Length; i += 4000) parts.Add("TO_BLOB(HEXTORAW('" + hex.Substring(i, Math.Min(4000, hex.Length - i)) + "'))");
                return string.Join(" || ", parts);
            default: return "X'" + hex + "'";
        }
    }

    private static string Fraction(string? frac, int digits)
    {
        if (digits <= 0 || string.IsNullOrEmpty(frac)) return "";
        var f = frac.TrimStart('.');
        if (f.Length > digits) f = f[..digits];
        f = f.TrimEnd('0');
        return f.Length == 0 ? "" : "." + f;
    }

    /// <summary>Converts an ISO wire value (see ValueConverter) to the literal of a temporal column.</summary>
    private static string Temporal(Dialect d, CanonType t, string s, string typeText)
    {
        var v = s.Trim();
        string? date = null, time = null, frac = null, off = null;
        var m = DateTimeRegex().Match(v);
        if (m.Success)
        {
            date = m.Groups["date"].Value;
            if (m.Groups["time"].Success) time = m.Groups["time"].Value;
            if (m.Groups["frac"].Success) frac = m.Groups["frac"].Value;
            if (m.Groups["off"].Success) off = m.Groups["off"].Value;
        }
        else
        {
            var tm = TimeRegex().Match(v);
            if (!tm.Success) return Str(d, s); // let the server report it
            time = tm.Groups["time"].Value;
            if (tm.Groups["frac"].Success) frac = tm.Groups["frac"].Value;
        }

        var maxDigits = d switch
        {
            Dialect.TSql => typeText.StartsWith("datetime(", StringComparison.OrdinalIgnoreCase) || typeText.Equals("datetime", StringComparison.OrdinalIgnoreCase) ? 3
                : typeText.Equals("smalldatetime", StringComparison.OrdinalIgnoreCase) ? 0 : 7,
            Dialect.PgSql or Dialect.MySql => 6,
            Dialect.Cql => 3,
            Dialect.PlSql => 9,
            _ => 9,
        };
        var digits = Math.Min(t.Precision ?? maxDigits, maxDigits);

        // Offsets: keep for timestamptz columns, otherwise convert to UTC so the wall clock is the instant.
        string? offset = null;
        if (off is not null)
        {
            var norm = off == "Z" ? "+00:00" : off.Contains(':') ? off : off.Length == 3 ? off + ":00" : off[..3] + ":" + off[3..];
            if (t.Kind == TypeKind.DateTimeTz) offset = norm;
            else if (date is not null && time is not null && norm != "+00:00")
            {
                if (DateTimeOffset.TryParse($"{date}T{time}{frac}{norm}", Inv, DateTimeStyles.RoundtripKind, out var dto))
                {
                    var utc = dto.UtcDateTime;
                    date = utc.ToString("yyyy-MM-dd", Inv);
                    time = utc.ToString("HH:mm:ss", Inv);
                    frac = utc.ToString("FFFFFFF", Inv) is { Length: > 0 } ff ? "." + ff : null;
                }
            }
        }
        else if (t.Kind == TypeKind.DateTimeTz) offset = "+00:00";

        switch (t.Kind)
        {
            case TypeKind.Date:
                return date is null ? Str(d, s) : d == Dialect.PlSql ? $"DATE '{date}'" : $"'{date}'";
            case TypeKind.Time:
            {
                if (time is null) return Str(d, s);
                return $"'{time}{Fraction(frac, digits)}'";
            }
            default:
            {
                if (date is null) return Str(d, s);
                var t0 = time ?? "00:00:00";
                var fr = Fraction(frac, digits);
                switch (d)
                {
                    case Dialect.TSql:
                        return $"'{date}T{t0}{fr}{offset}'";
                    case Dialect.PlSql:
                        return offset is not null ? $"TIMESTAMP '{date} {t0}{fr} {offset}'" : $"TIMESTAMP '{date} {t0}{fr}'";
                    case Dialect.Cql:
                        return $"'{date}T{t0}{fr}{(offset is null ? "" : offset.Replace(":", "", StringComparison.Ordinal))}'";
                    case Dialect.ClickHouse:
                        if (offset is not null && offset != "+00:00" && DateTimeOffset.TryParse($"{date}T{t0}{frac}{offset}", Inv, DateTimeStyles.RoundtripKind, out var cd))
                        {
                            var u = cd.UtcDateTime;
                            return $"'{u:yyyy-MM-dd HH:mm:ss}{Fraction("." + u.ToString("FFFFFFF", Inv), digits)}'";
                        }
                        return $"'{date} {t0}{fr}'";
                    default:
                        return $"'{date} {t0}{fr}{offset}'";
                }
            }
        }
    }

    // ------------------------------------------------------------------ statements

    /// <summary>Largest row count of one multi-row INSERT the dialect accepts.</summary>
    public static int MaxRowsPerInsert(Dialect d) => d switch
    {
        Dialect.TSql => 1000,
        Dialect.PlSql => 500,
        Dialect.Cql => 100,
        _ => 5000,
    };

    /// <summary>
    /// INSERT (or upsert) statements for <paramref name="rows"/>; usually one statement, one per row for CQL. The text is a
    /// complete batch in the dialect (SQL Server wraps it in IDENTITY_INSERT ON / OFF).
    /// </summary>
    public static List<string> BuildInsert(Dialect d, string qualifiedTable, IReadOnlyList<TargetColumn> cols, IReadOnlyList<object?[]> rows, InsertMode mode)
    {
        var colList = string.Join(", ", cols.Select(c => Quote(d, c.Name)));
        var keys = cols.Where(c => c.IsKey).ToList();
        string Row(object?[] row) => "(" + string.Join(", ", cols.Select((c, i) => Literal(d, row[i], c.Type, c.TypeText))) + ")";
        var values = rows.Select(Row).ToList();
        var upsert = mode.Upsert && keys.Count > 0;
        var statements = new List<string>();

        switch (d)
        {
            case Dialect.Cql:
                foreach (var r in values) statements.Add($"INSERT INTO {qualifiedTable} ({colList}) VALUES {r}");
                return statements;
            case Dialect.PlSql when !upsert:
            {
                var sb = new StringBuilder("INSERT ALL");
                foreach (var r in values) sb.Append("\n  INTO ").Append(qualifiedTable).Append(" (").Append(colList).Append(") VALUES ").Append(r);
                sb.Append("\nSELECT 1 FROM DUAL");
                statements.Add(sb.ToString());
                return statements;
            }
            case Dialect.Snowflake:
            {
                var selects = rows.Select(row => "SELECT " + string.Join(", ", cols.Select((c, i) => Literal(d, row[i], c.Type, c.TypeText))));
                statements.Add($"INSERT INTO {qualifiedTable} ({colList})\n{string.Join("\nUNION ALL\n", selects)}");
                return statements;
            }
            case Dialect.TSql when upsert:
            case Dialect.PlSql when upsert:
                statements.Add(Merge(d, qualifiedTable, cols, keys, rows, mode));
                return statements.Select(s => WrapIdentity(d, qualifiedTable, s, mode)).ToList();
        }

        var overriding = d == Dialect.PgSql && mode.IdentityInsert ? " OVERRIDING SYSTEM VALUE" : "";
        var insert = new StringBuilder($"INSERT INTO {qualifiedTable} ({colList}){overriding} VALUES\n  ").Append(string.Join(",\n  ", values));
        if (upsert)
        {
            var nonKeys = cols.Where(c => !c.IsKey).ToList();
            switch (d)
            {
                case Dialect.PgSql or Dialect.Sqlite:
                {
                    var target = string.Join(", ", keys.Select(k => Quote(d, k.Name)));
                    insert.Append("\nON CONFLICT (").Append(target).Append(')');
                    insert.Append(nonKeys.Count == 0 ? " DO NOTHING" : " DO UPDATE SET " + string.Join(", ", nonKeys.Select(c =>
                        $"{Quote(d, c.Name)} = {(d == Dialect.PgSql ? "EXCLUDED" : "excluded")}.{Quote(d, c.Name)}")));
                    break;
                }
                case Dialect.MySql:
                    insert.Append("\nON DUPLICATE KEY UPDATE ").Append(string.Join(", ", (nonKeys.Count == 0 ? keys.Take(1) : nonKeys)
                        .Select(c => $"{Quote(d, c.Name)} = VALUES({Quote(d, c.Name)})")));
                    break;
            }
        }
        return [WrapIdentity(d, qualifiedTable, insert.ToString(), mode)];
    }

    private static string WrapIdentity(Dialect d, string table, string sql, InsertMode mode) =>
        d == Dialect.TSql && mode.IdentityInsert ? $"SET IDENTITY_INSERT {table} ON;\n{sql};\nSET IDENTITY_INSERT {table} OFF;" : sql;

    private static string Merge(Dialect d, string table, IReadOnlyList<TargetColumn> cols, List<TargetColumn> keys, IReadOnlyList<object?[]> rows, InsertMode mode)
    {
        var q = (string n) => Quote(d, n);
        var colList = string.Join(", ", cols.Select(c => q(c.Name)));
        var on = string.Join(" AND ", keys.Select(k => $"tgt.{q(k.Name)} = src.{q(k.Name)}"));
        var nonKeys = cols.Where(c => !c.IsKey).ToList();
        var update = nonKeys.Count == 0 ? "" : $"\nWHEN MATCHED THEN UPDATE SET {string.Join(", ", nonKeys.Select(c => $"tgt.{q(c.Name)} = src.{q(c.Name)}"))}";
        var insert = $"\nWHEN NOT MATCHED THEN INSERT ({colList}) VALUES ({string.Join(", ", cols.Select(c => "src." + q(c.Name)))})";
        string source;
        if (d == Dialect.TSql)
        {
            var vals = rows.Select(row => "(" + string.Join(", ", cols.Select((c, i) => Literal(d, row[i], c.Type, c.TypeText))) + ")");
            source = $"(VALUES\n  {string.Join(",\n  ", vals)}) AS src ({colList})";
            return $"MERGE INTO {table} AS tgt USING {source} ON {on}{update}{insert};";
        }
        var selects = rows.Select(row => "SELECT " + string.Join(", ", cols.Select((c, i) => Literal(d, row[i], c.Type, c.TypeText) + " AS " + q(c.Name))) + " FROM DUAL");
        source = $"(\n{string.Join("\nUNION ALL\n", selects)}\n) src";
        return $"MERGE INTO {table} tgt USING {source} ON ({on}){update}{insert}";
    }

    public static string Truncate(Dialect d, string table) => d switch
    {
        Dialect.Sqlite => $"DELETE FROM {table}",
        Dialect.Cql => $"TRUNCATE {table}",
        _ => $"TRUNCATE TABLE {table}",
    };

    /// <summary>Fallback when TRUNCATE is refused (foreign keys reference the table).</summary>
    public static string DeleteAll(string table) => $"DELETE FROM {table}";

    public static string DropTable(Dialect d, string table) => d switch
    {
        Dialect.PlSql => $"DROP TABLE {table} PURGE",
        _ => $"DROP TABLE {table}",
    };

    /// <summary>Idempotent CREATE SCHEMA, or null when the dialect has nothing to create (or cannot).</summary>
    public static string? CreateSchema(Dialect d, string schema) => d switch
    {
        Dialect.TSql => $"IF SCHEMA_ID(N'{schema.Replace("'", "''", StringComparison.Ordinal)}') IS NULL EXEC(N'CREATE SCHEMA {Quote(d, schema).Replace("'", "''", StringComparison.Ordinal)}')",
        Dialect.PgSql or Dialect.Snowflake => $"CREATE SCHEMA IF NOT EXISTS {Quote(d, schema)}",
        Dialect.MySql or Dialect.ClickHouse => $"CREATE DATABASE IF NOT EXISTS {Quote(d, schema)}",
        _ => null,
    };

    /// <summary>Statement that moves an identity sequence past the copied values (PostgreSQL), else null.</summary>
    public static string? ResetIdentity(Dialect d, string? schema, string table, string column)
    {
        if (d != Dialect.PgSql) return null;
        var qt = Qualified(d, schema, table);
        var qc = Quote(d, column);
        var seqArg = (qt.Replace("'", "''", StringComparison.Ordinal));
        var colArg = column.Replace("'", "''", StringComparison.Ordinal);
        return $"SELECT setval(pg_get_serial_sequence('{seqArg}', '{colArg}'), COALESCE((SELECT MAX({qc}) FROM {qt}), 1), (SELECT MAX({qc}) IS NOT NULL FROM {qt}))";
    }

    /// <summary>
    /// The column list of the SELECT that reads a source table: columns of kinds the wire cannot carry faithfully are cast to text.
    /// </summary>
    public static string SelectColumn(Dialect d, string column, CanonType type, string sourceTypeText)
    {
        var q = Quote(d, column);
        var raw = TypeMapper.Split(sourceTypeText).Base;
        switch (d)
        {
            case Dialect.TSql:
                if (raw is "geography" or "geometry" or "hierarchyid" or "sql_variant") return $"CAST({q} AS nvarchar(max)) AS {q}";
                break;
            case Dialect.PgSql:
                // arrays, ranges, enums, geometric / network types, bit strings, intervals: the text form is the portable one
                if (type.Kind is TypeKind.Other or TypeKind.Enum or TypeKind.Interval) return $"{q}::text AS {q}";
                break;
            case Dialect.MySql:
                if (raw is "geometry" or "point" or "linestring" or "polygon" or "multipoint" or "multilinestring" or "multipolygon" or "geometrycollection")
                    return $"ST_AsText({q}) AS {q}";
                break;
        }
        return q;
    }
}
