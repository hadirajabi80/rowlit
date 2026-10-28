using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Core.DataCompare;

/// <summary>How the values of a column pair are compared (and, for keys, ordered).</summary>
public enum ValueFamily { Numeric, Float, Bool, Temporal, Text, Guid, Binary, Json }

/// <summary>Column-pair comparison rules shared by the key comparer and the value comparer.</summary>
public static class ValueFamilies
{
    public static ValueFamily Of(CanonType t) => t.Kind switch
    {
        TypeKind.Boolean => ValueFamily.Bool,
        TypeKind.Int or TypeKind.Decimal => ValueFamily.Numeric,
        TypeKind.Float => ValueFamily.Float,
        TypeKind.Date or TypeKind.Time or TypeKind.DateTime or TypeKind.DateTimeTz => ValueFamily.Temporal,
        TypeKind.Guid => ValueFamily.Guid,
        TypeKind.Binary or TypeKind.VarBinary or TypeKind.Blob => ValueFamily.Binary,
        TypeKind.Json => ValueFamily.Json,
        _ => ValueFamily.Text,
    };

    /// <summary>The family a pair of column types is compared in (cross-provider: SQLite text dates, 0/1 booleans …).</summary>
    public static ValueFamily Pick(CanonType a, CanonType b)
    {
        var fa = Of(a);
        var fb = Of(b);
        if (fa == fb) return fa;
        static bool Num(ValueFamily f) => f is ValueFamily.Numeric or ValueFamily.Float;
        if (Num(fa) && Num(fb)) return ValueFamily.Float;
        if (fa == ValueFamily.Bool && Num(fb) || fb == ValueFamily.Bool && Num(fa)) return ValueFamily.Bool;
        var other = fa == ValueFamily.Text ? fb : fb == ValueFamily.Text ? fa : (ValueFamily?)null;
        if (other is ValueFamily.Temporal or ValueFamily.Guid or ValueFamily.Json or ValueFamily.Numeric or ValueFamily.Float) return other.Value;
        return ValueFamily.Text;
    }

    /// <summary>A CHAR(n) column on either side: trailing blanks are padding, not data.</summary>
    public static bool Padded(CanonType a, CanonType b) => a.Kind == TypeKind.Char || b.Kind == TypeKind.Char;

    public static string Wire(ValueFamily f) => f switch
    {
        ValueFamily.Numeric => "numeric", ValueFamily.Float => "float", ValueFamily.Bool => "bool", ValueFamily.Temporal => "temporal",
        ValueFamily.Guid => "guid", ValueFamily.Binary => "binary", ValueFamily.Json => "json", _ => "text",
    };

    /// <summary>Families whose order both servers produce the same way with <see cref="DataCompareSql.OrderExpression"/>.</summary>
    public static bool ServerOrderable(ValueFamily f) => f is not ValueFamily.Json;

    /// <summary>Families that sort together on the server (a numeric key and a text key do not).</summary>
    public static int OrderGroup(ValueFamily f) => f switch
    {
        ValueFamily.Numeric or ValueFamily.Float or ValueFamily.Bool => 0,
        ValueFamily.Temporal => 1,
        ValueFamily.Text or ValueFamily.Guid => 2,
        ValueFamily.Binary => 3,
        _ => 4,
    };
}

