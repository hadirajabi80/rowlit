using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DbStudio.Core.Params;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Builder;

/// <summary>A column a filter condition can name: its key (<c>"t1.status"</c> in WHERE, an output column id in HAVING), kind and SQL reference.</summary>
internal sealed record FilterColumn(string Name, string Kind, string Sql);

/// <summary>
/// Allocates the builder's bind parameters (<c>$fp1</c>, <c>$fp2</c>, â€¦), shared by WHERE and HAVING; the C# twin of
/// ui/src/filter/sql.ts <c>ParamBuilder</c> for dialect duckdb.
/// </summary>
internal sealed class FilterParams(string prefix = "fp")
{
    private int _seq;
    public List<QueryParam> Params { get; } = [];

    public string Add(string kind, JsonNode? value)
    {
        var name = prefix + (++_seq).ToString(CultureInfo.InvariantCulture);
        Params.Add(new QueryParam(name, kind, value));
        return "$" + name;
    }
}

/// <summary>
/// Filter tree â†’ DuckDB predicate: a line-by-line port of ui/src/filter/sql.ts <c>buildPredicate</c> restricted to the
/// duckdb dialect (ILIKE, <c>||</c>, <c>ESCAPE '\'</c>, TRUE/FALSE, <c>$fpN</c> binds, times bound as <c>time</c>), so the
/// engine compiler and the UI's builder/compile.ts emit the same text. Values are never inlined.
/// </summary>
internal sealed partial class FilterSql
{
    private readonly IReadOnlyList<FilterColumn> _columns;
    private readonly FilterParams _pb;
    private readonly DateTime _now;
    public List<string> Warnings { get; } = [];

    public FilterSql(IReadOnlyList<FilterColumn> columns, FilterParams pb, DateTime? now = null)
    {
        _columns = columns;
        _pb = pb;
        _now = now ?? DateTime.Now;
    }

    private readonly record struct Piece(string Sql, bool Compound);

    private static Piece Atom(string sql) => new(sql, false);
    private static Piece Compound(string sql) => new(sql, true);

    private static Piece JoinPieces(IReadOnlyList<Piece> pieces, string glue)
    {
        if (pieces.Count == 1) return pieces[0];
        return Compound(string.Join(glue, pieces.Select(p => p.Compound ? "(" + p.Sql + ")" : p.Sql)));
    }

    /// <summary>The predicate (null when nothing applies). Regex conditions become <c>regexp_matches</c>.</summary>
    public string? Build(BuilderFilterNode? filter)
    {
        var (server, client) = Split(filter);
        var main = server is null ? null : NodeSql(server, true);
        if (client is not null) Warnings.Add("Regular expressions are applied in the grid after the server filter");
        return main?.Sql;
    }

    // ---------------------------------------------------------------- split (filter/sql.ts splitForServer)

    private (BuilderFilterNode? Server, BuilderFilterNode? Client) Split(BuilderFilterNode? node)
    {
        if (node is null) return (null, null);
        if (node.Kind == "condition")
        {
            if (node.Enabled == false) return (null, null);
            var ci = Resolve(node.Column ?? "", node.Ordinal);
            if (ci < 0 || FilterValues.ConditionProblem(node, _columns[ci].Kind) is not null) return (null, null);
            return FilterValues.IsServerOp(node.Op) || node.Op == "regex" ? (node, null) : (null, node);
        }
        var parts = (node.Items ?? []).Select(Split).ToList();
        var servers = parts.Where(p => p.Server is not null).Select(p => p.Server!).ToList();
        var clients = parts.Where(p => p.Client is not null).Select(p => p.Client!).ToList();
        if (node.Logic != "or" && node.Negate != true)
        {
            return (servers.Count > 0 ? node with { Items = servers } : null, clients.Count > 0 ? node with { Items = clients } : null);
        }
        if (clients.Count == 0) return (servers.Count > 0 ? node with { Items = servers } : null, null);
        return (null, node);
    }

