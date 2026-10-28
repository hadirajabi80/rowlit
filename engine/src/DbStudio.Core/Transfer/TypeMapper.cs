using System.Globalization;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;

namespace DbStudio.Core.Transfer;

/// <summary>Dialect-independent category of a column type. Values travel as text/number/bool/binary wire values.</summary>
public enum TypeKind
{
    Boolean, Int, Float, Decimal, Char, VarChar, Text, Binary, VarBinary, Blob, Date, Time, DateTime, DateTimeTz, Interval, Guid, Json, Xml,
    /// <summary>enum / set: copied as text.</summary>
    Enum,
    /// <summary>geometry, geography, hierarchyid, arrays, ranges …: read as text, written as text.</summary>
    Other,
}

/// <summary>
/// A column type in canonical form. <see cref="Length"/>: characters for text, bytes for binary; -1 = unbounded ("max"), null = unspecified.
/// </summary>
/// <param name="Bits">Integers (8, 16, 32, 64) and floats (32, 64).</param>
/// <param name="Unicode">true = national (nvarchar), false = byte strings, null = unknown.</param>
/// <param name="Binary">json: stored decoded (jsonb).</param>
public sealed record CanonType(TypeKind Kind, int? Length = null, int? Precision = null, int? Scale = null, int Bits = 32, bool Unsigned = false,
    bool? Unicode = null, bool Binary = false, string? Note = null)
{
    public bool IsUnbounded => Length is null or < 0;

    /// <summary>Text-ish kinds (also Json, Xml, Enum and Other, which are carried as text).</summary>
    public bool IsText => Kind is TypeKind.Char or TypeKind.VarChar or TypeKind.Text or TypeKind.Json or TypeKind.Xml or TypeKind.Enum or TypeKind.Other
        or TypeKind.Interval;
}

/// <summary>Result of mapping one column type.</summary>
public sealed record MappedType(string Text, string? Note);