/// <summary>Normalised forms of wire values (see <see cref="ValueConverter"/>).</summary>
internal static class WireNorm
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private static readonly string[] DateFormats =
    [
        "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", "yyyy-MM-dd HH:mm:ss.FFFFFFF", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd",
    ];

    public static string? Text(object? v) => v switch
    {
        null => null,
        string s => s,
        TruncatedValue t => t.Full,
        BinaryValue b => Convert.ToBase64String(b.Full),
        _ => ValueConverter.ToInvariantString(v),
    };

    public static bool TryDecimal(object? v, out decimal d)
    {
        switch (v)
        {
            case int i: d = i; return true;
            case long l: d = l; return true;
            case short s: d = s; return true;
            case byte b: d = b; return true;
            case sbyte sb: d = sb; return true;
            case ushort us: d = us; return true;
            case bool bo: d = bo ? 1 : 0; return true;
            case decimal m: d = m; return true;
            case double db when double.IsFinite(db) && Math.Abs(db) < 7.9e28:
                d = (decimal)db;
                return true;
            case float f when float.IsFinite(f) && Math.Abs(f) < 7.9e28f:
                d = (decimal)f;
                return true;
            case string s2:
                return decimal.TryParse(s2.Trim(), NumberStyles.Float, Inv, out d);
            default:
                d = 0;
                return false;
        }
    }

    public static bool TryDouble(object? v, out double d)
    {
        switch (v)
        {
            case double db: d = db; return true;
            case float f: d = f; return true;
            case string s:
                switch (s.Trim())
                {
                    case "NaN": d = double.NaN; return true;
                    case "Infinity": d = double.PositiveInfinity; return true;
                    case "-Infinity": d = double.NegativeInfinity; return true;
                }
                return double.TryParse(s.Trim(), NumberStyles.Float, Inv, out d);
            default:
                if (TryDecimal(v, out var m)) { d = (double)m; return true; }
                d = 0;
                return false;
        }
    }

    public static bool TryBool(object? v, out bool b)
    {
        switch (v)
        {
            case bool x: b = x; return true;
            case string s:
                switch (s.Trim().ToLowerInvariant())
                {
                    case "1" or "true" or "t" or "y" or "yes" or "on": b = true; return true;
                    case "0" or "false" or "f" or "n" or "no" or "off": b = false; return true;
                }
                b = false;
                return false;
            default:
                if (TryDecimal(v, out var d)) { b = d != 0; return true; }
                b = false;
                return false;
        }
    }

    /// <summary>Ticks of a temporal value: instants (with an offset) as UTC, wall clocks as they are, times of day as ticks since midnight.</summary>
    public static bool TryTicks(object? v, out long ticks)
    {
        ticks = 0;
        if (Text(v) is not { } s) return false;
        s = s.Trim();
        if (s.Length == 0) return false;
        // with an offset: an instant
        if (s.Length > 10 && (s.EndsWith('Z') || HasOffset(s)) &&
            DateTimeOffset.TryParse(s, Inv, DateTimeStyles.AllowWhiteSpaces, out var dto))
        {
            ticks = dto.UtcTicks;
            return true;
        }
        if (DateTime.TryParseExact(s, DateFormats, Inv, DateTimeStyles.None, out var dt))
        {
            ticks = dt.Ticks;
            return true;
        }
        if (TimeSpan.TryParse(s, Inv, out var ts))
        {
            ticks = ts.Ticks;
            return true;
        }
        if (DateTime.TryParse(s, Inv, DateTimeStyles.None, out dt))
        {
            ticks = dt.Ticks;
            return true;
        }
        return false;
    }

    private static bool HasOffset(string s)
    {
        // "...+02:00" / "...-0500" after the time part (a date's own '-' are at 4 and 7)
        var i = s.LastIndexOfAny(['+', '-']);
        return i > 10 && i >= s.Length - 6;
    }

    public static bool TryGuid(object? v, out Guid g)
    {
        if (v is BinaryValue b && b.Full.Length == 16) { g = new Guid(b.Full); return true; }
        return Guid.TryParse(Text(v)?.Trim(), out g);
    }

    public static byte[]? Bytes(object? v) => v switch
    {
        null => null,
        BinaryValue b => b.Full,
        _ => Encoding.UTF8.GetBytes(Text(v) ?? ""),
    };

    /// <summary>Ordinal comparison in Unicode code point order (UTF-16 ordinal differs for supplementary characters).</summary>
    public static int CompareCodePoints(string a, string b)
    {
        var n = Math.Min(a.Length, b.Length);
        for (var i = 0; i < n; i++)
        {
            int x = a[i], y = b[i];
            if (x == y) continue;
            // ICU's "UTF-16 in code point order" fix-up: surrogates sort after U+E000..U+FFFF
            if (x >= 0xD800 && y >= 0xD800)
            {
                x += x >= 0xE000 ? -0x800 : 0x2000;
                y += y >= 0xE000 ? -0x800 : 0x2000;
            }
            return x < y ? -1 : 1;
        }
        return a.Length.CompareTo(b.Length);
    }
}

/// <summary>
/// Orders and matches key tuples. The order is the one <see cref="DataCompareSql.OrderExpression"/> asks the servers for:
/// NULLs first, numbers by value, date / times by instant, text and GUIDs by code point (binary collations), bytes
/// lexicographically. A stream that violates it is detected by the merge join (the comparison then sorts in the engine).
/// </summary>
public sealed class KeyComparer : IComparer<object?[]>
{
    private readonly ValueFamily[] _families;
    private readonly bool[] _padded;
    private readonly int[] _index;

    /// <param name="index">Positions of the key values in a row.</param>
    public KeyComparer(IReadOnlyList<ValueFamily> families, IReadOnlyList<bool> padded, IReadOnlyList<int> index)
    {
        _families = [.. families];
        _padded = [.. padded];
        _index = [.. index];
    }

    public int Count => _index.Length;

