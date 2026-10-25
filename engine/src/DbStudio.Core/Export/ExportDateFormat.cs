using System.Text;
using System.Text.RegularExpressions;
using DbStudio.Core.Services;

namespace DbStudio.Core.Export;

/// <summary>
/// Date / time pattern of the text export formats (CSV, TSV, Markdown, JSON). The wire values are ISO 8601 text, so the
/// pattern is applied to the text itself (no time zone conversion, nothing is lost or shifted). Tokens (as in .NET):
/// <c>yyyy</c> <c>yy</c> <c>MM</c> <c>dd</c> <c>HH</c> <c>mm</c> <c>ss</c> <c>f</c>..<c>fffffff</c> (fraction) and <c>zzz</c> (offset,
/// <c>+00:00</c> for Z); text in single quotes is literal. ui/src/components/Export/dateFormat.ts implements the same.
/// </summary>
public static partial class ExportDateFormat
{
    [GeneratedRegex(@"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$")]
    private static partial Regex IsoDate();

    [GeneratedRegex(@"^(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?$")]
    private static partial Regex IsoTime();

    /// <summary>Column kinds the pattern applies to.</summary>
    public static bool AppliesTo(string kind) => kind is ColumnKinds.Date or ColumnKinds.DateTime or ColumnKinds.DateTimeOffset or ColumnKinds.Time;

    /// <summary>The ISO text formatted with <paramref name="pattern"/>; the text unchanged when it is not an ISO date or time.</summary>
    public static string Format(string text, string pattern)
    {
        if (string.IsNullOrEmpty(pattern)) return text;
        string y, mo, d, h = "00", mi = "00", s = "00", frac = "", off = "";
        var m = IsoDate().Match(text);
        if (m.Success)
        {
            y = m.Groups[1].Value; mo = m.Groups[2].Value; d = m.Groups[3].Value;
            if (m.Groups[4].Success) { h = m.Groups[4].Value; mi = m.Groups[5].Value; s = m.Groups[6].Value; }
            frac = m.Groups[7].Value;
            if (m.Groups[8].Success) off = NormalizeOffset(m.Groups[8].Value);
        }
        else
        {
            var t = IsoTime().Match(text);
            if (!t.Success) return text;
            y = "0001"; mo = "01"; d = "01";
            h = t.Groups[1].Value; mi = t.Groups[2].Value; s = t.Groups[3].Value; frac = t.Groups[4].Value;
        }

        var sb = new StringBuilder();
        for (var i = 0; i < pattern.Length;)
        {
            var c = pattern[i];
            if (c == '\'')
            {
                var end = pattern.IndexOf('\'', i + 1);
                if (end < 0) { sb.Append(pattern, i + 1, pattern.Length - i - 1); break; }
                sb.Append(pattern, i + 1, end - i - 1);
                i = end + 1;
                continue;
            }
            var run = 1;
            while (i + run < pattern.Length && pattern[i + run] == c) run++;
            switch (c)
            {
                case 'y' when run == 4: sb.Append(y); i += 4; continue;
                case 'y' when run == 2: sb.Append(y.AsSpan(2)); i += 2; continue;
                case 'M' when run == 2: sb.Append(mo); i += 2; continue;
                case 'd' when run == 2: sb.Append(d); i += 2; continue;
                case 'H' when run == 2: sb.Append(h); i += 2; continue;
                case 'm' when run == 2: sb.Append(mi); i += 2; continue;
                case 's' when run == 2: sb.Append(s); i += 2; continue;
                case 'f' when run <= 7: sb.Append(frac.PadRight(run, '0')[..run]); i += run; continue;
                case 'z' when run == 3: sb.Append(off); i += 3; continue;
                default: sb.Append(c); i++; continue; // not a token (or an unsupported run length): copied as is
            }
        }
        return sb.ToString();
    }

    private static string NormalizeOffset(string o)
    {
        if (o == "Z") return "+00:00";
        return o.Length == 5 ? o[..3] + ":" + o[3..] : o;
    }
}
