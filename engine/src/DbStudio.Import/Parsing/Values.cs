using System.Globalization;
using System.Text;

namespace DbStudio.Import.Parsing;

/// <summary>Kind tokens shared with the UI (types.ts InferredKind / TargetKind).</summary>
public static class Kinds
{
    public const string Empty = "empty", Bool = "bool", Int = "int", BigInt = "bigint", Decimal = "decimal", Float = "float",
        Date = "date", DateTime = "datetime", Time = "time", Guid = "guid", Text = "text", Binary = "binary", Json = "json", Other = "other";
}

/// <summary>Inferred type of a source column (wire: InferredType).</summary>
public sealed record InferredType(string Kind, int? Length = null, int? Precision = null, int? Scale = null, bool Nullable = true);

/// <summary>A value that cannot be converted to the target type (the message names the problem).</summary>
public sealed class ValueConversionException(string message) : Exception(message);

/// <summary>Number and date parsing under the wizard's options (separators, formats, Persian / Arabic-Indic digits).</summary>
public sealed class ValueParser
{
    private static readonly string[] IsoDateTime =
    [
        "yyyy-MM-dd", "yyyy-MM-ddTHH:mm:ss", "yyyy-MM-ddTHH:mm:ss.FFFFFFF", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm:ss.FFFFFFF",
        "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mm", "yyyy/MM/dd", "yyyy/MM/dd HH:mm:ss", "yyyy/MM/dd HH:mm",
        "M/d/yyyy", "MM/dd/yyyy", "M/d/yyyy H:mm", "M/d/yyyy H:mm:ss", "MM/dd/yyyy HH:mm:ss", "MM/dd/yyyy HH:mm",
        "M/d/yyyy h:mm:ss tt", "M/d/yyyy h:mm tt",
    ];

    private static readonly string[] IsoOffset =
    [
        "yyyy-MM-ddTHH:mm:ssK", "yyyy-MM-ddTHH:mm:ss.FFFFFFFK", "yyyy-MM-dd HH:mm:ssK", "yyyy-MM-dd HH:mm:ss.FFFFFFFK",
    ];

    private static readonly string[] TimeFormats =
    [
        @"h\:mm", @"hh\:mm", @"h\:mm\:ss", @"hh\:mm\:ss", @"h\:mm\:ss\.FFFFFFF", @"hh\:mm\:ss\.FFFFFFF",
    ];

    private readonly string[] _userFormats;
    private readonly bool _digits;
    private readonly char _decimal;
    private readonly string _thousands;

    public ValueParser(SourceOptions o)
    {
        _userFormats = (o.DateFormats ?? []).Where(f => !string.IsNullOrWhiteSpace(f)).Select(f => f.Trim()).ToArray();
        _digits = o.Digits;
        _decimal = string.IsNullOrEmpty(o.DecimalSeparator) ? '.' : o.DecimalSeparator![0];
        _thousands = o.ThousandsSeparator ?? "";
    }