    /// <summary>filter/model.ts resolveColumn: ordinal hint, exact name, then case-insensitive.</summary>
    private int Resolve(string name, int? ordinal)
    {
        if (ordinal is { } o && o >= 0 && o < _columns.Count && (_columns[o].Name == name || name.Length == 0)) return o;
        for (var i = 0; i < _columns.Count; i++) if (_columns[i].Name == name) return i;
        for (var i = 0; i < _columns.Count; i++) if (string.Equals(_columns[i].Name, name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    private Piece? NodeSql(BuilderFilterNode n, bool top)
    {
        if (n.Kind == "condition") return ConditionSql(n);
        var parts = (n.Items ?? []).Select(i => NodeSql(i, false)).Where(p => p is not null).Select(p => p!.Value).ToList();
        if (parts.Count == 0) return null;
        var joined = JoinPieces(parts, n.Logic == "or" ? " OR " : " AND ");
        if (n.Negate == true) return Atom("NOT (" + joined.Sql + ")");
        if (!top && parts.Count > 1) return Atom("(" + joined.Sql + ")");
        return joined;
    }

    // ---------------------------------------------------------------- conditions

    private Piece? ConditionSql(BuilderFilterNode cond)
    {
        var ci = Resolve(cond.Column ?? "", cond.Ordinal);
        if (ci < 0)
        {
            Warnings.Add($"Column â€œ{cond.Column}â€ is not in the result; condition ignored");
            return null;
        }
        var col = _columns[ci];
        if (cond.Enabled == false || FilterValues.ConditionProblem(cond, col.Kind) is not null) return null;
        var cls = FilterValues.KindClass(col.Kind);
        var c = col.Sql;
        var cs = cond.CaseSensitive == true;
        var v = cond.Values ?? [];

        string StrParam(string s) => _pb.Add(ParamKinds.String, JsonValue.Create(s));
        string Left() => cs ? c : $"lower({c})";
        string Wrap(string p) => cs ? p : $"lower({p})";

        switch (cond.Op)
        {
            case "isNull": return Atom($"{c} IS NULL");
            case "isNotNull": return Atom($"{c} IS NOT NULL");
            case "isTrue": return Atom($"{c} = TRUE");
            case "isFalse": return Atom($"{c} = FALSE");
            case "isEmpty": return Atom($"{c} = ''");
            case "regex":
            {
                // The grid applies a regex client-side; the builder has no grid filter, DuckDB runs it (RE2 syntax).
                var p = StrParam(FilterValues.Str(v.Count > 0 ? v[0] : null));
                return Atom($"regexp_matches({c}, {p}{(cs ? "" : ", 'i'")})");
            }
            case "contains" or "notContains" or "startsWith" or "endsWith":
            {
                var raw = FilterValues.Str(v.Count > 0 ? v[0] : null);
                var pre = cond.Op is "contains" or "notContains" or "endsWith";
                var post = cond.Op is "contains" or "notContains" or "startsWith";
                var p = StrParam(EscapeLike(raw));
                var parts = new List<string>();
                if (pre) parts.Add("'%'");
                parts.Add(p);
                if (post) parts.Add("'%'");
                var expr = $"{c} {(cs ? "LIKE" : "ILIKE")} {string.Join(" || ", parts)} ESCAPE '\\'";
                return Atom(cond.Op == "notContains" ? $"NOT ({expr})" : expr);
            }
            case "in" or "notIn":
            {
                var vals = FilterValues.Filled(v);
                var neg = cond.Op == "notIn" ? "NOT " : "";
                if (cls == "number") return Atom($"{c} {neg}IN ({string.Join(", ", vals.Select(x => NumberParam(col.Kind, x)))})");
                return Atom($"{Left()} {neg}IN ({string.Join(", ", vals.Select(x => Wrap(StrParam(FilterValues.Str(x)))))})");
            }
        }

        if (cls is "number" or "bool")
        {
            if (cond.Op == "between") return Atom($"{c} BETWEEN {NumberParam(col.Kind, v[0])} AND {NumberParam(col.Kind, v[1])}");
            var nop = CompareOp(cond.Op, false);
            return nop is null ? null : Atom($"{c} {nop} {NumberParam(col.Kind, v[0])}");
        }
        if (cls == "date") return DateSql(cond, c);
        if (cls == "time")
        {
            string P(int i) => _pb.Add(ParamKinds.Time, JsonValue.Create(FilterValues.ParseTime(v[i])![..8]));
            if (cond.Op == "before") return Atom($"{c} < {P(0)}");
            if (cond.Op == "after") return Atom($"{c} > {P(0)}");
            if (cond.Op == "between") return Atom($"{c} BETWEEN {P(0)} AND {P(1)}");
        }
        var op = CompareOp(cond.Op, false);
        if (cond.Op == "between") return Atom($"{Left()} BETWEEN {Wrap(StrParam(FilterValues.Str(v[0])))} AND {Wrap(StrParam(FilterValues.Str(v[1])))}");
        if (op is null) return null;
        return Atom($"{Left()} {op} {Wrap(StrParam(FilterValues.Str(v[0])))}");
    }

    private static string? CompareOp(string? op, bool dates) => op switch
    {
        "eq" => "=", "neq" => "<>", "lt" => "<", "lte" => "<=", "gt" => ">", "gte" => ">=",
        "before" when dates => "<", "after" when dates => ">",
        _ => null,
    };

    private string NumberParam(string kind, JsonNode? v)
    {
        var n = FilterValues.ParseNumber(v)!.Value;
        if (kind == "float") return _pb.Add(ParamKinds.Float, FilterValues.NumberNode(n.Num));
        if (FilterValues.IsSafeInteger(n.Num) && !n.Str.Contains('.', StringComparison.Ordinal)) return _pb.Add(ParamKinds.Int, FilterValues.NumberNode(n.Num));
        return _pb.Add(ParamKinds.Decimal, JsonValue.Create(n.Str));
    }

    private string DateParam(string iso) => _pb.Add(ParamKinds.DateTime, JsonValue.Create(iso.Length == 10 ? iso + "T00:00:00" : iso));

    private Piece? DateSql(BuilderFilterNode cond, string c)
    {
        var v = cond.Values ?? [];
        if (cond.Op is "last" or "next")
        {
            var p = FilterValues.ParsePeriod(v)!.Value;
            var (from, to) = FilterValues.PeriodBounds(cond.Op, p.Count, p.Unit, _now);
            return Compound($"{c} >= {DateParam(from)} AND {c} {(cond.Op == "last" ? "<=" : "<")} {DateParam(to)}");
        }
        var count = cond.Op == "between" ? 2 : 1;
        var vals = Enumerable.Range(0, count).Select(i => FilterValues.ParseDate(v[i])!).ToList();
        var dateOnly = cond.Op == "onDate" || vals.All(FilterValues.IsDateOnly);
        var dayUpper = cond.Op == "between" && !dateOnly && FilterValues.IsDateOnly(vals[1]);
        static string Day(string s) => s[..10];
        if (dateOnly)
        {
            switch (cond.Op)
            {
                case "onDate" or "eq": return Compound($"{c} >= {DateParam(Day(vals[0]))} AND {c} < {DateParam(FilterValues.AddDays(vals[0], 1))}");
                case "neq": return Atom($"NOT ({c} >= {DateParam(Day(vals[0]))} AND {c} < {DateParam(FilterValues.AddDays(vals[0], 1))})");
                case "before" or "lt": return Atom($"{c} < {DateParam(Day(vals[0]))}");
                case "lte": return Atom($"{c} < {DateParam(FilterValues.AddDays(vals[0], 1))}");
                case "after" or "gt": return Atom($"{c} >= {DateParam(FilterValues.AddDays(vals[0], 1))}");
                case "gte": return Atom($"{c} >= {DateParam(Day(vals[0]))}");
                case "between": return Compound($"{c} >= {DateParam(Day(vals[0]))} AND {c} < {DateParam(FilterValues.AddDays(vals[1], 1))}");
            }
            return null;
        }
        if (cond.Op == "between")
        {
            if (dayUpper) return Compound($"{c} >= {DateParam(vals[0])} AND {c} < {DateParam(FilterValues.AddDays(vals[1], 1))}");
            return Atom($"{c} BETWEEN {DateParam(vals[0])} AND {DateParam(vals[1])}");
        }
        var op = CompareOp(cond.Op, true);
        return op is null ? null : Atom($"{c} {op} {DateParam(vals[0])}");
    }

    [GeneratedRegex(@"[\\%_]")]
    private static partial Regex LikeSpecial();

    public static string EscapeLike(string v) => LikeSpecial().Replace(v, m => "\\" + m.Value);
}

/// <summary>Operand parsing of ui/src/filter/values.ts (+ model.ts kindClass, operators.ts arity/server).</summary>
internal static partial class FilterValues
{
    public static string KindClass(string? kind) => kind switch
    {
        "int" or "float" or "decimal" => "number",
        "string" or "json" or "xml" or "guid" => "string",
        "date" or "datetime" or "datetimeoffset" => "date",
        "time" => "time",
        "bool" => "bool",
        _ => "other",
    };

    public static readonly IReadOnlySet<string> KnownOps = new HashSet<string>(StringComparer.Ordinal)
    {
        "eq", "neq", "lt", "lte", "gt", "gte", "between", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isNull",
        "isNotNull", "isTrue", "isFalse", "isEmpty", "regex", "before", "after", "onDate", "last", "next",
    };

    public static bool IsServerOp(string? op) => op is not null && op != "regex" && KnownOps.Contains(op);

    /// <summary>none | one | two | list | period (unknown ops: one, as OPERATOR_INFO's fallback).</summary>
    public static string Arity(string? op) => op switch
    {
        "isNull" or "isNotNull" or "isTrue" or "isFalse" or "isEmpty" => "none",
        "between" => "two",
        "in" or "notIn" => "list",
        "last" or "next" => "period",
        _ => "one",
    };

    public static bool IsBlank(JsonNode? v) =>
        v is null || (v is JsonValue jv && jv.GetValueKind() == JsonValueKind.Null) || (v is JsonValue s && s.GetValueKind() == JsonValueKind.String && s.GetValue<string>().Trim().Length == 0);

    public static List<JsonNode?> Filled(IReadOnlyList<JsonNode?> values) => values.Where(v => !IsBlank(v)).ToList();

    /// <summary>JS <c>String(v)</c> of a filter operand.</summary>
    public static string Str(JsonNode? v)
    {
        if (v is null) return "null";
        if (v is not JsonValue jv) return v.ToJsonString();
        return jv.GetValueKind() switch
        {
            JsonValueKind.String => jv.GetValue<string>(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => "null",
            JsonValueKind.Number => JsNumber(Num(jv)),
            _ => jv.ToJsonString(),
        };
    }

    /// <summary>JS Number â†’ string for the common cases (integers without exponent, shortest round-trip otherwise).</summary>
    public static string JsNumber(double d)
    {
        if (double.IsNaN(d)) return "NaN";
        if (d == Math.Floor(d) && Math.Abs(d) < 1e21) return d.ToString("0", CultureInfo.InvariantCulture);
        var r = d.ToString("R", CultureInfo.InvariantCulture);
        // JS writes 1e-7 as "1e-7" and C# as "1E-07".
        var m = Regex.Match(r, @"^(-?[\d.]+)E([+-])0*(\d+)$");
        return m.Success ? m.Groups[1].Value + "e" + m.Groups[2].Value + m.Groups[3].Value : r;
    }

    /// <summary>A JSON number as double, whatever CLR type the node wraps.</summary>
    public static double Num(JsonValue v) => double.Parse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);

    public static JsonNode NumberNode(double d) =>
        d == Math.Floor(d) && Math.Abs(d) <= 9_007_199_254_740_991d ? JsonValue.Create((long)d) : JsonValue.Create(d);

    public static bool IsSafeInteger(double d) => d == Math.Floor(d) && Math.Abs(d) <= 9_007_199_254_740_991d && !double.IsInfinity(d);

    [GeneratedRegex(@"^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$", RegexOptions.IgnoreCase)]
    private static partial Regex NumRe();

    [GeneratedRegex(@"[\s_]")]
    private static partial Regex Blanks();

    public static (double Num, string Str)? ParseNumber(JsonNode? v)
    {
        if (v is not JsonValue jv) return null;
        switch (jv.GetValueKind())
        {
            case JsonValueKind.Number:
                var d = Num(jv);
                return double.IsFinite(d) ? (d, NormalizeDecimal(JsNumber(d))) : null;
            case JsonValueKind.True: return (1, "1");
            case JsonValueKind.False: return (0, "0");
            case JsonValueKind.String:
                var s = Blanks().Replace(jv.GetValue<string>().Trim(), "");
                if (s.Length == 0 || !NumRe().IsMatch(s)) return null;
                var num = double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
                return (num, NormalizeDecimal(s));
            default: return null;
        }
    }

    public static string NormalizeDecimal(string s)
    {
        if (s.Contains('e', StringComparison.OrdinalIgnoreCase)) return JsNumber(double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture));
        var neg = false;
        if (s.Length > 0 && s[0] is '+' or '-')
        {
            neg = s[0] == '-';
            s = s[1..];
        }
        var dot = s.IndexOf('.');
        var i = dot < 0 ? s : s[..dot];
        var f = dot < 0 ? "" : s[(dot + 1)..];
        i = i.TrimStart('0');
        if (i.Length == 0) i = "0";
        f = f.TrimEnd('0');
        var o = f.Length > 0 ? i + "." + f : i;
        return neg && o != "0" ? "-" + o : o;
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex DateOnlyRe();

    [GeneratedRegex(@"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?$")]
    private static partial Regex DateTimeRe();

    [GeneratedRegex(@"^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$")]
    private static partial Regex TimeRe();

    public static bool IsDateOnly(string s) => DateOnlyRe().IsMatch(s.Trim());

    private static string NormDateTime(string s)
    {
        var t = s.Trim();
        return t.Length > 10 && t[10] == ' ' ? t[..10] + "T" + t[11..] : t;
    }

    private static bool ValidDate(string s) =>
        DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public static string? ParseDate(JsonNode? v)
    {
        if (v is not JsonValue jv || jv.GetValueKind() != JsonValueKind.String) return null;
        var s = NormDateTime(jv.GetValue<string>());
        if (DateOnlyRe().IsMatch(s)) return ValidDate(s) ? s : null;
        var m = DateTimeRe().Match(s);
        if (!m.Success || !ValidDate(m.Groups[1].Value)) return null;
        return $"{m.Groups[1].Value}T{m.Groups[2].Value}:{m.Groups[3].Value}:{(m.Groups[4].Success ? m.Groups[4].Value : "00")}{(m.Groups[5].Success ? m.Groups[5].Value : "")}";
    }

    public static string? ParseTime(JsonNode? v)
    {
        if (v is not JsonValue jv || jv.GetValueKind() != JsonValueKind.String) return null;
        var m = TimeRe().Match(jv.GetValue<string>().Trim());
        if (!m.Success) return null;
        var h = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        var mi = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        var se = m.Groups[3].Success ? int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture) : 0;
        if (h > 23 || mi > 59 || se > 59) return null;
        return $"{h:00}:{m.Groups[2].Value}:{(m.Groups[3].Success ? m.Groups[3].Value : "00")}{(m.Groups[4].Success ? m.Groups[4].Value : "")}";
    }

    public static string AddDays(string date, int n) =>
        DateOnly.ParseExact(date[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(n).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static (int Count, string Unit)? ParsePeriod(IReadOnlyList<JsonNode?> values)
    {
        var first = values.Count > 0 ? values[0] : null;
        double n;
        if (first is JsonValue jv && jv.GetValueKind() == JsonValueKind.Number) n = Num(jv);
        else
        {
            var s = first is null ? "" : Str(first).Trim();
            if (s.Length == 0) n = 0;
            else if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out n)) return null;
        }
        if (n != Math.Floor(n) || n <= 0 || n > 100000) return null;
        var u = values.Count > 1 && values[1] is JsonValue uv && uv.GetValueKind() == JsonValueKind.String ? uv.GetValue<string>() : null;
        return ((int)n, u is "weeks" or "months" ? u : "days");
    }

    private static string LocalIso(DateTime d) => d.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    public static (string From, string To) PeriodBounds(string op, int count, string unit, DateTime now)
    {
        var start = now.Date;
        DateTime Shift(int sign) => unit == "months" ? start.AddMonths(sign * count) : start.AddDays(sign * count * (unit == "weeks" ? 7 : 1));
        if (op == "last") return (LocalIso(Shift(-1)), LocalIso(now));
        return (LocalIso(now), LocalIso(Shift(1).AddDays(1)));
    }

    /// <summary>values.ts conditionProblem: why the condition cannot be evaluated yet, or null when it is ready.</summary>
    public static string? ConditionProblem(BuilderFilterNode c, string? kind)
    {
        var arity = Arity(c.Op);
        if (arity == "none") return null;
        var values = c.Values ?? [];
        var cls = KindClass(kind);
        if (arity == "period") return ParsePeriod(values) is null ? "Enter a positive number" : null;
        List<JsonNode?> operands;
        if (arity == "two")
        {
            operands = values.Take(2).ToList();
            if (operands.Count < 2 || operands.Any(IsBlank)) return "Enter both values";
        }
        else if (arity == "list")
        {
            operands = Filled(values);
            if (operands.Count == 0) return "Enter at least one value";
        }
        else
        {
            operands = values.Take(1).ToList();
            if (operands.Count == 0 || IsBlank(operands[0])) return "Enter a value";
        }
        if (c.Op == "regex")
        {
            try { _ = new Regex(Str(operands[0])); }
            catch (ArgumentException) { return "Invalid regular expression"; }
            return null;
        }
        if (c.Op is "contains" or "notContains" or "startsWith" or "endsWith") return null;
        foreach (var v in operands)
        {
            if (cls == "number" && ParseNumber(v) is null) return $"â€œ{Str(v)}â€ is not a number";
            if (cls == "date" && ParseDate(v) is null) return "Use YYYY-MM-DD or YYYY-MM-DD HH:MM";
            if (cls == "time" && ParseTime(v) is null) return "Use HH:MM or HH:MM:SS";
        }
        return null;
    }
}