/// <summary>
/// Cross-dialect column type mapper (Data Transfer). <see cref="Parse"/> reads a type text of any supported dialect into a
/// <see cref="CanonType"/>, <see cref="Render"/> writes it for a target dialect; <see cref="Map"/> does both and keeps the
/// source type when the dialects match and the target knows the type. Pure and thread-safe.
/// </summary>
public static partial class TypeMapper
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // ------------------------------------------------------------------ public entry

    /// <summary>
    /// Maps <paramref name="sourceType"/> for the target. <paramref name="targetKnownTypes"/> (lower-case base names of the
    /// target scripter's type list) enables the same-dialect passthrough; <paramref name="isKey"/> turns unbounded text into a
    /// bounded type where the target cannot index it.
    /// </summary>
    public static MappedType Map(Dialect sourceDialect, string sourceType, Dialect targetDialect, bool isKey = false,
        IReadOnlySet<string>? targetKnownTypes = null)
    {
        if (string.IsNullOrWhiteSpace(sourceType)) return new MappedType(TextType(targetDialect, null, false), "unknown source type, copied as text");
        if (sourceDialect == targetDialect && targetKnownTypes is not null && IsPassthrough(sourceDialect, sourceType, targetKnownTypes, isKey))
            return new MappedType(sourceType.Trim(), null);
        return Render(Parse(sourceDialect, sourceType), targetDialect, isKey);
    }

    private static bool IsPassthrough(Dialect dialect, string type, IReadOnlySet<string> known, bool isKey)
    {
        var (b, args) = Split(type);
        if (!known.Contains(b)) return false;
        // Types a copy cannot carry as they are: rowversion (not insertable), serial pseudo types, unbounded text as a key.
        if (b is "rowversion" or "timestamp" && dialect == Dialect.TSql) return false;
        if (b is "serial" or "bigserial" or "smallserial") return false;
        if (isKey && args.Count == 0 && b is "text" or "ntext" or "longtext" or "mediumtext" or "clob" or "nclob" or "blob" or "longblob" or "image") return false;
        if (isKey && dialect == Dialect.TSql && args.Count == 1 && args[0] == "max") return false;
        if (dialect == Dialect.Sqlite && b == "any") return false;
        return true;
    }

    // ------------------------------------------------------------------ parsing

    /// <summary>Splits "numeric(12,2)" / "timestamp(6) with time zone" into (lower-case base, args).</summary>
    public static (string Base, List<string> Args) Split(string type)
    {
        var t = Regex.Replace(type.Trim(), @"\s+", " ");
        var open = t.IndexOf('(');
        if (open < 0) return (t.ToLowerInvariant(), []);
        var depth = 0;
        var close = -1;
        for (var i = open; i < t.Length; i++)
        {
            if (t[i] == '(') depth++;
            else if (t[i] == ')' && --depth == 0) { close = i; break; }
        }
        if (close < 0) return (t[..open].Trim().ToLowerInvariant(), []);
        var inner = t[(open + 1)..close];
        var args = SplitArgs(inner);
        var b = (t[..open] + " " + t[(close + 1)..]).Trim();
        return (Regex.Replace(b, @"\s+", " ").ToLowerInvariant(), args);
    }

    private static List<string> SplitArgs(string inner)
    {
        var args = new List<string>();
        var depth = 0;
        var quote = false;
        var start = 0;
        for (var i = 0; i < inner.Length; i++)
        {
            var c = inner[i];
            if (c == '\'') quote = !quote;
            else if (!quote && c == '(') depth++;
            else if (!quote && c == ')') depth--;
            else if (!quote && depth == 0 && c == ',')
            {
                args.Add(inner[start..i].Trim().ToLowerInvariant());
                start = i + 1;
            }
        }
        args.Add(inner[start..].Trim().ToLowerInvariant());
        return args.Where(a => a.Length > 0).ToList();
    }

    private static int? Num(IReadOnlyList<string> args, int i) =>
        i < args.Count && int.TryParse(args[i], NumberStyles.Integer, Inv, out var v) ? v : null;

    /// <summary>Length argument: a number, or -1 for "max".</summary>
    private static int? LengthArg(IReadOnlyList<string> args) =>
        args.Count == 0 ? null : args[0] == "max" ? -1 : Num(args, 0);

    public static CanonType Parse(Dialect dialect, string type)
    {
        var raw = type.Trim();
        var (b, args) = Split(raw);
        if (b.EndsWith("[]", StringComparison.Ordinal) || b.StartsWith("array", StringComparison.Ordinal) && dialect != Dialect.ClickHouse && dialect != Dialect.Snowflake)
            return new CanonType(TypeKind.Other, Note: "array copied as text");
        var unsigned = false;
        if (b.EndsWith(" unsigned zerofill", StringComparison.Ordinal)) { b = b[..^" unsigned zerofill".Length]; unsigned = true; }
        else if (b.EndsWith(" unsigned", StringComparison.Ordinal)) { b = b[..^" unsigned".Length]; unsigned = true; }
        else if (b.EndsWith(" zerofill", StringComparison.Ordinal)) b = b[..^" zerofill".Length];
        if (b.StartsWith("nullable", StringComparison.Ordinal) || b.StartsWith("lowcardinality", StringComparison.Ordinal))
            return args.Count == 1 ? Parse(dialect, args[0]) : new CanonType(TypeKind.Other);

        return dialect switch
        {
            Dialect.TSql => ParseTSql(b, args),
            Dialect.PgSql => ParsePg(b, args),
            Dialect.MySql => ParseMySql(b, args, unsigned),
            Dialect.Sqlite => ParseSqlite(b, args),
            Dialect.PlSql => ParseOracle(b, args),
            Dialect.ClickHouse => ParseClickHouse(raw, b, args),
            Dialect.Snowflake => ParseSnowflake(b, args),
            Dialect.Cql => ParseCql(raw, b),
            _ => Generic(b, args),
        };
    }

    private static CanonType IntType(int bits, bool unsigned = false) => new(TypeKind.Int, Bits: bits, Unsigned: unsigned);

    private static CanonType Dec(int? p, int? s) => new(TypeKind.Decimal, Precision: p, Scale: s);

    private static CanonType Str(int? len, bool? unicode, bool fixedLen = false) =>
        new(fixedLen ? TypeKind.Char : len == -1 ? TypeKind.Text : TypeKind.VarChar, len, Unicode: unicode);

    /// <summary>Shared fallback for dialect-neutral names.</summary>
    private static CanonType Generic(string b, List<string> args)
    {
        switch (b)
        {
            case "smallint" or "int2": return IntType(16);
            case "int" or "integer" or "int4": return IntType(32);
            case "bigint" or "int8": return IntType(64);
            case "tinyint": return IntType(8);
            case "bool" or "boolean" or "bit": return new CanonType(TypeKind.Boolean);
            case "real" or "float4": return new CanonType(TypeKind.Float, Bits: 32);
            case "double" or "double precision" or "float8" or "float": return new CanonType(TypeKind.Float, Bits: 64);
            case "decimal" or "numeric" or "dec" or "number": return Dec(Num(args, 0), Num(args, 1));
            case "char" or "character" or "nchar": return Str(Num(args, 0) ?? 1, b == "nchar" ? true : null, true);
            case "varchar" or "character varying" or "nvarchar" or "string": return Str(LengthArg(args) ?? -1, b == "nvarchar" ? true : null);
            case "text" or "clob" or "longtext" or "mediumtext": return new CanonType(TypeKind.Text, -1);
            case "date": return new CanonType(TypeKind.Date);
            case "time": return new CanonType(TypeKind.Time, Precision: Num(args, 0));
            case "datetime" or "timestamp": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0));
            case "blob" or "bytea" or "longblob": return new CanonType(TypeKind.Blob, -1);
            case "uuid" or "uniqueidentifier": return new CanonType(TypeKind.Guid);
            case "json" or "jsonb": return new CanonType(TypeKind.Json, Binary: b == "jsonb");
            case "xml": return new CanonType(TypeKind.Xml);
            default: return new CanonType(TypeKind.Other, Note: $"type '{b}' copied as text");
        }
    }

    private static CanonType ParseTSql(string b, List<string> args)
    {
        switch (b)
        {
            case "tinyint": return IntType(8, true);
            case "bit": return new CanonType(TypeKind.Boolean);
            case "money": return new CanonType(TypeKind.Decimal, Precision: 19, Scale: 4);
            case "smallmoney": return new CanonType(TypeKind.Decimal, Precision: 10, Scale: 4);
            case "float":
            {
                var n = Num(args, 0) ?? 53;
                return new CanonType(TypeKind.Float, Bits: n <= 24 ? 32 : 64);
            }
            case "real": return new CanonType(TypeKind.Float, Bits: 32);
            case "decimal" or "numeric": return Dec(Num(args, 0) ?? 18, Num(args, 1) ?? 0);
            case "char": return Str(Num(args, 0) ?? 1, false, true);
            case "nchar": return Str(Num(args, 0) ?? 1, true, true);
            case "varchar": return Str(LengthArg(args) ?? 1, false);
            case "nvarchar": return Str(LengthArg(args) ?? 1, true);
            case "text": return new CanonType(TypeKind.Text, -1, Unicode: false);
            case "ntext": return new CanonType(TypeKind.Text, -1, Unicode: true);
            case "binary": return new CanonType(TypeKind.Binary, Num(args, 0) ?? 1);
            case "varbinary": return new CanonType(LengthArg(args) == -1 ? TypeKind.Blob : TypeKind.VarBinary, LengthArg(args) ?? 1);
            case "image": return new CanonType(TypeKind.Blob, -1);
            case "rowversion" or "timestamp": return new CanonType(TypeKind.Binary, 8, Note: "rowversion copied as binary(8)");
            case "date": return new CanonType(TypeKind.Date);
            case "time": return new CanonType(TypeKind.Time, Precision: Num(args, 0) ?? 7);
            case "datetime": return new CanonType(TypeKind.DateTime, Precision: 3);
            case "smalldatetime": return new CanonType(TypeKind.DateTime, Precision: 0);
            case "datetime2": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 7);
            case "datetimeoffset": return new CanonType(TypeKind.DateTimeTz, Precision: Num(args, 0) ?? 7);
            case "uniqueidentifier": return new CanonType(TypeKind.Guid);
            case "xml": return new CanonType(TypeKind.Xml);
            case "geography" or "geometry" or "hierarchyid" or "sql_variant": return new CanonType(TypeKind.Other, Note: $"{b} copied as text");
            case "sysname": return Str(128, true);
            default: return Generic(b, args);
        }
    }

    private static CanonType ParsePg(string b, List<string> args)
    {
        switch (b)
        {
            case "serial" or "serial4": return IntType(32);
            case "bigserial" or "serial8": return IntType(64);
            case "smallserial" or "serial2": return IntType(16);
            case "numeric" or "decimal": return Dec(Num(args, 0), Num(args, 1) ?? (args.Count > 0 ? 0 : null));
            case "money": return new CanonType(TypeKind.Decimal, Precision: 19, Scale: 2);
            case "float" when (Num(args, 0) ?? 53) <= 24: return new CanonType(TypeKind.Float, Bits: 32);
            case "bpchar" or "character" or "char": return Str(Num(args, 0) ?? 1, null, true);
            case "character varying" or "varchar": return args.Count == 0 ? new CanonType(TypeKind.Text, -1) : Str(Num(args, 0), null);
            case "citext" or "name" or "text": return new CanonType(TypeKind.Text, -1);
            case "bytea": return new CanonType(TypeKind.Blob, -1);
            case "date": return new CanonType(TypeKind.Date);
            case "time" or "time without time zone": return new CanonType(TypeKind.Time, Precision: Num(args, 0) ?? 6);
            case "time with time zone" or "timetz": return new CanonType(TypeKind.Time, Precision: Num(args, 0) ?? 6, Note: "time zone dropped");
            case "timestamp" or "timestamp without time zone": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 6);
            case "timestamp with time zone" or "timestamptz": return new CanonType(TypeKind.DateTimeTz, Precision: Num(args, 0) ?? 6);
            case "interval": return new CanonType(TypeKind.Interval);
            case "uuid": return new CanonType(TypeKind.Guid);
            case "json": return new CanonType(TypeKind.Json);
            case "jsonb": return new CanonType(TypeKind.Json, Binary: true);
            case "xml": return new CanonType(TypeKind.Xml);
            case "boolean" or "bool": return new CanonType(TypeKind.Boolean);
            case "inet" or "cidr": return Str(43, false);
            case "macaddr" or "macaddr8": return Str(23, false);
            case "bit" or "bit varying" or "varbit": return new CanonType(TypeKind.Other, Note: "bit string copied as text");
            default:
                // user defined types (enums, domains) arrive schema-qualified or as USER-DEFINED
                if (b == "user-defined" || b.Contains('.', StringComparison.Ordinal))
                    return new CanonType(TypeKind.Enum, Note: "user-defined type copied as text");
                var g = Generic(b, args);
                return g.Kind == TypeKind.Other ? g with { Note = $"{b} copied as text" } : g;
        }
    }

    private static CanonType ParseMySql(string b, List<string> args, bool unsigned)
    {
        switch (b)
        {
            case "tinyint": return args.Count == 1 && args[0] == "1" && !unsigned ? new CanonType(TypeKind.Boolean) : IntType(8, unsigned);
            case "smallint": return IntType(16, unsigned);
            case "mediumint": return IntType(32);
            case "int" or "integer": return IntType(32, unsigned);
            case "bigint": return IntType(64, unsigned);
            case "year": return IntType(16);
            case "bool" or "boolean": return new CanonType(TypeKind.Boolean);
            case "bit": return Num(args, 0) is null or 1 ? new CanonType(TypeKind.Boolean) : IntType(64, true);
            case "float": return new CanonType(TypeKind.Float, Bits: 32);
            case "double" or "double precision" or "real": return new CanonType(TypeKind.Float, Bits: 64);
            case "decimal" or "numeric" or "dec" or "fixed": return Dec(Num(args, 0) ?? 10, Num(args, 1) ?? 0);
            case "char": return Str(Num(args, 0) ?? 1, null, true);
            case "varchar": return Str(Num(args, 0) ?? 255, null);
            case "tinytext": return new CanonType(TypeKind.VarChar, 255);
            case "text": return new CanonType(TypeKind.VarChar, 65535);
            case "mediumtext": return new CanonType(TypeKind.Text, 16777215);
            case "longtext": return new CanonType(TypeKind.Text, -1);
            case "enum" or "set": return new CanonType(TypeKind.Enum);
            case "json": return new CanonType(TypeKind.Json);
            case "datetime": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 0);
            case "timestamp": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 0);
            case "time": return new CanonType(TypeKind.Time, Precision: Num(args, 0) ?? 0);
            case "date": return new CanonType(TypeKind.Date);
            case "binary": return new CanonType(TypeKind.Binary, Num(args, 0) ?? 1);
            case "varbinary": return new CanonType(TypeKind.VarBinary, Num(args, 0) ?? 255);
            case "tinyblob": return new CanonType(TypeKind.VarBinary, 255);
            case "blob": return new CanonType(TypeKind.VarBinary, 65535);
            case "mediumblob" or "longblob": return new CanonType(TypeKind.Blob, -1);
            case "uuid": return new CanonType(TypeKind.Guid);
            case "geometry" or "point" or "linestring" or "polygon" or "multipoint" or "multilinestring" or "multipolygon" or "geometrycollection":
                return new CanonType(TypeKind.Other, Note: $"{b} copied as WKT text");
            default: return Generic(b, args);
        }
    }

    private static CanonType ParseSqlite(string b, List<string> args)
    {
        if (b.Length == 0 || b == "any") return new CanonType(TypeKind.Other);
        // exact common names first, then the affinity rules of sqlite.org/datatype3.html
        if (b == "boolean" || b == "bool") return new CanonType(TypeKind.Boolean);
        if (b is "datetime" or "timestamp") return new CanonType(TypeKind.DateTime, Precision: 6);
        if (b == "date") return new CanonType(TypeKind.Date);
        if (b == "time") return new CanonType(TypeKind.Time, Precision: 6);
        if (b is "decimal" or "numeric") return Dec(Num(args, 0), Num(args, 1) ?? (args.Count > 0 ? 0 : null));
        if (b == "json") return new CanonType(TypeKind.Json);
        if (b.Contains("int", StringComparison.Ordinal))
            return b is "tinyint" ? IntType(8) : b is "smallint" or "int2" ? IntType(16) : b is "int" or "mediumint" or "int4" ? IntType(32) : IntType(64);
        if (b.Contains("char", StringComparison.Ordinal) || b.Contains("clob", StringComparison.Ordinal) || b.Contains("text", StringComparison.Ordinal))
        {
            var n = Num(args, 0);
            return n is null ? new CanonType(TypeKind.Text, -1) : Str(n, null, b.StartsWith("char", StringComparison.Ordinal) || b == "character");
        }
        if (b.Contains("blob", StringComparison.Ordinal)) return new CanonType(TypeKind.Blob, -1);
        if (b.Contains("real", StringComparison.Ordinal) || b.Contains("floa", StringComparison.Ordinal) || b.Contains("doub", StringComparison.Ordinal))
            return new CanonType(TypeKind.Float, Bits: 64);
        return Dec(null, null);
    }

    private static CanonType ParseOracle(string b, List<string> args)
    {
        switch (b)
        {
            case "number":
            {
                var p = Num(args, 0);
                var s = Num(args, 1);
                if (args.Count > 0 && args[0] == "*") p = 38;
                if (p is null) return Dec(null, null);
                if ((s ?? 0) == 0 && args.Count <= 1 || s == 0)
                    return p <= 4 ? IntType(16) : p <= 9 ? IntType(32) : p <= 18 ? IntType(64) : Dec(p, 0);
                return Dec(p, s ?? 0);
            }
            case "integer" or "int" or "smallint": return IntType(64);
            case "float": return new CanonType(TypeKind.Float, Bits: (Num(args, 0) ?? 126) <= 63 ? 32 : 64);
            case "binary_float": return new CanonType(TypeKind.Float, Bits: 32);
            case "binary_double": return new CanonType(TypeKind.Float, Bits: 64);
            case "varchar2" or "varchar": return Str(StripUnit(args), false);
            case "nvarchar2": return Str(StripUnit(args), true);
            case "char": return Str(StripUnit(args) ?? 1, false, true);
            case "nchar": return Str(StripUnit(args) ?? 1, true, true);
            case "clob" or "long": return new CanonType(TypeKind.Text, -1, Unicode: false);
            case "nclob": return new CanonType(TypeKind.Text, -1, Unicode: true);
            case "date": return new CanonType(TypeKind.DateTime, Precision: 0);
            case "timestamp": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 6);
            case "timestamp with time zone": return new CanonType(TypeKind.DateTimeTz, Precision: Num(args, 0) ?? 6);
            case "timestamp with local time zone": return new CanonType(TypeKind.DateTimeTz, Precision: Num(args, 0) ?? 6);
            case "raw": return new CanonType(TypeKind.VarBinary, Num(args, 0) ?? 16);
            case "blob" or "long raw" or "bfile": return new CanonType(TypeKind.Blob, -1);
            case "rowid" or "urowid": return Str(18, false);
            case "xmltype": return new CanonType(TypeKind.Xml);
            case "json": return new CanonType(TypeKind.Json);
            case "boolean": return new CanonType(TypeKind.Boolean);
            default:
                if (b.StartsWith("interval", StringComparison.Ordinal)) return new CanonType(TypeKind.Interval);
                return Generic(b, args);
        }
    }

    private static int? StripUnit(List<string> args)
    {
        if (args.Count == 0) return null;
        var a = args[0].Replace(" char", "", StringComparison.Ordinal).Replace(" byte", "", StringComparison.Ordinal).Trim();
        return int.TryParse(a, NumberStyles.Integer, Inv, out var v) ? v : null;
    }

    private static CanonType ParseClickHouse(string raw, string b, List<string> args)
    {
        var m = Regex.Match(b, @"^(u?int)(8|16|32|64|128|256)$");
        if (m.Success)
        {
            var bits = int.Parse(m.Groups[2].Value, Inv);
            return bits > 64 ? Dec(bits == 128 ? 38 : 76, 0) : IntType(bits, m.Groups[1].Value == "uint");
        }
        switch (b)
        {
            case "float32": return new CanonType(TypeKind.Float, Bits: 32);
            case "float64": return new CanonType(TypeKind.Float, Bits: 64);
            case "bool": return new CanonType(TypeKind.Boolean);
            case "string": return new CanonType(TypeKind.Text, -1);
            case "fixedstring": return Str(Num(args, 0) ?? 1, false, true);
            case "uuid": return new CanonType(TypeKind.Guid);
            case "date" or "date32": return new CanonType(TypeKind.Date);
            case "datetime": return new CanonType(TypeKind.DateTime, Precision: 0);
            case "datetime64": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 3);
            case "decimal": return Dec(Num(args, 0) ?? 10, Num(args, 1) ?? 0);
            case "ipv4" or "ipv6": return Str(45, false);
            case "json": return new CanonType(TypeKind.Json);
        }
        if (b.StartsWith("decimal", StringComparison.Ordinal)) return Dec(Num(args, 0) ?? 10, Num(args, 1) ?? 0);
        if (b.StartsWith("enum", StringComparison.Ordinal)) return new CanonType(TypeKind.Enum);
        if (b.StartsWith("array", StringComparison.Ordinal) || b.StartsWith("map", StringComparison.Ordinal) || b.StartsWith("tuple", StringComparison.Ordinal)
            || b.StartsWith("nested", StringComparison.Ordinal))
            return new CanonType(TypeKind.Json, Note: "composite value copied as JSON text");
        return new CanonType(TypeKind.Other, Note: $"{raw} copied as text");
    }

    private static CanonType ParseSnowflake(string b, List<string> args)
    {
        switch (b)
        {
            case "number" or "decimal" or "numeric" or "dec":
            {
                var p = Num(args, 0) ?? 38;
                var s = Num(args, 1) ?? 0;
                return s == 0 ? (p <= 4 ? IntType(16) : p <= 9 ? IntType(32) : p <= 18 ? IntType(64) : Dec(p, 0)) : Dec(p, s);
            }
            case "int" or "integer" or "bigint" or "smallint" or "tinyint" or "byteint": return IntType(64);
            case "float" or "float4" or "float8" or "double" or "double precision" or "real": return new CanonType(TypeKind.Float, Bits: 64);
            case "decfloat": return Dec(38, 10);
            case "varchar" or "string" or "text" or "char" or "character" or "nchar" or "nvarchar" or "nvarchar2" or "char varying":
                return Num(args, 0) is { } n ? Str(n, null, b.StartsWith("char", StringComparison.Ordinal) && !b.Contains("varying", StringComparison.Ordinal)) : new CanonType(TypeKind.Text, -1);
            case "binary" or "varbinary": return new CanonType(TypeKind.VarBinary, Num(args, 0) ?? 8388608);
            case "boolean": return new CanonType(TypeKind.Boolean);
            case "date": return new CanonType(TypeKind.Date);
            case "time": return new CanonType(TypeKind.Time, Precision: Num(args, 0) ?? 9);
            case "timestamp_ntz" or "timestamp" or "datetime": return new CanonType(TypeKind.DateTime, Precision: Num(args, 0) ?? 9);
            case "timestamp_ltz" or "timestamp_tz": return new CanonType(TypeKind.DateTimeTz, Precision: Num(args, 0) ?? 9);
            case "variant" or "object" or "array": return new CanonType(TypeKind.Json);
            case "geography" or "geometry": return new CanonType(TypeKind.Other, Note: $"{b} copied as text");
            default: return Generic(b, args);
        }
    }

    private static CanonType ParseCql(string raw, string b)
    {
        switch (b)
        {
            case "text" or "varchar" or "ascii": return new CanonType(TypeKind.Text, -1);
            case "tinyint": return IntType(8);
            case "smallint": return IntType(16);
            case "int": return IntType(32);
            case "bigint" or "counter": return IntType(64);
            case "varint": return Dec(38, 0);
            case "decimal": return Dec(38, 10);
            case "float": return new CanonType(TypeKind.Float, Bits: 32);
            case "double": return new CanonType(TypeKind.Float, Bits: 64);
            case "boolean": return new CanonType(TypeKind.Boolean);
            case "uuid" or "timeuuid": return new CanonType(TypeKind.Guid);
            case "timestamp": return new CanonType(TypeKind.DateTimeTz, Precision: 3);
            case "date": return new CanonType(TypeKind.Date);
            case "time": return new CanonType(TypeKind.Time, Precision: 9);
            case "inet": return Str(45, false);
            case "blob": return new CanonType(TypeKind.Blob, -1);
            case "duration": return new CanonType(TypeKind.Interval);
        }
        if (b.StartsWith("list", StringComparison.Ordinal) || b.StartsWith("set", StringComparison.Ordinal) || b.StartsWith("map", StringComparison.Ordinal)
            || b.StartsWith("tuple", StringComparison.Ordinal) || b.StartsWith("frozen", StringComparison.Ordinal) || b.StartsWith("vector", StringComparison.Ordinal))
            return new CanonType(TypeKind.Json, Note: "collection copied as JSON text");
        return new CanonType(TypeKind.Other, Note: $"{raw} copied as text");
    }

    // ------------------------------------------------------------------ rendering

    private static string TextType(Dialect d, int? length, bool key) => Render(new CanonType(length is null ? TypeKind.Text : TypeKind.VarChar, length ?? -1), d, key).Text;

    private static string Prec(int p) => p.ToString(Inv);

    public static MappedType Render(CanonType t, Dialect d, bool isKey = false)
    {
        var note = t.Note;
        string text;
        switch (t.Kind)
        {
            case TypeKind.Boolean:
                text = d switch
                {
                    Dialect.TSql => "bit",
                    Dialect.PlSql => "NUMBER(1)",
                    Dialect.Sqlite => "BOOLEAN",
                    Dialect.ClickHouse => "Bool",
                    Dialect.Snowflake => "BOOLEAN",
                    Dialect.Cql => "boolean",
                    _ => "boolean",
                };
                break;
            case TypeKind.Int:
                text = RenderInt(t, d, ref note);
                break;
            case TypeKind.Float:
                text = RenderFloat(t, d);
                break;
            case TypeKind.Decimal:
                text = RenderDecimal(t, d, ref note);
                break;
            case TypeKind.Char or TypeKind.VarChar or TypeKind.Text:
                text = RenderString(t, d, isKey, ref note);
                break;
            case TypeKind.Binary or TypeKind.VarBinary or TypeKind.Blob:
                text = RenderBinary(t, d, isKey, ref note);
                break;
            case TypeKind.Date:
                text = d switch
                {
                    Dialect.PlSql => "DATE",
                    Dialect.Sqlite => "DATE",
                    Dialect.ClickHouse => "Date32",
                    Dialect.Snowflake => "DATE",
                    _ => "date",
                };
                break;
            case TypeKind.Time:
                text = RenderTime(t, d, ref note);
                break;
            case TypeKind.DateTime or TypeKind.DateTimeTz:
                text = RenderDateTime(t, d, ref note);
                break;
            case TypeKind.Interval:
                if (d == Dialect.PgSql) { text = "interval"; break; }
                note ??= "interval copied as text";
                text = RenderString(new CanonType(TypeKind.VarChar, 64, Unicode: false), d, false, ref note);
                break;
            case TypeKind.Guid:
                text = d switch
                {
                    Dialect.TSql => "uniqueidentifier",
                    Dialect.PgSql => "uuid",
                    Dialect.ClickHouse => "UUID",
                    Dialect.Cql => "uuid",
                    Dialect.PlSql => "CHAR(36)",
                    Dialect.Snowflake => "VARCHAR(36)",
                    Dialect.Sqlite => "CHAR(36)",
                    _ => "char(36)",
                };
                break;
            case TypeKind.Json:
                text = d switch
                {
                    Dialect.PgSql => "jsonb",
                    Dialect.MySql => "json",
                    Dialect.Snowflake => "VARIANT",
                    Dialect.PlSql => "CLOB",
                    Dialect.TSql => "nvarchar(max)",
                    Dialect.Sqlite => "TEXT",
                    Dialect.ClickHouse => "String",
                    _ => "text",
                };
                break;
            case TypeKind.Xml:
                text = d switch
                {
                    Dialect.TSql => "xml",
                    Dialect.PgSql => "xml",
                    Dialect.MySql => "longtext",
                    Dialect.Sqlite => "TEXT",
                    Dialect.PlSql => "CLOB",
                    Dialect.ClickHouse => "String",
                    Dialect.Snowflake => "VARCHAR",
                    _ => "text",
                };
                break;
            default: // Enum, Other: text
                note ??= t.Kind == TypeKind.Enum ? "enum copied as text" : "copied as text";
                text = RenderString(new CanonType(isKey ? TypeKind.VarChar : TypeKind.VarChar, t.Kind == TypeKind.Enum ? 255 : -1), d, isKey, ref note);
                if (t.Kind == TypeKind.Other && d is Dialect.TSql or Dialect.MySql or Dialect.PlSql) text = RenderString(new CanonType(TypeKind.Text, -1), d, isKey, ref note);
                break;
        }
        return new MappedType(text, note);
    }

    private static string RenderInt(CanonType t, Dialect d, ref string? note)
    {
        var bits = t.Bits;
        var u = t.Unsigned;
        switch (d)
        {
            case Dialect.TSql:
                return (bits, u) switch
                {
                    (8, true) => "tinyint",
                    (8, false) or (16, false) => "smallint",
                    (16, true) => "int",
                    (32, false) => "int",
                    (32, true) => "bigint",
                    (64, false) => "bigint",
                    _ => "decimal(20,0)",
                };
            case Dialect.PgSql:
                return (bits, u) switch
                {
                    (8, _) or (16, false) => "smallint",
                    (16, true) or (32, false) => "integer",
                    (32, true) or (64, false) => "bigint",
                    _ => "numeric(20,0)",
                };
            case Dialect.MySql:
            {
                var b = bits switch { 8 => "tinyint", 16 => "smallint", 32 => "int", _ => "bigint" };
                return u ? b + " unsigned" : b;
            }
            case Dialect.Sqlite:
                if (u && bits == 64) { note ??= "values above 2^63 are not representable as INTEGER"; }
                return "INTEGER";
            case Dialect.PlSql:
                return bits switch { 8 => u ? "NUMBER(3)" : "NUMBER(3)", 16 => u ? "NUMBER(5)" : "NUMBER(5)", 32 => u ? "NUMBER(10)" : "NUMBER(10)", _ => u ? "NUMBER(20)" : "NUMBER(19)" };
            case Dialect.ClickHouse:
                return (u ? "UInt" : "Int") + bits.ToString(Inv);
            case Dialect.Snowflake:
                return bits switch { 8 => "NUMBER(3,0)", 16 => "NUMBER(5,0)", 32 => "NUMBER(10,0)", _ => u ? "NUMBER(20,0)" : "NUMBER(19,0)" };
            case Dialect.Cql:
                return (bits, u) switch
                {
                    (8, false) => "tinyint",
                    (16, false) or (8, true) => "smallint",
                    (32, false) or (16, true) => "int",
                    (64, false) or (32, true) => "bigint",
                    _ => "varint",
                };
            default:
                return "integer";
        }
    }

    private static string RenderFloat(CanonType t, Dialect d)
    {
        var single = t.Bits <= 32;
        return d switch
        {
            Dialect.TSql => single ? "real" : "float",
            Dialect.PgSql => single ? "real" : "double precision",
            Dialect.MySql => single ? "float" : "double",
            Dialect.Sqlite => "REAL",
            Dialect.PlSql => single ? "BINARY_FLOAT" : "BINARY_DOUBLE",
            Dialect.ClickHouse => single ? "Float32" : "Float64",
            Dialect.Snowflake => "FLOAT",
            Dialect.Cql => single ? "float" : "double",
            _ => "double precision",
        };
    }

    private static string RenderDecimal(CanonType t, Dialect d, ref string? note)
    {
        var p = t.Precision;
        var s = t.Scale;
        int maxP = d switch { Dialect.TSql => 38, Dialect.MySql => 65, Dialect.PlSql => 38, Dialect.ClickHouse => 76, Dialect.Snowflake => 38, Dialect.PgSql => 1000, _ => 38 };
        if (d == Dialect.Cql) return "decimal";
        if (d == Dialect.PgSql && p is null) return "numeric";
        if (d == Dialect.PlSql && p is null) return "NUMBER";
        if (d == Dialect.Sqlite) return p is null ? "NUMERIC" : s is null ? $"NUMERIC({p})" : $"NUMERIC({p},{s})";
        if (p is null)
        {
            note ??= "unconstrained numeric mapped to precision 38, scale 10";
            p = 38;
            s = 10;
        }
        s ??= 0;
        if (p > maxP)
        {
            note ??= $"precision {p} reduced to {maxP}";
            p = maxP;
        }
        if (d == Dialect.MySql && s > 30)
        {
            note ??= $"scale {s} reduced to 30";
            s = 30;
        }
        if (s > p) s = p;
        return d switch
        {
            Dialect.TSql => $"decimal({p},{s})",
            Dialect.PgSql => $"numeric({p},{s})",
            Dialect.MySql => $"decimal({p},{s})",
            Dialect.PlSql => $"NUMBER({p},{s})",
            Dialect.ClickHouse => $"Decimal({p}, {s})",
            Dialect.Snowflake => $"NUMBER({p},{s})",
            _ => $"decimal({p},{s})",
        };
    }

    private static string RenderString(CanonType t, Dialect d, bool isKey, ref string? note)
    {
        var fixedLen = t.Kind == TypeKind.Char;
        var n = t.Length;
        var unbounded = t.IsUnbounded && !fixedLen;
        if (t.Kind == TypeKind.Text) unbounded = n is null or < 0 || n > 65535 && d != Dialect.MySql;
        switch (d)
        {
            case Dialect.TSql:
            {
                var national = t.Unicode != false;
                var pre = national ? "nvarchar" : "varchar";
                var limit = national ? 4000 : 8000;
                if (fixedLen)
                    return n is > 0 && n <= limit ? $"{(national ? "nchar" : "char")}({n})" : $"{pre}(max)";
                if (unbounded || n > limit)
                {
                    if (isKey) { note ??= "unbounded text used as key mapped to nvarchar(450)"; return national ? "nvarchar(450)" : "varchar(900)"; }
                    return $"{pre}(max)";
                }
                return $"{pre}({n})";
            }
            case Dialect.PgSql:
                if (fixedLen) return n is > 0 and <= 10485760 ? $"char({n})" : "text";
                if (unbounded || n > 10485760) return "text";
                return $"varchar({n})";
            case Dialect.MySql:
            {
                if (fixedLen) return n is > 0 and <= 255 ? $"char({n})" : n is > 255 and <= 16383 ? $"varchar({n})" : "longtext";
                if (unbounded || n > 16383)
                {
                    if (isKey) { note ??= "unbounded text used as key mapped to varchar(255)"; return "varchar(255)"; }
                    if (n is > 16383 and <= 65535) return "text";
                    if (n is > 65535 and <= 16777215) return "mediumtext";
                    return "longtext";
                }
                return $"varchar({n})";
            }
            case Dialect.Sqlite:
                if (fixedLen) return n is > 0 ? $"CHAR({n})" : "TEXT";
                return unbounded ? "TEXT" : $"VARCHAR({n})";
            case Dialect.PlSql:
                if (fixedLen) return n is > 0 and <= 2000 ? $"CHAR({n} CHAR)" : "CLOB";
                if (unbounded || n > 4000)
                {
                    if (isKey) { note ??= "unbounded text used as key mapped to VARCHAR2(1000 CHAR)"; return "VARCHAR2(1000 CHAR)"; }
                    return "CLOB";
                }
                return $"VARCHAR2({n} CHAR)";
            case Dialect.ClickHouse:
                return "String";
            case Dialect.Snowflake:
                if (fixedLen) return n is > 0 ? $"CHAR({n})" : "VARCHAR";
                return unbounded || n > 16777216 ? "VARCHAR" : $"VARCHAR({n})";
            case Dialect.Cql:
                return "text";
            default:
                return "text";
        }
    }

    private static string RenderBinary(CanonType t, Dialect d, bool isKey, ref string? note)
    {
        var n = t.Length;
        var fixedLen = t.Kind == TypeKind.Binary;
        var unbounded = t.Kind == TypeKind.Blob || n is null or < 0;
        switch (d)
        {
            case Dialect.TSql:
                if (fixedLen && n is > 0 and <= 8000) return $"binary({n})";
                if (!unbounded && n <= 8000) return $"varbinary({n})";
                return "varbinary(max)";
            case Dialect.PgSql: return "bytea";
            case Dialect.MySql:
                if (fixedLen && n is > 0 and <= 255) return $"binary({n})";
                if (!unbounded && n <= 65535) return $"varbinary({n})";
                return n is > 65535 and <= 16777215 ? "mediumblob" : "longblob";
            case Dialect.Sqlite: return "BLOB";
            case Dialect.PlSql:
                if (!unbounded && n <= 2000) return $"RAW({n})";
                return "BLOB";
            case Dialect.ClickHouse:
                note ??= "binary stored as String";
                return "String";
            case Dialect.Snowflake: return !unbounded ? $"BINARY({n})" : "BINARY";
            case Dialect.Cql: return "blob";
            default: return "bytea";
        }
    }

    private static string RenderTime(CanonType t, Dialect d, ref string? note)
    {
        var p = t.Precision;
        switch (d)
        {
            case Dialect.TSql: return $"time({Math.Min(p ?? 7, 7)})";
            case Dialect.PgSql: return p is null or 6 ? "time" : $"time({Math.Min(p.Value, 6)})";
            case Dialect.MySql: return p is null or 0 ? "time" : $"time({Math.Min(p.Value, 6)})";
            case Dialect.Sqlite: return "TIME";
            case Dialect.Snowflake: return $"TIME({Math.Min(p ?? 9, 9)})";
            case Dialect.Cql: return "time";
            default:
                note ??= "time copied as text";
                return d == Dialect.PlSql ? "VARCHAR2(18 CHAR)" : "String";
        }
    }

    private static string RenderDateTime(CanonType t, Dialect d, ref string? note)
    {
        var tz = t.Kind == TypeKind.DateTimeTz;
        var p = t.Precision;
        switch (d)
        {
            case Dialect.TSql:
            {
                var pp = Math.Min(p ?? 7, 7);
                return tz ? $"datetimeoffset({pp})" : $"datetime2({pp})";
            }
            case Dialect.PgSql:
            {
                var pp = Math.Min(p ?? 6, 6);
                if (p > 6) note ??= $"fractional seconds reduced to 6 digits";
                var name = tz ? "timestamptz" : "timestamp";
                return pp == 6 ? name : $"{name}({pp})";
            }
            case Dialect.MySql:
            {
                var pp = Math.Min(p ?? 6, 6);
                if (p > 6) note ??= "fractional seconds reduced to 6 digits";
                if (tz) note ??= "time zone offset dropped, stored as UTC";
                return pp == 0 ? "datetime" : $"datetime({pp})";
            }
            case Dialect.Sqlite:
                if (tz) note ??= "stored as ISO text with the UTC offset";
                return "DATETIME";
            case Dialect.PlSql:
            {
                var pp = Math.Min(p ?? 6, 9);
                return tz ? $"TIMESTAMP({pp}) WITH TIME ZONE" : $"TIMESTAMP({pp})";
            }
            case Dialect.ClickHouse:
            {
                var pp = Math.Min(p ?? 3, 9);
                if (tz) note ??= "stored as UTC";
                return pp == 0 ? "DateTime" : $"DateTime64({pp})";
            }
            case Dialect.Snowflake:
            {
                var pp = Math.Min(p ?? 9, 9);
                return tz ? $"TIMESTAMP_TZ({pp})" : $"TIMESTAMP_NTZ({pp})";
            }
            case Dialect.Cql:
                if (p > 3) note ??= "fractional seconds reduced to milliseconds";
                return "timestamp";
            default:
                return "timestamp";
        }
    }

    // ------------------------------------------------------------------ defaults

    [GeneratedRegex(@"^[+-]?\d+(\.\d+)?$")]
    private static partial Regex NumberLiteral();

    [GeneratedRegex(@"^(?:N|n)?'((?:[^']|'')*)'(?:::[\w\s\.\[\]""()]+)?$")]
    private static partial Regex StringLiteral();

    [GeneratedRegex(@"^(getdate|getutcdate|sysdatetime|sysutcdatetime|sysdatetimeoffset|current_timestamp|now|localtimestamp|localtime|statement_timestamp|transaction_timestamp|clock_timestamp|sysdate|systimestamp|current_date|curdate|current_time|curtime)(\(\s*\d*\s*\))?$", RegexOptions.IgnoreCase)]
    private static partial Regex NowFunction();

    [GeneratedRegex(@"^(newid|newsequentialid|gen_random_uuid|uuid_generate_v4|uuid|generateuuidv4)\(\)$", RegexOptions.IgnoreCase)]
    private static partial Regex UuidFunction();

    /// <summary>Removes redundant outer parentheses: "((0))" → "0", "(N'x')" → "N'x'".</summary>
    public static string StripParens(string expr)
    {
        var e = expr.Trim();
        while (e.Length >= 2 && e[0] == '(' && e[^1] == ')' && Balanced(e[1..^1])) e = e[1..^1].Trim();
        return e;
    }

    private static bool Balanced(string s)
    {
        var depth = 0;
        var quote = false;
        foreach (var c in s)
        {
            if (c == '\'') quote = !quote;
            if (quote) continue;
            if (c == '(') depth++;
            else if (c == ')' && --depth < 0) return false;
        }
        return depth == 0 && !quote;
    }

    /// <summary>
    /// Translates a column default into the target dialect, or null (with <paramref name="reason"/>) when it cannot be
    /// carried: numbers, strings, booleans, "now" and uuid functions are translated, everything else is dropped.
    /// </summary>
    public static string? MapDefault(string? expr, Dialect source, Dialect target, CanonType targetType, out string? reason)
    {
        reason = null;
        if (string.IsNullOrWhiteSpace(expr)) return null;
        var e = StripParens(expr);
        if (e.Length == 0 || e.Equals("null", StringComparison.OrdinalIgnoreCase)) return null;
        if (NumberLiteral().IsMatch(e))
        {
            if (targetType.Kind == TypeKind.Boolean) return BoolLiteral(target, e != "0");
            return e;
        }
        if (e.Equals("true", StringComparison.OrdinalIgnoreCase) || e.Equals("false", StringComparison.OrdinalIgnoreCase))
            return BoolLiteral(target, e.Equals("true", StringComparison.OrdinalIgnoreCase));
        var m = StringLiteral().Match(e);
        if (m.Success)
        {
            var body = m.Groups[1].Value;
            if (targetType.Kind == TypeKind.Boolean) return BoolLiteral(target, body is "1" or "t" or "true" or "y" or "yes");
            if (DialectInfo.BackslashStringEscapes(target)) body = body.Replace("\\", "\\\\", StringComparison.Ordinal);
            return "'" + body + "'";
        }
        if (NowFunction().IsMatch(e) && targetType.Kind is TypeKind.DateTime or TypeKind.DateTimeTz or TypeKind.Date or TypeKind.Time)
        {
            var p = Regex.Match(e, @"\((\d+)\)").Success ? int.Parse(Regex.Match(e, @"\((\d+)\)").Groups[1].Value, Inv) : (int?)null;
            return target switch
            {
                Dialect.TSql => targetType.Kind == TypeKind.Date ? "CONVERT(date, GETDATE())" : targetType.Kind == TypeKind.DateTimeTz ? "SYSDATETIMEOFFSET()" : "SYSDATETIME()",
                Dialect.PgSql => targetType.Kind == TypeKind.Date ? "CURRENT_DATE" : "CURRENT_TIMESTAMP",
                Dialect.MySql => targetType.Kind == TypeKind.Date ? "(CURRENT_DATE)" : $"CURRENT_TIMESTAMP({Math.Min(targetType.Precision ?? p ?? 0, 6)})".Replace("(0)", "", StringComparison.Ordinal),
                Dialect.Sqlite => "CURRENT_TIMESTAMP",
                Dialect.PlSql => targetType.Kind == TypeKind.Date ? "SYSDATE" : "SYSTIMESTAMP",
                Dialect.ClickHouse => targetType.Kind == TypeKind.Date ? "today()" : "now()",
                Dialect.Snowflake => "CURRENT_TIMESTAMP()",
                _ => null,
            };
        }
        if (UuidFunction().IsMatch(e) && targetType.Kind == TypeKind.Guid || UuidFunction().IsMatch(e) && targetType.IsText)
        {
            return target switch
            {
                Dialect.TSql => "NEWID()",
                Dialect.PgSql => "gen_random_uuid()",
                Dialect.MySql => "(UUID())",
                Dialect.ClickHouse => "generateUUIDv4()",
                _ => null,
            } ?? Drop(out reason, e, "no uuid generator in the target");
        }
        reason = $"default {e} is specific to the source and was not copied";
        return null;
    }

    private static string? Drop(out string? reason, string e, string why)
    {
        reason = $"default {e}: {why}";
        return null;
    }

    private static string BoolLiteral(Dialect d, bool v) => d switch
    {
        Dialect.PgSql or Dialect.Snowflake => v ? "TRUE" : "FALSE",
        Dialect.ClickHouse or Dialect.Cql => v ? "true" : "false",
        _ => v ? "1" : "0",
    };
}