    /// <summary>Persian (U+06F0..) and Arabic-Indic (U+0660..) digits and separators to ASCII.</summary>
    public static string NormalizeDigits(string s)
    {
        var needs = false;
        foreach (var c in s) if (c >= '٠' && c <= '۹' || c is '٫' or '٬' or '،') { needs = true; break; }
        if (!needs) return s;
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            if (c >= '٠' && c <= '٩') sb.Append((char)('0' + (c - '٠')));
            else if (c >= '۰' && c <= '۹') sb.Append((char)('0' + (c - '۰')));
            else if (c == '٫') sb.Append('.');
            else if (c == '٬' || c == '،') sb.Append(',');
            else sb.Append(c);
        }
        return sb.ToString();
    }

    private string Prepare(string s)
    {
        s = s.Trim();
        if (_digits) s = NormalizeDigits(s);
        return s;
    }

    /// <summary>Canonical invariant number text ("1234.5") from the user's separators, or null when it is not a plain number.</summary>
    public string? CanonicalNumber(string raw, bool allowExponent)
    {
        var s = Prepare(raw);
        if (s.Length == 0) return null;
        if (_thousands.Length > 0 && _thousands != _decimal.ToString())
            s = s.Replace(_thousands, "", StringComparison.Ordinal);
        if (_decimal != '.')
        {
            if (s.Contains('.')) return null;
            s = s.Replace(_decimal, '.');
        }
        var i = 0;
        if (s[0] is '+' or '-') i++;
        var digits = 0;
        var dots = 0;
        var exp = false;
        for (; i < s.Length; i++)
        {
            var c = s[i];
            if (c is >= '0' and <= '9') digits++;
            else if (c == '.' && dots++ == 0 && !exp) { }
            else if (allowExponent && (c is 'e' or 'E') && !exp && digits > 0) { exp = true; if (i + 1 < s.Length && s[i + 1] is '+' or '-') i++; if (i + 1 >= s.Length) return null; }
            else return null;
        }
        return digits == 0 ? null : s;
    }

    public bool TryParseLong(string raw, out long value, bool strictLeadingZeros = false)
    {
        value = 0;
        var c = CanonicalNumber(raw, false);
        if (c is null) return false;
        if (c.Contains('.'))
        {
            if (!decimal.TryParse(c, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var d) || d != decimal.Truncate(d)) return false;
            if (d < long.MinValue || d > long.MaxValue) return false;
            value = (long)d;
            return true;
        }
        if (strictLeadingZeros && HasLeadingZero(c)) return false;
        return long.TryParse(c, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out value);
    }

    public static bool HasLeadingZero(string canonical)
    {
        var t = canonical.TrimStart('+', '-');
        return t.Length > 1 && t[0] == '0' && t[1] != '.';
    }

    public bool TryParseDecimal(string raw, out decimal value, out int intDigits, out int scale)
    {
        value = 0; intDigits = 0; scale = 0;
        var c = CanonicalNumber(raw, false);
        if (c is null || !decimal.TryParse(c, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value)) return false;
        var t = c.TrimStart('+', '-');
        var dot = t.IndexOf('.');
        var ip = dot < 0 ? t : t[..dot];
        intDigits = ip.TrimStart('0').Length;
        scale = dot < 0 ? 0 : t.Length - dot - 1;
        return true;
    }

    public bool TryParseDouble(string raw, out double value)
    {
        value = 0;
        var c = CanonicalNumber(raw, true);
        return c is not null && double.TryParse(c, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && double.IsFinite(value);
    }

    /// <summary>Parses a date or date-time; <paramref name="hasTime"/> tells whether the text carried a time of day.</summary>
    public bool TryParseDateTime(string raw, out DateTime value, out bool hasTime)
    {
        value = default;
        hasTime = false;
        var s = Prepare(raw);
        if (s.Length < 6) return false;
        if (_userFormats.Length > 0 &&
            DateTime.TryParseExact(s, _userFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out value))
        {
            hasTime = value.TimeOfDay != TimeSpan.Zero || _userFormats.Any(f => f.Contains('H') || f.Contains('h'));
            return true;
        }
        if (DateTime.TryParseExact(s, IsoDateTime, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out value))
        {
            hasTime = s.Length > 10 || value.TimeOfDay != TimeSpan.Zero;
            return true;
        }
        if ((s.EndsWith('Z') || s.Length > 19) &&
            DateTimeOffset.TryParseExact(s, IsoOffset, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var dto))
        {
            value = DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Unspecified);
            hasTime = true;
            return true;
        }
        return false;
    }

    public bool TryParseTime(string raw, out TimeSpan value)
    {
        var s = Prepare(raw);
        return TimeSpan.TryParseExact(s, TimeFormats, CultureInfo.InvariantCulture, out value) && value >= TimeSpan.Zero && value < TimeSpan.FromDays(1);
    }

    public static bool TryParseBool(string raw, out bool value)
    {
        switch (raw.Trim().ToLowerInvariant())
        {
            case "true" or "yes" or "y" or "t" or "1" or "on": value = true; return true;
            case "false" or "no" or "n" or "f" or "0" or "off": value = false; return true;
        }
        value = false;
        return false;
    }
}

/// <summary>Accumulates statistics over the values of one column and decides its type.</summary>
public sealed class ColumnProfiler(ValueParser parser)
{
    private long _count;
    private bool _nullable;
    private bool _bool = true, _int = true, _dec = true, _float = true, _date = true, _datetime = true, _time = true, _guid = true;
    private bool _sawDateOnly, _sawDateTime;
    private int _maxLen, _maxIntDigits, _maxScale;
    private long _maxAbs;

