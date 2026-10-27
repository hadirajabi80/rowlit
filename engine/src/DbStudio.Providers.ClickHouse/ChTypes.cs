using System.Collections;
using System.Globalization;
using System.Net;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ClickHouse.Driver.Numerics;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Providers.ClickHouse;

/// <summary>
/// ClickHouse type names → column kinds and driver values → wire values (plan-batch3 WP-CH): integers (UInt64/Int128/…
/// beyond 2^53 as text), Decimal as exact text, Date/Date32 as dates, DateTime/DateTime64 as wall-clock date-times of the
/// column's time zone, UUID, IPv4/IPv6 as text, Enum/LowCardinality/FixedString as strings, and Array/Map/Tuple/Nested/JSON
/// (and Nullable/LowCardinality wrappers around them) as JSON text.
/// </summary>
public static class ChTypes
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>Non-ASCII text stays readable in JSON cells (Persian / Arabic values are not turned into \uXXXX).</summary>
    private static readonly JsonSerializerOptions Relaxed = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>Removes <c>Nullable(…)</c>, <c>LowCardinality(…)</c> and <c>SimpleAggregateFunction(f, T)</c> wrappers.</summary>
    public static string Unwrap(string? type)
    {
        var t = (type ?? "").Trim();
        while (true)
        {
            if (Inner(t, "Nullable") is { } n) { t = n; continue; }
            if (Inner(t, "LowCardinality") is { } l) { t = l; continue; }
            if (Inner(t, "SimpleAggregateFunction") is { } s)
            {
                var args = SplitArgs(s);
                if (args.Count >= 2) { t = args[^1]; continue; }
            }
            return t;
        }
    }

    /// <summary>True for <c>Nullable(T)</c> (also inside LowCardinality).</summary>
    public static bool IsNullable(string? type)
    {
        var t = (type ?? "").Trim();
        if (Inner(t, "LowCardinality") is { } l) t = l;
        return t.StartsWith("Nullable(", StringComparison.Ordinal) || t == "Nothing";
    }

    /// <summary>The argument text of <c>Name(...)</c>, or null.</summary>
    public static string? Inner(string type, string name) =>
        type.Length > name.Length + 2 && type.StartsWith(name + "(", StringComparison.Ordinal) && type.EndsWith(')')
            ? type[(name.Length + 1)..^1].Trim()
            : null;

    /// <summary>Splits top-level comma-separated type arguments ("String, Array(UInt8)" → two parts).</summary>
    public static List<string> SplitArgs(string args)
    {
        var parts = new List<string>();
        var depth = 0;
        var quote = false;
        var last = 0;
        for (var i = 0; i < args.Length; i++)
        {
            var c = args[i];
            if (quote)
            {
                if (c == '\\') i++;
                else if (c == '\'') quote = false;
                continue;
            }
            if (c == '\'') quote = true;
            else if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == ',' && depth == 0)
            {
                parts.Add(args[last..i].Trim());
                last = i + 1;
            }
        }
        var tail = args[last..].Trim();
        if (tail.Length > 0) parts.Add(tail);
        return parts;
    }

    /// <summary>Base name of a type: "DateTime64(3, 'UTC')" → "DateTime64".</summary>
    public static string BaseName(string type)
    {
        var p = type.IndexOf('(');
        return (p < 0 ? type : type[..p]).Trim();
    }

    /// <summary>
    /// Base name with the driver's spelling folded: ClickHouse.Driver reports the JSON type as "Json" (the server calls it
    /// "JSON"), so every JSON check goes through this.
    /// </summary>
    private static string CanonicalBase(string type)
    {
        var b = BaseName(type);
        return b.Equals("JSON", StringComparison.OrdinalIgnoreCase) ? "JSON" : b;
    }

    public static string KindFor(string? dbType)
    {
        var t = Unwrap(dbType);
        var b = CanonicalBase(t);
        switch (b)
        {
            case "Int8" or "Int16" or "Int32" or "Int64" or "Int128" or "Int256" or "UInt8" or "UInt16" or "UInt32" or "UInt64"
                or "UInt128" or "UInt256" or "IntervalSecond" or "IntervalMinute" or "IntervalHour" or "IntervalDay" or "IntervalWeek"
                or "IntervalMonth" or "IntervalQuarter" or "IntervalYear" or "IntervalMillisecond" or "IntervalMicrosecond" or "IntervalNanosecond":
                return ColumnKinds.Int;
            case "Float32" or "Float64" or "BFloat16":
                return ColumnKinds.Float;
            case "Decimal" or "Decimal32" or "Decimal64" or "Decimal128" or "Decimal256":
                return ColumnKinds.Decimal;
            case "Bool" or "Boolean":
                return ColumnKinds.Bool;
            case "Date" or "Date32":
                return ColumnKinds.Date;
            case "DateTime" or "DateTime32" or "DateTime64":
                return ColumnKinds.DateTime;
            case "UUID":
                return ColumnKinds.Guid;
            case "String" or "FixedString" or "Enum8" or "Enum16" or "Enum" or "IPv4" or "IPv6":
                return ColumnKinds.String;
            case "Array" or "Map" or "Tuple" or "Nested" or "JSON" or "Object" or "Point" or "Ring" or "Polygon" or "MultiPolygon"
                or "LineString" or "MultiLineString":
                return ColumnKinds.Json;
            case "AggregateFunction":
                return ColumnKinds.Binary;
            case "Nothing":
                return ColumnKinds.String;
            default:
                return ColumnKinds.Other;
        }
    }

    /// <summary>Wire value of a cell read by the driver (GetValue), given the column's ClickHouse type.</summary>
    public static object? ToWire(object? value, string? dbType)
    {
        if (value is null or DBNull) return null;
        var t = Unwrap(dbType);
        var b = CanonicalBase(t);
        switch (b)
        {
            case "Date" or "Date32" when value is DateTime d:
                return d.ToString(ValueConverter.DateFormat, Inv);
            case "Date" or "Date32" when value is DateOnly dOnly:
                return dOnly.ToString(ValueConverter.DateFormat, Inv);
            case "FixedString" when value is string fs:
                return ValueConverter.Text(fs.TrimEnd('\0'));
            case "FixedString" when value is byte[] fb:
                return ValueConverter.Text(Encoding.UTF8.GetString(fb).TrimEnd('\0'));
            case "Array" or "Map" or "Tuple" or "Nested" or "Point" or "Ring" or "Polygon" or "MultiPolygon" or "LineString" or "MultiLineString":
                return ValueConverter.Text(ToJson(value, t));
            case "JSON" or "Object":
                return ValueConverter.Text(value is string js ? js : ToJson(value));
            case "Variant" or "Dynamic" when value is byte[] vb:
                // Strings arrive as string: a byte[] inside Variant / Dynamic is an Array(UInt8).
                return ValueConverter.Text(ToJson(vb));
        }
        return value switch
        {
            ClickHouseDecimal cd => cd.ToString(Inv),
            BigInteger bi => bi.ToString(Inv),
            IPAddress ip => ip.ToString(),
            byte[] bytes when b is "String" => ValueConverter.Text(Encoding.UTF8.GetString(bytes)),
            JsonNode or JsonElement or JsonDocument => ValueConverter.Text(ToJson(value)),
            ITuple or IDictionary or (IEnumerable and not string and not byte[]) => ValueConverter.Text(ToJson(value)),
            _ => ValueConverter.ToWire(value),
        };
    }

    /// <summary>Renders an array/map/tuple value as compact JSON (numbers stay numbers, big integers and decimals as exact numbers).</summary>
    public static string ToJson(object? value) => ToJson(value, null);

    /// <summary>
    /// As <see cref="ToJson(object?)"/> with the column's ClickHouse type, which decides how the elements of arrays, maps and
    /// tuples are spelled: the driver hands both <c>Date</c> and <c>DateTime</c> elements out as <see cref="DateTime"/>, so only
    /// the type tells <c>Array(Date)</c> (2026-01-01) from <c>Array(DateTime)</c> (2026-01-01T00:00:00).
    /// </summary>
    public static string ToJson(object? value, string? dbType)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            Write(w, value, 0, dbType);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    /// <summary>The element type of <c>Array(T)</c>, the (key, value) types of <c>Map(K, V)</c>, the member types of <c>Tuple(…)</c>; empty when unknown.</summary>
    private static List<string> TypeArgs(string? type, string name)
    {
        if (type is null || Inner(Unwrap(type), name) is not { } inner) return [];
        var args = SplitArgs(inner);
        if (name != "Tuple") return args;
        // Tuple(a UInt8, b String): a member name precedes the type (a space outside any parentheses).
        for (var i = 0; i < args.Count; i++)
        {
            var depth = 0;
            for (var k = 0; k < args[i].Length; k++)
            {
                var c = args[i][k];
                if (c == '(') depth++;
                else if (c == ')') depth--;
                else if (c == ' ' && depth == 0) { args[i] = args[i][(k + 1)..].Trim(); break; }
            }
        }
        return args;
    }

    private static void Write(Utf8JsonWriter w, object? v, int depth, string? type)
    {
        if (depth > 64) { w.WriteStringValue("…"); return; }
        var b = type is null ? null : CanonicalBase(Unwrap(type));
        switch (v)
        {
            case null or DBNull: w.WriteNullValue(); return;
            case string s: w.WriteStringValue(s); return;
            case bool bo: w.WriteBooleanValue(bo); return;
            case byte or sbyte or short or ushort or int or uint or long or ulong:
                w.WriteRawValue(Convert.ToString(v, Inv)!); return;
            case BigInteger bi: w.WriteRawValue(bi.ToString(Inv)); return;
            case ClickHouseDecimal cd: w.WriteRawValue(cd.ToString(Inv)); return;
            case decimal m: w.WriteRawValue(m.ToString(Inv)); return;
            case double d:
                if (double.IsFinite(d)) w.WriteNumberValue(d); else w.WriteStringValue(d.ToString(Inv));
                return;
            case float f:
                if (float.IsFinite(f)) w.WriteRawValue(f.ToString("R", Inv)); else w.WriteStringValue(f.ToString(Inv));
                return;
            case DateTime dt:
                if (b is "Date" or "Date32") w.WriteStringValue(dt.ToString(ValueConverter.DateFormat, Inv));
                else if (b is "DateTime" or "DateTime32" or "DateTime64") w.WriteStringValue(dt.ToString(ValueConverter.DateTimeFormat, Inv));
                else
                    w.WriteStringValue(dt.TimeOfDay == TimeSpan.Zero && dt.Kind != DateTimeKind.Utc
                        ? dt.ToString(ValueConverter.DateFormat, Inv) : dt.ToString(ValueConverter.DateTimeFormat, Inv));
                return;
            case DateTimeOffset dto: w.WriteStringValue(dto.ToString(ValueConverter.DateTimeOffsetFormat, Inv)); return;
            case DateOnly don: w.WriteStringValue(don.ToString(ValueConverter.DateFormat, Inv)); return;
            case Guid g: w.WriteStringValue(g.ToString("D")); return;
            case IPAddress ip: w.WriteStringValue(ip.ToString()); return;
            case JsonNode node: w.WriteRawValue(node.ToJsonString(Relaxed)); return;
            case JsonElement el: el.WriteTo(w); return;
            case JsonDocument doc: doc.RootElement.WriteTo(w); return;
            case byte[] bytes:
                // Array(UInt8) arrives as byte[]: keep it an array of numbers.
                w.WriteStartArray();
                foreach (var x in bytes) w.WriteNumberValue(x);
                w.WriteEndArray();
                return;
            case IDictionary dict:
            {
                var map = TypeArgs(type, "Map");
                w.WriteStartObject();
                foreach (DictionaryEntry e in dict)
                {
                    w.WritePropertyName(KeyText(e.Key, map.Count > 0 ? map[0] : null));
                    Write(w, e.Value, depth + 1, map.Count > 1 ? map[1] : null);
                }
                w.WriteEndObject();
                return;
            }
            case ITuple tuple:
            {
                var members = TypeArgs(type, "Tuple");
                w.WriteStartArray();
                for (var i = 0; i < tuple.Length; i++) Write(w, tuple[i], depth + 1, i < members.Count ? members[i] : null);
                w.WriteEndArray();
                return;
            }
            case IEnumerable seq:
            {
                // Map read as KeyValuePairs, arrays of anything.
                var element = b == "Map" ? (string?)null : TypeArgs(type, "Array") is { Count: > 0 } a ? a[0] : null;
                var map = b == "Map" ? TypeArgs(type, "Map") : [];
                w.WriteStartArray();
                foreach (var x in seq)
                {
                    if (map.Count > 1) WritePair(w, x, depth + 1, map[0], map[1]);
                    else Write(w, x, depth + 1, element);
                }
                w.WriteEndArray();
                return;
            }
            default:
                var kv = v.GetType();
                if (kv.IsGenericType && kv.GetGenericTypeDefinition() == typeof(KeyValuePair<,>))
                {
                    WritePair(w, v, depth, null, null);
                    return;
                }
                w.WriteStringValue(Convert.ToString(v, Inv));
                return;
        }
    }

    private static void WritePair(Utf8JsonWriter w, object? pair, int depth, string? keyType, string? valueType)
    {
        var kv = pair!.GetType();
        w.WriteStartArray();
        Write(w, kv.GetProperty("Key")!.GetValue(pair), depth + 1, keyType);
        Write(w, kv.GetProperty("Value")!.GetValue(pair), depth + 1, valueType);
        w.WriteEndArray();
    }

    private static string KeyText(object? key, string? keyType = null) => key switch
    {
        null => "null",
        string s => s,
        DateTime dt when keyType is not null && CanonicalBase(Unwrap(keyType)) is "Date" or "Date32" => dt.ToString(ValueConverter.DateFormat, Inv),
        DateTime dt => dt.ToString(ValueConverter.DateTimeFormat, Inv),
        IFormattable f => f.ToString(null, Inv),
        _ => key.ToString() ?? "",
    };

    /// <summary>Display type text as the catalog shows it (the server's own spelling).</summary>
    public static string Display(string? type) => (type ?? "").Trim();
}
