using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;
using DbStudio.Core.Services;

namespace DbStudio.Federation.Engine;

/// <summary>Engine column storage classes (what <see cref="EngineValues.Convert"/> produces for an engine type).</summary>
internal enum StorageClass
{
    BigInt, HugeInt, Double, Decimal, Varchar, Boolean, Date, Time, Timestamp, TimestampTz, Uuid, Blob, Json,
}

/// <summary>
/// Converts the CLR values drivers return (and Core wire values: decimals as strings, <see cref="BinaryValue"/>,
/// <see cref="TruncatedValue"/>, ISO date strings) into the value an engine column of a given storage class stores.
/// A value that cannot be converted yields <c>false</c> (the appender stores NULL and counts a conversion failure).
/// </summary>
internal static class EngineValues
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>The storage class of an engine type text (BIGINT, DECIMAL(38,2), TIMESTAMPTZ…; SQLite fallback types too).</summary>
    public static StorageClass ClassOf(string engineType)
    {
        var t = engineType.Trim().ToUpperInvariant();
        var open = t.IndexOf('(');
        var head = open < 0 ? t : t[..open].Trim();
        return head switch
        {
            "BIGINT" or "INTEGER" or "INT" or "SMALLINT" or "TINYINT" => StorageClass.BigInt,
            "HUGEINT" => StorageClass.HugeInt,
            "DOUBLE" or "REAL" or "FLOAT" => StorageClass.Double,
            "DECIMAL" or "NUMERIC" => StorageClass.Decimal,
            "BOOLEAN" or "BOOL" => StorageClass.Boolean,
            "DATE" => StorageClass.Date,
            "TIME" => StorageClass.Time,
            "TIMESTAMP" or "DATETIME" => StorageClass.Timestamp,
            "TIMESTAMPTZ" or "TIMESTAMP WITH TIME ZONE" => StorageClass.TimestampTz,
            "UUID" => StorageClass.Uuid,
            "BLOB" or "BYTEA" => StorageClass.Blob,
            "JSON" => StorageClass.Json,
            _ => StorageClass.Varchar,
        };
    }

    /// <summary>Scale of a DECIMAL(p,s) engine type (0 when absent).</summary>
    public static int ScaleOf(string engineType)
    {
        var comma = engineType.IndexOf(',');
        var close = engineType.IndexOf(')');
        return comma > 0 && close > comma && int.TryParse(engineType[(comma + 1)..close].Trim(), NumberStyles.Integer, Inv, out var s) ? s : 0;
    }

    /// <summary>Converts <paramref name="value"/> (never null/DBNull) for <paramref name="target"/>. False when it cannot.</summary>
    public static bool Convert(object value, StorageClass target, out object? result)
    {
        result = null;
        value = Unwrap(value);
        try
        {
            switch (target)
            {
                case StorageClass.BigInt: return ToLong(value, out result);
                case StorageClass.HugeInt: return ToBigInteger(value, out result);
                case StorageClass.Double: return ToDouble(value, out result);
                case StorageClass.Decimal: return ToDecimal(value, out result);
                case StorageClass.Boolean: return ToBool(value, out result);
                case StorageClass.Date: return ToDate(value, out result);
                case StorageClass.Time: return ToTime(value, out result);
                case StorageClass.Timestamp: return ToTimestamp(value, out result);
                case StorageClass.TimestampTz: return ToTimestampTz(value, out result);
                case StorageClass.Uuid: return ToGuid(value, out result);
                case StorageClass.Blob: return ToBytes(value, out result);
                case StorageClass.Json: result = ToJsonText(value); return true;
                default: result = ToText(value); return true;
            }
        }
        catch (Exception e) when (e is FormatException or OverflowException or InvalidCastException or ArgumentException or IOException)
        {
            result = null;
            return false;
        }
    }

    private static object Unwrap(object value) => value switch
    {
        TruncatedValue t => t.Full,
        BinaryValue b => b.Full,
        JsonElement e => e.ValueKind switch
        {
            JsonValueKind.String => e.GetString() ?? "",
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDecimal(),
            _ => e.GetRawText(),
        },
        _ => value,
    };

    private static bool ToLong(object v, out object? r)
    {
        r = v switch
        {
            long l => l,
            int i => (long)i,
            short s => (long)s,
            sbyte sb => (long)sb,
            byte b => (long)b,
            ushort us => (long)us,
            uint ui => (long)ui,
            ulong ul => checked((long)ul),
            bool bo => bo ? 1L : 0L,
            decimal m when decimal.Truncate(m) == m => decimal.ToInt64(m),
            double d when Math.Floor(d) == d && d is >= long.MinValue and <= long.MaxValue => (long)d,
            float f when MathF.Floor(f) == f => (long)f,
            BigInteger bi => (long)bi,
            string s => ParseLong(s),
            char c => (long)c,
            _ => null,
        };
        return r is not null;
    }

    private static object? ParseLong(string s)
    {
        s = s.Trim();
        if (long.TryParse(s, NumberStyles.Integer, Inv, out var l)) return l;
        if (decimal.TryParse(s, NumberStyles.Float, Inv, out var m) && decimal.Truncate(m) == m) return decimal.ToInt64(m);
        if (bool.TryParse(s, out var b)) return b ? 1L : 0L;
        return null;
    }

    private static bool ToBigInteger(object v, out object? r)
    {
        r = v switch
        {
            BigInteger bi => bi,
            long l => new BigInteger(l),
            int i => new BigInteger(i),
            short s => new BigInteger(s),
            sbyte sb => new BigInteger(sb),
            byte b => new BigInteger(b),
            ushort us => new BigInteger(us),
            uint ui => new BigInteger(ui),
            ulong ul => new BigInteger(ul),
            Int128 i128 => (BigInteger)i128,
            UInt128 u128 => (BigInteger)u128,
            bool bo => bo ? BigInteger.One : BigInteger.Zero,
            decimal m when decimal.Truncate(m) == m => new BigInteger(m),
            double d when Math.Floor(d) == d && double.IsFinite(d) => new BigInteger(d),
            string s => BigInteger.TryParse(s.Trim(), NumberStyles.Integer, Inv, out var p) ? p
                : decimal.TryParse(s.Trim(), NumberStyles.Float, Inv, out var m2) && decimal.Truncate(m2) == m2 ? new BigInteger(m2) : null,
            _ => null,
        };
        if (r is BigInteger x && (x > HugeIntMax || x < HugeIntMin)) r = null;
        return r is not null;
    }

    private static readonly BigInteger HugeIntMax = BigInteger.Pow(2, 127) - 1;
    private static readonly BigInteger HugeIntMin = -BigInteger.Pow(2, 127);

    private static bool ToDouble(object v, out object? r)
    {
        r = v switch
        {
            double d => d,
            float f => double.Parse(f.ToString("R", Inv), Inv),
            Half h => (double)h,
            decimal m => (double)m,
            long l => (double)l,
            int i => (double)i,
            short s => (double)s,
            sbyte sb => (double)sb,
            byte b => (double)b,
            ushort us => (double)us,
            uint ui => (double)ui,
            ulong ul => (double)ul,
            BigInteger bi => (double)bi,
            bool bo => bo ? 1d : 0d,
            string s => ParseDouble(s),
            _ => null,
        };
        return r is not null;
    }

    private static object? ParseDouble(string s)
    {
        s = s.Trim();
        if (double.TryParse(s, NumberStyles.Float, Inv, out var d)) return d;
        return s switch
        {
            "NaN" => double.NaN,
            "Infinity" or "inf" or "+Infinity" => double.PositiveInfinity,
            "-Infinity" or "-inf" => double.NegativeInfinity,
            _ => null,
        };
    }

    private static bool ToDecimal(object v, out object? r)
    {
        r = v switch
        {
            decimal m => m,
            long l => (decimal)l,
            int i => (decimal)i,
            short s => (decimal)s,
            sbyte sb => (decimal)sb,
            byte b => (decimal)b,
            ushort us => (decimal)us,
            uint ui => (decimal)ui,
            ulong ul => (decimal)ul,
            BigInteger bi => (decimal)bi,
            double d when double.IsFinite(d) => (decimal)d,
            float f when float.IsFinite(f) => decimal.Parse(f.ToString("R", Inv), NumberStyles.Float, Inv),
            bool bo => bo ? 1m : 0m,
            string s => decimal.TryParse(s.Trim(), NumberStyles.Float, Inv, out var p) ? p : null,
            _ => decimal.TryParse(System.Convert.ToString(v, Inv), NumberStyles.Float, Inv, out var q) ? q : null,
        };
        return r is not null;
    }

    private static bool ToBool(object v, out object? r)
    {
        r = v switch
        {
            bool b => b,
            long l => l != 0,
            int i => i != 0,
            short s => s != 0,
            sbyte sb => sb != 0,
            byte b => b != 0,
            ushort us => us != 0,
            uint ui => ui != 0,
            ulong ul => ul != 0,
            decimal m => m != 0,
            double d => d != 0,
            string s => ParseBool(s),
            _ => null,
        };
        return r is not null;
    }

    private static object? ParseBool(string s) => s.Trim().ToLowerInvariant() switch
    {
        "true" or "t" or "1" or "y" or "yes" or "on" => true,
        "false" or "f" or "0" or "n" or "no" or "off" => false,
        _ => null,
    };

    private static readonly string[] DateFormats = ["yyyy-MM-dd", "yyyyMMdd", "yyyy-M-d"];

    private static bool ToDate(object v, out object? r)
    {
        r = v switch
        {
            DateOnly d => d,
            DateTime dt => DateOnly.FromDateTime(dt),
            DateTimeOffset dto => DateOnly.FromDateTime(dto.DateTime),
            string s => ParseDate(s),
            _ => ParseDate(System.Convert.ToString(v, Inv) ?? ""),
        };
        return r is not null;
    }

    private static object? ParseDate(string s)
    {
        s = s.Trim();
        if (DateOnly.TryParseExact(s, DateFormats, Inv, DateTimeStyles.None, out var d)) return d;
        if (ParseDateTime(s) is DateTime dt) return DateOnly.FromDateTime(dt);
        return null;
    }

    private static bool ToTime(object v, out object? r)
    {
        r = v switch
        {
            TimeOnly t => t,
            TimeSpan ts when ts >= TimeSpan.Zero && ts < TimeSpan.FromDays(1) => TimeOnly.FromTimeSpan(ts),
            DateTime dt => TimeOnly.FromDateTime(dt),
            DateTimeOffset dto => TimeOnly.FromDateTime(dto.DateTime),
            long nanosOrTicks => TimeOnly.FromTimeSpan(TimeSpan.FromTicks(nanosOrTicks / 100)),
            string s => TimeOnly.TryParse(s.Trim(), Inv, DateTimeStyles.None, out var t) ? t
                : TimeSpan.TryParse(s.Trim(), Inv, out var ts2) && ts2 >= TimeSpan.Zero && ts2 < TimeSpan.FromDays(1) ? TimeOnly.FromTimeSpan(ts2) : null,
            _ => TimeOnly.TryParse(System.Convert.ToString(v, Inv), Inv, DateTimeStyles.None, out var t2) ? t2 : null,
        };
        return r is not null;
    }

    private static bool ToTimestamp(object v, out object? r)
    {
        r = v switch
        {
            DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Unspecified),
            DateTimeOffset dto => DateTime.SpecifyKind(dto.DateTime, DateTimeKind.Unspecified),
            DateOnly d => d.ToDateTime(TimeOnly.MinValue),
            string s => ParseDateTime(s),
            _ => ParseDateTime(System.Convert.ToString(v, Inv) ?? ""),
        };
        return r is not null;
    }

    private static object? ParseDateTime(string s)
    {
        s = s.Trim();
        if (s.Length == 0) return null;
        return DateTime.TryParse(s, Inv, DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.RoundtripKind, out var dt)
            ? DateTime.SpecifyKind(dt.Kind == DateTimeKind.Local ? dt.ToUniversalTime() : dt, DateTimeKind.Unspecified)
            : null;
    }

    private static bool ToTimestampTz(object v, out object? r)
    {
        r = v switch
        {
            DateTimeOffset dto => dto.ToUniversalTime(),
            // a driver DateTime without offset: Utc as is, Local converted, Unspecified taken as UTC (documented)
            DateTime dt => new DateTimeOffset(dt.Kind == DateTimeKind.Local ? dt.ToUniversalTime() : DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
            DateOnly d => new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero),
            string s => DateTimeOffset.TryParse(s.Trim(), Inv, DateTimeStyles.AssumeUniversal, out var p) ? p.ToUniversalTime() : null,
            _ => DateTimeOffset.TryParse(System.Convert.ToString(v, Inv), Inv, DateTimeStyles.AssumeUniversal, out var q) ? q.ToUniversalTime() : null,
        };
        return r is not null;
    }

    private static bool ToGuid(object v, out object? r)
    {
        r = v switch
        {
            Guid g => g,
            byte[] { Length: 16 } b => new Guid(b),
            string s => Guid.TryParse(s.Trim(), out var g2) ? g2 : null,
            _ => Guid.TryParse(System.Convert.ToString(v, Inv), out var g3) ? g3 : null,
        };
        return r is not null;
    }

    private static bool ToBytes(object v, out object? r)
    {
        switch (v)
        {
            case byte[] b:
                r = b;
                return true;
            case Stream st:
            {
                using var ms = new MemoryStream();
                st.CopyTo(ms);
                r = ms.ToArray();
                return true;
            }
            case string s:
                r = Encoding.UTF8.GetBytes(s);
                return true;
            case ReadOnlyMemory<byte> rom:
                r = rom.ToArray();
                return true;
            case Memory<byte> mem:
                r = mem.ToArray();
                return true;
            default:
                r = null;
                return false;
        }
    }

    /// <summary>Invariant text of any value (VARCHAR columns, xml/other kinds).</summary>
    public static string ToText(object v) => v switch
    {
        string s => s,
        char c => c.ToString(),
        bool b => b ? "true" : "false",
        double d => d.ToString("R", Inv),
        float f => f.ToString("R", Inv),
        DateTime dt => ValueConverter.FormatDateTime(dt),
        DateTimeOffset dto => dto.ToString(ValueConverter.DateTimeOffsetFormat, Inv),
        DateOnly d => d.ToString(ValueConverter.DateFormat, Inv),
        TimeOnly t => t.ToString(ValueConverter.TimeFormat, Inv),
        TimeSpan ts => ValueConverter.FormatTimeSpan(ts),
        Guid g => g.ToString("D"),
        byte[] bytes => "0x" + System.Convert.ToHexString(bytes),
        IFormattable fo => fo.ToString(null, Inv),
        System.Collections.IEnumerable e and not string => SerializeEnumerable(e),
        _ => v.ToString() ?? "",
    };

    private static string ToJsonText(object v) => v switch
    {
        string s => s,
        System.Text.Json.Nodes.JsonNode n => n.ToJsonString(),
        System.Collections.IEnumerable e and not byte[] => SerializeEnumerable(e),
        _ => ToText(v),
    };

    private static string SerializeEnumerable(System.Collections.IEnumerable e)
    {
        try
        {
            return JsonSerializer.Serialize(e, e.GetType(), CoreJson.Options);
        }
        catch (Exception ex) when (ex is NotSupportedException or InvalidOperationException or JsonException)
        {
            return e.ToString() ?? "";
        }
    }
}