    public void Add(object? v)
    {
        if (v is null || v is string { Length: 0 }) { _nullable = true; return; }
        _count++;
        switch (v)
        {
            case bool:
                _int = _dec = _float = _date = _datetime = _time = _guid = false;
                _maxLen = Math.Max(_maxLen, 5);
                return;
            case long l:
                _bool = _date = _datetime = _time = _guid = false;
                _maxAbs = Math.Max(_maxAbs, Math.Abs(l == long.MinValue ? long.MaxValue : l));
                var digits = Math.Abs((decimal)l).ToString(CultureInfo.InvariantCulture).Length;
                _maxIntDigits = Math.Max(_maxIntDigits, digits);
                _maxLen = Math.Max(_maxLen, l.ToString(CultureInfo.InvariantCulture).Length);
                return;
            case decimal d:
                _bool = _int = _date = _datetime = _time = _guid = false;
                var s = d.ToString(CultureInfo.InvariantCulture);
                var dot = s.IndexOf('.');
                _maxScale = Math.Max(_maxScale, dot < 0 ? 0 : s.Length - dot - 1);
                _maxIntDigits = Math.Max(_maxIntDigits, (dot < 0 ? s : s[..dot]).TrimStart('-', '0').Length);
                _maxLen = Math.Max(_maxLen, s.Length);
                return;
            case double db:
                _bool = _int = _dec = _date = _datetime = _time = _guid = false;
                _maxLen = Math.Max(_maxLen, db.ToString(CultureInfo.InvariantCulture).Length);
                return;
            case DateTime dt:
                _bool = _int = _dec = _float = _time = _guid = false;
                if (dt.TimeOfDay == TimeSpan.Zero) _sawDateOnly = true; else { _sawDateTime = true; _date = false; }
                _maxLen = Math.Max(_maxLen, 19);
                return;
            case TimeSpan:
                _bool = _int = _dec = _float = _date = _datetime = _guid = false;
                _maxLen = Math.Max(_maxLen, 16);
                return;
        }
        var str = v as string ?? Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
        _maxLen = Math.Max(_maxLen, str.Length);
        if (_bool && !(str.Trim().ToLowerInvariant() is "true" or "false" or "yes" or "no")) _bool = false;
        if (_int)
        {
            var c = parser.CanonicalNumber(str, false);
            if (c is null || c.Contains('.') || ValueParser.HasLeadingZero(c) || !long.TryParse(c, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var n)) _int = false;
            else
            {
                _maxAbs = Math.Max(_maxAbs, Math.Abs(n == long.MinValue ? long.MaxValue : n));
                _maxIntDigits = Math.Max(_maxIntDigits, c.TrimStart('+', '-').Length);
            }
        }
        if (_dec)
        {
            var c = parser.CanonicalNumber(str, false);
            if (c is null || ValueParser.HasLeadingZero(c) || !parser.TryParseDecimal(str, out _, out var id, out var sc)) _dec = false;
            else { _maxIntDigits = Math.Max(_maxIntDigits, id); _maxScale = Math.Max(_maxScale, sc); }
        }
        if (_float)
        {
            var c = parser.CanonicalNumber(str, true);
            if (c is null || ValueParser.HasLeadingZero(c) || !parser.TryParseDouble(str, out _)) _float = false;
        }
        if (_date || _datetime)
        {
            if (parser.TryParseDateTime(str, out _, out var hasTime))
            {
                if (hasTime) { _sawDateTime = true; _date = false; } else _sawDateOnly = true;
            }
            else _date = _datetime = false;
        }
        if (_time && !parser.TryParseTime(str, out _)) _time = false;
        if (_guid && !(str.Length == 36 && Guid.TryParse(str, out _))) _guid = false;
    }

    public InferredType Infer(bool moreRows)
    {
        if (_count == 0) return new InferredType(Kinds.Empty, null, null, null, true);
        var n = _nullable;
        if (_bool) return new InferredType(Kinds.Bool, Nullable: n);
        if (_int) return new InferredType(_maxAbs <= 99_999_999 || (!moreRows && _maxAbs <= int.MaxValue) ? Kinds.Int : Kinds.BigInt, Nullable: n);
        if (_dec && _maxScale <= 18 && _maxIntDigits + _maxScale <= 38)
        {
            var scale = _maxScale;
            var precision = Math.Min(38, Math.Max(18, _maxIntDigits + scale));
            if (precision - scale < _maxIntDigits) precision = Math.Min(38, _maxIntDigits + scale);
            return new InferredType(Kinds.Decimal, null, precision, scale, n);
        }
        if (_float) return new InferredType(Kinds.Float, Nullable: n);
        if ((_date || _datetime) && (_sawDateOnly || _sawDateTime))
            return new InferredType(_sawDateTime ? Kinds.DateTime : Kinds.Date, Nullable: n);
        if (_time) return new InferredType(Kinds.Time, Nullable: n);
        if (_guid) return new InferredType(Kinds.Guid, Nullable: n);
        return new InferredType(Kinds.Text, TextLength(_maxLen), null, null, n);
    }

    private static readonly int[] Buckets = [16, 32, 64, 128, 255, 512, 1000, 2000, 4000];

    public static int TextLength(int max)
    {
        foreach (var b in Buckets) if (max <= b) return b;
        return max;
    }
}