    public int Compare(object?[]? x, object?[]? y)
    {
        if (ReferenceEquals(x, y)) return 0;
        if (x is null) return -1;
        if (y is null) return 1;
        for (var k = 0; k < _index.Length; k++)
        {
            var c = CompareValue(_families[k], _padded[k], x[_index[k]], y[_index[k]]);
            if (c != 0) return c;
        }
        return 0;
    }

    public static int CompareValue(ValueFamily f, bool padded, object? a, object? b)
    {
        if (a is null || b is null) return a is null ? b is null ? 0 : -1 : 1;
        switch (f)
        {
            case ValueFamily.Numeric or ValueFamily.Float or ValueFamily.Bool:
                if (WireNorm.TryDecimal(a, out var da) && WireNorm.TryDecimal(b, out var db)) return da.CompareTo(db);
                if (WireNorm.TryDouble(a, out var xa) && WireNorm.TryDouble(b, out var xb)) return xa.CompareTo(xb);
                break;
            case ValueFamily.Temporal:
                if (WireNorm.TryTicks(a, out var ta) && WireNorm.TryTicks(b, out var tb)) return ta.CompareTo(tb);
                break;
            case ValueFamily.Guid:
                return string.CompareOrdinal(WireNorm.Text(a)!.Trim().ToLowerInvariant(), WireNorm.Text(b)!.Trim().ToLowerInvariant());
            case ValueFamily.Binary:
            {
                var ba = WireNorm.Bytes(a)!;
                var bb = WireNorm.Bytes(b)!;
                return ba.AsSpan().SequenceCompareTo(bb);
            }
        }
        var sa = WireNorm.Text(a)!;
        var sb = WireNorm.Text(b)!;
        if (padded)
        {
            sa = sa.TrimEnd(' ');
            sb = sb.TrimEnd(' ');
        }
        return WireNorm.CompareCodePoints(sa, sb);
    }
}

/// <summary>Equality of two non-key values with the comparison options (tolerances, trimming, case, empty = NULL).</summary>
public sealed class ValueComparer(DataCompareOptions options)
{
    public bool AreEqual(ValueFamily f, bool padded, object? a, object? b)
    {
        if (options.EmptyAsNull)
        {
            if (a is string { Length: 0 }) a = null;
            if (b is string { Length: 0 }) b = null;
        }
        if (a is null || b is null) return a is null && b is null;
        switch (f)
        {
            case ValueFamily.Numeric:
                if (WireNorm.TryDecimal(a, out var ma) && WireNorm.TryDecimal(b, out var mb))
                    return options.NumericTolerance > 0 ? Math.Abs((double)(ma - mb)) <= options.NumericTolerance : ma == mb;
                break;
            case ValueFamily.Float:
                if (WireNorm.TryDouble(a, out var xa) && WireNorm.TryDouble(b, out var xb))
                {
                    if (double.IsNaN(xa) || double.IsNaN(xb)) return double.IsNaN(xa) && double.IsNaN(xb);
                    if (xa.Equals(xb)) return true;
                    return options.NumericTolerance > 0 && Math.Abs(xa - xb) <= options.NumericTolerance;
                }
                break;
            case ValueFamily.Bool:
                if (WireNorm.TryBool(a, out var ba) && WireNorm.TryBool(b, out var bb)) return ba == bb;
                break;
            case ValueFamily.Temporal:
                if (WireNorm.TryTicks(a, out var ta) && WireNorm.TryTicks(b, out var tb))
                    return Math.Abs(ta - tb) <= options.TimeToleranceMs * TimeSpan.TicksPerMillisecond;
                break;
            case ValueFamily.Guid:
                if (WireNorm.TryGuid(a, out var ga) && WireNorm.TryGuid(b, out var gb)) return ga == gb;
                break;
            case ValueFamily.Binary:
                return WireNorm.Bytes(a)!.AsSpan().SequenceEqual(WireNorm.Bytes(b));
            case ValueFamily.Json:
                if (JsonEqual(WireNorm.Text(a)!, WireNorm.Text(b)!) is { } je) return je;
                break;
        }
        return TextEqual(padded, WireNorm.Text(a)!, WireNorm.Text(b)!);
    }

    private bool TextEqual(bool padded, string a, string b)
    {
        if (options.TrimText)
        {
            a = a.Trim();
            b = b.Trim();
        }
        else if (padded)
        {
            a = a.TrimEnd(' ');
            b = b.TrimEnd(' ');
        }
        if (options.EmptyAsNull && (a.Length == 0 || b.Length == 0)) return a.Length == b.Length;
        return string.Equals(a, b, options.IgnoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }

    private static bool? JsonEqual(string a, string b)
    {
        if (string.Equals(a, b, StringComparison.Ordinal)) return true;
        try
        {
            return JsonNode.DeepEquals(JsonNode.Parse(a), JsonNode.Parse(b));
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
