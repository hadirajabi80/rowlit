using System.Buffers.Binary;
using System.Globalization;
using System.Net;
using System.Text;
using Npgsql;
using NpgsqlTypes;
using Npgsql.PostgresTypes;

namespace DbStudio.Providers.PostgreSql;

/// <summary>
/// Renders the binary wire value of a column in PostgreSQL's own text output form, driven by the column's
/// <see cref="PostgresType"/> tree (arrays, domains, composites, ranges, multiranges). Used for the values Npgsql's CLR
/// mapping cannot carry without loss: arrays with NULL elements, composites and records, numerics beyond
/// <see cref="decimal"/> (and NaN / ±Infinity), infinite or out-of-range dates and timestamps, inet masks, MAC
/// addresses and ranges (which Npgsql formats with the current culture). Unknown base types throw
/// <see cref="NotSupportedException"/> so the caller can fall back.
/// </summary>
public static class PgBinaryText
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>The text form of the current cell of <paramref name="reader"/>.</summary>
    public static string Read(NpgsqlDataReader reader, int ordinal)
    {
        var type = reader.GetPostgresType(ordinal);
        using var stream = reader.GetStream(ordinal);
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        return Decode(type, ms.ToArray());
    }

    public static string Decode(PostgresType? type, ReadOnlySpan<byte> data)
    {
        switch (type)
        {
            case PostgresDomainType domain:
                return Decode(domain.BaseType, data);
            case PostgresArrayType array:
                return DecodeArray(array.Element, data);
            case PostgresCompositeType composite:
                return DecodeComposite(composite, data);
            case PostgresEnumType:
                return Encoding.UTF8.GetString(data);
            case PostgresRangeType range:
                return DecodeRange(range.Subtype, data);
            case PostgresMultirangeType multi:
                return DecodeMultirange(multi.Subrange.Subtype, data);
            case UnknownBackendType:
                // Npgsql loads the type catalog when the first connection of a connection string opens: a composite created
                // afterwards is unknown, but its wire value names the OID of every field, so builtin field types still decode.
                return DecodeRecord(data);
            case null:
                throw new NotSupportedException("Unknown type.");
        }
        return DecodeBase(type.OID, type.Name, data);
    }

    // OIDs of the builtin types a record's fields (or an anonymous array) can carry.
    private static string DecodeByOid(uint oid, ReadOnlySpan<byte> data) => DecodeBase(oid, null, data);

    private static string DecodeBase(uint oid, string? name, ReadOnlySpan<byte> d)
    {
        switch (oid)
        {
            case 16: return d[0] != 0 ? "t" : "f";
            case 17: return "\\x" + Convert.ToHexStringLower(d);
            case 18: return ((char)d[0]).ToString();
            case 19 or 25 or 114 or 142 or 1042 or 1043 or 705 or 1790:
                return Encoding.UTF8.GetString(d);
            case 20: return BinaryPrimitives.ReadInt64BigEndian(d).ToString(Inv);
            case 21: return BinaryPrimitives.ReadInt16BigEndian(d).ToString(Inv);
            case 23: return BinaryPrimitives.ReadInt32BigEndian(d).ToString(Inv);
            case 26 or 28 or 29 or 2205 or 2206 or 24 or 2202 or 2203 or 2204 or 2201 or 4089 or 4096 or 4097 or 3734 or 3769 or 4191:
                return BinaryPrimitives.ReadUInt32BigEndian(d).ToString(Inv);
            case 700: return Float(BinaryPrimitives.ReadSingleBigEndian(d), single: true);
            case 701: return Float(BinaryPrimitives.ReadDoubleBigEndian(d), single: false);
            case 790: return (BinaryPrimitives.ReadInt64BigEndian(d) / 100m).ToString("0.00", Inv);
            case 869 or 650: return Inet(d);
            case 829: return Mac(d, 6);
            case 774: return Mac(d, 8);
            case 1082: return Date(BinaryPrimitives.ReadInt32BigEndian(d));
            case 1083: return TimeOfDay(BinaryPrimitives.ReadInt64BigEndian(d));
            case 1114: return Timestamp(BinaryPrimitives.ReadInt64BigEndian(d), withZone: false);
            case 1184: return Timestamp(BinaryPrimitives.ReadInt64BigEndian(d), withZone: true);
            case 1186:
                return PgTypes.IntervalText(new NpgsqlInterval(BinaryPrimitives.ReadInt32BigEndian(d[12..]), BinaryPrimitives.ReadInt32BigEndian(d[8..]),
                    BinaryPrimitives.ReadInt64BigEndian(d)));
            case 1266: return TimeOfDay(BinaryPrimitives.ReadInt64BigEndian(d)) + Zone(BinaryPrimitives.ReadInt32BigEndian(d[8..]));
            case 1560 or 1562: return Bits(d);
            case 1700: return Numeric(d);
            case 2950: return new Guid(d[..16], bigEndian: true).ToString("D");
            case 3802: return Encoding.UTF8.GetString(d[1..]);
            case 600: return $"({Float(BinaryPrimitives.ReadDoubleBigEndian(d), false)},{Float(BinaryPrimitives.ReadDoubleBigEndian(d[8..]), false)})";
            case 2249:
                return DecodeRecord(d);
        }
        if (BuiltinArrays.Contains(oid)) return DecodeArray(null, d);
        throw new NotSupportedException($"Binary decoding of {name ?? oid.ToString(Inv)} is not supported.");
    }

    // bool[], bytea[], char[], name[], int2[], int4[], text[], oid[], bpchar[], varchar[], int8[], point[], float4[], float8[], money[],
    // inet[], cidr[], macaddr[], date[], time[], timestamp[], timestamptz[], interval[], timetz[], bit[], varbit[], numeric[], uuid[], json[], jsonb[], xml[]
    private static readonly HashSet<uint> BuiltinArrays =
    [
        1000, 1001, 1002, 1003, 1005, 1007, 1009, 1028, 1014, 1015, 1016, 1017, 1021, 1022, 791, 1041, 651, 1040, 1182, 1183, 1115, 1185, 1187, 1270,
        1561, 1563, 1231, 2951, 199, 3807, 143,
    ];

    private static string Float(double v, bool single)
    {
        if (double.IsNaN(v)) return "NaN";
        if (double.IsPositiveInfinity(v)) return "Infinity";
        if (double.IsNegativeInfinity(v)) return "-Infinity";
        return single ? ((float)v).ToString("R", Inv) : v.ToString("R", Inv);
    }

    // ------------------------------------------------------------------ numeric

    /// <summary>Exact decimal text of a binary numeric: base-10000 digits, weight, sign, display scale (NaN / ±Infinity included).</summary>
    public static string Numeric(ReadOnlySpan<byte> d)
    {
        int ndigits = BinaryPrimitives.ReadInt16BigEndian(d);
        int weight = BinaryPrimitives.ReadInt16BigEndian(d[2..]);
        var sign = BinaryPrimitives.ReadUInt16BigEndian(d[4..]);
        int dscale = BinaryPrimitives.ReadInt16BigEndian(d[6..]);
        switch (sign)
        {
            case 0xC000: return "NaN";
            case 0xD000: return "Infinity";
            case 0xF000: return "-Infinity";
        }
        static int Digit(ReadOnlySpan<byte> d, int ndigits, int i) => i >= 0 && i < ndigits ? BinaryPrimitives.ReadInt16BigEndian(d[(8 + 2 * i)..]) : 0;
        var sb = new StringBuilder();
        if (sign == 0x4000) sb.Append('-');
        if (weight < 0) sb.Append('0');
        else
        {
            for (var i = 0; i <= weight; i++)
            {
                var v = Digit(d, ndigits, i);
                sb.Append(i == 0 ? v.ToString(Inv) : v.ToString("D4", Inv));
            }
        }
        if (dscale > 0)
        {
            sb.Append('.');
            var frac = new StringBuilder();
            for (var i = weight + 1; frac.Length < dscale; i++) frac.Append(Digit(d, ndigits, i).ToString("D4", Inv));
            sb.Append(frac.ToString(0, dscale));
        }
        return sb.ToString();
    }

    // ------------------------------------------------------------------ date / time

    /// <summary>Days since 2000-01-01 → "yyyy-MM-dd" (years above 9999 keep all digits, BC years end in " BC", ±infinity).</summary>
    public static string Date(int days)
    {
        if (days == int.MaxValue) return "infinity";
        if (days == int.MinValue) return "-infinity";
        var (y, m, d) = Civil(days + 10957L); // days from 1970-01-01
        return YearText(y) + "-" + m.ToString("00", Inv) + "-" + d.ToString("00", Inv) + (y <= 0 ? " BC" : "");
    }

    private static string YearText(long astronomicalYear) => (astronomicalYear <= 0 ? 1 - astronomicalYear : astronomicalYear).ToString("0000", Inv);

    /// <summary>Howard Hinnant's civil_from_days over the proleptic Gregorian calendar (astronomical year numbering).</summary>
    private static (long Year, int Month, int Day) Civil(long daysSinceUnixEpoch)
    {
        var z = daysSinceUnixEpoch + 719468;
        var era = (z >= 0 ? z : z - 146096) / 146097;
        var doe = z - era * 146097;
        var yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        var y = yoe + era * 400;
        var doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        var mp = (5 * doy + 2) / 153;
        var day = (int)(doy - (153 * mp + 2) / 5 + 1);
        var month = (int)(mp < 10 ? mp + 3 : mp - 9);
        return (month <= 2 ? y + 1 : y, month, day);
    }

    public static string TimeOfDay(long micros)
    {
        var total = micros / 1_000_000;
        var frac = micros % 1_000_000;
        var text = $"{total / 3600:00}:{total / 60 % 60:00}:{total % 60:00}";
        return frac == 0 ? text : text + "." + frac.ToString("000000", Inv).TrimEnd('0');
    }

    /// <summary>"+05", "-03:30": the zone of a timetz value (stored as seconds WEST of UTC).</summary>
    private static string Zone(int secondsWest)
    {
        var east = -secondsWest;
        var sign = east < 0 ? '-' : '+';
        east = Math.Abs(east);
        var text = sign + (east / 3600).ToString("00", Inv);
        if (east % 3600 != 0) text += ":" + (east / 60 % 60).ToString("00", Inv);
        if (east % 60 != 0) text += ":" + (east % 60).ToString("00", Inv);
        return text;
    }

    /// <summary>Microseconds since 2000-01-01 → "yyyy-MM-dd HH:mm:ss[.ffffff]" (UTC for timestamptz, with "+00").</summary>
    public static string Timestamp(long micros, bool withZone)
    {
        if (micros == long.MaxValue) return "infinity";
        if (micros == long.MinValue) return "-infinity";
        var days = Math.DivRem(micros, 86_400_000_000L, out var rem);
        if (rem < 0) { rem += 86_400_000_000L; days--; }
        var text = Date(checked((int)days)) + " " + TimeOfDay(rem);
        // The " BC" marker goes last in PostgreSQL's output ("0001-01-01 10:00:00 BC").
        var bc = text.Contains(" BC ", StringComparison.Ordinal);
        if (bc) text = text.Replace(" BC ", " ", StringComparison.Ordinal);
        return text + (withZone ? "+00" : "") + (bc ? " BC" : "");
    }

    // ------------------------------------------------------------------ network / bits

    private static string Inet(ReadOnlySpan<byte> d)
    {
        var family = d[0];
        int bits = d[1];
        var isCidr = d[2] != 0;
        int n = d[3];
        var address = new IPAddress(d.Slice(4, n)).ToString();
        var full = family == 2 ? 32 : 128;
        return isCidr || bits != full ? address + "/" + bits.ToString(Inv) : address;
    }

    private static string Mac(ReadOnlySpan<byte> d, int length)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < length; i++)
        {
            if (i > 0) sb.Append(':');
            sb.Append(d[i].ToString("x2", Inv));
        }
        return sb.ToString();
    }

    private static string Bits(ReadOnlySpan<byte> d)
    {
        var count = BinaryPrimitives.ReadInt32BigEndian(d);
        var sb = new StringBuilder(count);
        for (var i = 0; i < count; i++) sb.Append((d[4 + i / 8] & (0x80 >> (i % 8))) != 0 ? '1' : '0');
        return sb.ToString();
    }

    // ------------------------------------------------------------------ arrays, composites, ranges

    private static string DecodeArray(PostgresType? element, ReadOnlySpan<byte> d)
    {
        var ndim = BinaryPrimitives.ReadInt32BigEndian(d);
        var elementOid = BinaryPrimitives.ReadUInt32BigEndian(d[8..]);
        var offset = 12;
        if (ndim == 0) return "{}";
        var lengths = new int[ndim];
        var lowers = new int[ndim];
        for (var i = 0; i < ndim; i++)
        {
            lengths[i] = BinaryPrimitives.ReadInt32BigEndian(d[offset..]);
            lowers[i] = BinaryPrimitives.ReadInt32BigEndian(d[(offset + 4)..]);
            offset += 8;
        }
        var sb = new StringBuilder();
        if (lowers.Any(l => l != 1))
        {
            for (var i = 0; i < ndim; i++) sb.Append('[').Append(lowers[i].ToString(Inv)).Append(':').Append((lowers[i] + lengths[i] - 1).ToString(Inv)).Append(']');
            sb.Append('=');
        }
        AppendDimension(sb, element, elementOid, d, ref offset, lengths, 0);
        return sb.ToString();
    }

    private static void AppendDimension(StringBuilder sb, PostgresType? element, uint elementOid, ReadOnlySpan<byte> d, ref int offset, int[] lengths, int dim)
    {
        sb.Append('{');
        for (var i = 0; i < lengths[dim]; i++)
        {
            if (i > 0) sb.Append(',');
            if (dim < lengths.Length - 1)
            {
                AppendDimension(sb, element, elementOid, d, ref offset, lengths, dim + 1);
                continue;
            }
            var len = BinaryPrimitives.ReadInt32BigEndian(d[offset..]);
            offset += 4;
            if (len < 0) { sb.Append("NULL"); continue; }
            sb.Append(Quote(element is null ? DecodeByOid(elementOid, d.Slice(offset, len)) : Decode(element, d.Slice(offset, len)), "{},\"\\", arrayStyle: true));
            offset += len;
        }
        sb.Append('}');
    }

    private static string DecodeComposite(PostgresCompositeType type, ReadOnlySpan<byte> d)
    {
        var count = BinaryPrimitives.ReadInt32BigEndian(d);
        var offset = 4;
        var sb = new StringBuilder("(");
        for (var i = 0; i < count; i++)
        {
            if (i > 0) sb.Append(',');
            offset += 4; // field type oid
            var len = BinaryPrimitives.ReadInt32BigEndian(d[offset..]);
            offset += 4;
            if (len < 0) continue; // NULL is the empty, unquoted field
            var fieldType = i < type.Fields.Count ? type.Fields[i].Type : null;
            var oid = BinaryPrimitives.ReadUInt32BigEndian(d[(offset - 8)..]);
            var text = fieldType is not null ? Decode(fieldType, d.Slice(offset, len)) : DecodeByOid(oid, d.Slice(offset, len));
            sb.Append(Quote(text, "(),\"\\", arrayStyle: false));
            offset += len;
        }
        return sb.Append(')').ToString();
    }

    /// <summary>An anonymous record (<c>ROW(1,'a')</c>): fields are typed by the OID in the stream, builtin types only.</summary>
    private static string DecodeRecord(ReadOnlySpan<byte> d)
    {
        var count = BinaryPrimitives.ReadInt32BigEndian(d);
        var offset = 4;
        var sb = new StringBuilder("(");
        for (var i = 0; i < count; i++)
        {
            if (i > 0) sb.Append(',');
            var oid = BinaryPrimitives.ReadUInt32BigEndian(d[offset..]);
            var len = BinaryPrimitives.ReadInt32BigEndian(d[(offset + 4)..]);
            offset += 8;
            if (len < 0) continue;
            sb.Append(Quote(DecodeByOid(oid, d.Slice(offset, len)), "(),\"\\", arrayStyle: false));
            offset += len;
        }
        if (offset != d.Length) throw new NotSupportedException("Not a record value.");
        return sb.Append(')').ToString();
    }

    private static string DecodeRange(PostgresType subtype, ReadOnlySpan<byte> d)
    {
        var flags = d[0];
        if ((flags & 0x01) != 0) return "empty";
        var offset = 1;
        string? lower = null, upper = null;
        if ((flags & 0x28) == 0) lower = RangeBound(subtype, d, ref offset); // neither infinite (0x08) nor NULL (0x20)
        if ((flags & 0x50) == 0) upper = RangeBound(subtype, d, ref offset);
        var sb = new StringBuilder();
        sb.Append((flags & 0x02) != 0 ? '[' : '(');
        if (lower is not null) sb.Append(Quote(lower, "(),[]\"\\", arrayStyle: false));
        sb.Append(',');
        if (upper is not null) sb.Append(Quote(upper, "(),[]\"\\", arrayStyle: false));
        sb.Append((flags & 0x04) != 0 ? ']' : ')');
        return sb.ToString();
    }

    private static string RangeBound(PostgresType subtype, ReadOnlySpan<byte> d, ref int offset)
    {
        var len = BinaryPrimitives.ReadInt32BigEndian(d[offset..]);
        offset += 4;
        var text = Decode(subtype, d.Slice(offset, len));
        offset += len;
        return text;
    }

    private static string DecodeMultirange(PostgresType subtype, ReadOnlySpan<byte> d)
    {
        var count = BinaryPrimitives.ReadInt32BigEndian(d);
        var offset = 4;
        var sb = new StringBuilder("{");
        for (var i = 0; i < count; i++)
        {
            if (i > 0) sb.Append(',');
            var len = BinaryPrimitives.ReadInt32BigEndian(d[offset..]);
            offset += 4;
            sb.Append(DecodeRange(subtype, d.Slice(offset, len)));
            offset += len;
        }
        return sb.Append('}').ToString();
    }

    /// <summary>array_out / record_out / range_out quoting: empty, special characters or whitespace (and NULL in arrays) are double-quoted.</summary>
    private static string Quote(string text, string specials, bool arrayStyle)
    {
        var needs = text.Length == 0 || (arrayStyle && text.Equals("NULL", StringComparison.OrdinalIgnoreCase))
                    || text.Any(ch => specials.Contains(ch) || char.IsWhiteSpace(ch));
        if (!needs) return text;
        // array_out escapes with a backslash; record_out and range_out double the quote and the backslash.
        return arrayStyle
            ? "\"" + text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\""
            : "\"" + text.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }
}