/// <summary>Converts raw source values to the CLR type a target column kind wants.</summary>
public sealed class CellConverter(ValueParser parser)
{
    public object? Convert(object? raw, string kind)
    {
        if (raw is null) return null;
        switch (kind)
        {
            case Kinds.Text or Kinds.Json or Kinds.Other:
                return raw is string s ? s : Text(raw);
            case Kinds.Int or Kinds.BigInt:
                return ToLong(raw);
            case Kinds.Decimal:
                return ToDecimal(raw);
            case Kinds.Float:
                return ToDouble(raw);
            case Kinds.Bool:
                return ToBool(raw);
            case Kinds.Date:
                return ToDateTime(raw, dateOnly: true);
            case Kinds.DateTime:
                return ToDateTime(raw, dateOnly: false);
            case Kinds.Time:
                return ToTime(raw);
            case Kinds.Guid:
                if (raw is string gs && Guid.TryParse(gs.Trim(), out var g)) return g;
                throw new ValueConversionException($"'{Display(raw)}' is not a valid GUID.");
            case Kinds.Binary:
                return ToBytes(raw);
            default:
                return raw is string s2 ? s2 : Text(raw);
        }
    }

    public static string Text(object raw) => raw switch
    {
        string s => s,
        bool b => b ? "true" : "false",
        DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
        TimeSpan t => t.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => raw.ToString() ?? "",
    };

    private static string Display(object raw)
    {
        var t = Text(raw);
        return t.Length > 60 ? t[..57] + "..." : t;
    }

    private long ToLong(object raw)
    {
        switch (raw)
        {
            case long l: return l;
            case bool b: return b ? 1 : 0;
            case decimal d when d == decimal.Truncate(d) && d >= long.MinValue && d <= long.MaxValue: return (long)d;
            case double db when db == Math.Truncate(db) && Math.Abs(db) < 9e18: return (long)db;
            case string s when parser.TryParseLong(s, out var v): return v;
        }
        throw new ValueConversionException($"'{Display(raw)}' is not a whole number.");
    }

    private decimal ToDecimal(object raw)
    {
        switch (raw)
        {
            case long l: return l;
            case decimal d: return d;
            case double db when double.IsFinite(db) && Math.Abs(db) < 7.9e27: return (decimal)db;
            case bool b: return b ? 1 : 0;
            case string s when parser.TryParseDecimal(s, out var v, out _, out _): return v;
        }
        throw new ValueConversionException($"'{Display(raw)}' is not a number.");
    }

    private double ToDouble(object raw)
    {
        switch (raw)
        {
            case long l: return l;
            case decimal d: return (double)d;
            case double db: return db;
            case bool b: return b ? 1 : 0;
            case string s when parser.TryParseDouble(s, out var v): return v;
        }
        throw new ValueConversionException($"'{Display(raw)}' is not a number.");
    }

    private static bool ToBool(object raw)
    {
        switch (raw)
        {
            case bool b: return b;
            case long l when l is 0 or 1: return l == 1;
            case decimal d when d is 0 or 1: return d == 1;
            case double db when db is 0 or 1: return db == 1;
            case string s when ValueParser.TryParseBool(s, out var v): return v;
        }
        throw new ValueConversionException($"'{Display(raw)}' is not a yes/no value.");
    }

    private DateTime ToDateTime(object raw, bool dateOnly)
    {
        DateTime dt;
        switch (raw)
        {
            case DateTime d: dt = d; break;
            case string s when parser.TryParseDateTime(s, out var v, out _): dt = v; break;
            default: throw new ValueConversionException($"'{Display(raw)}' is not a valid date.");
        }
        return dateOnly ? dt.Date : dt;
    }

    private TimeSpan ToTime(object raw)
    {
        switch (raw)
        {
            case TimeSpan t: return t;
            case DateTime d: return d.TimeOfDay;
            case string s when parser.TryParseTime(s, out var v): return v;
            case string s2 when parser.TryParseDateTime(s2, out var dt, out var hasTime) && hasTime: return dt.TimeOfDay;
        }
        throw new ValueConversionException($"'{Display(raw)}' is not a valid time.");
    }

    private static byte[] ToBytes(object raw)
    {
        if (raw is byte[] b) return b;
        var s = raw as string ?? Text(raw);
        var t = s.Trim();
        if (t.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) t = t[2..];
        else if (t.StartsWith("\\x", StringComparison.Ordinal)) t = t[2..];
        if (t.Length % 2 == 0 && t.All(Uri.IsHexDigit))
            return Convert_FromHex(t);
        try { return System.Convert.FromBase64String(t); }
        catch (FormatException) { throw new ValueConversionException("Binary values must be hexadecimal (0x...) or base64 text."); }
    }

    private static byte[] Convert_FromHex(string t) => System.Convert.FromHexString(t);
}
