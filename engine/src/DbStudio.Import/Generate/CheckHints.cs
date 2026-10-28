using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Import.Run;

namespace DbStudio.Import.Generate;

/// <summary>
/// Reads what the schema says about the values of a table's columns: simple CHECK constraints (<c>col IN (...)</c>,
/// <c>col = 'a' OR col = 'b'</c>, <c>col &gt;= 0 AND col &lt;= 100</c>, <c>BETWEEN</c>) and PostgreSQL enum types. Anything more
/// complex is ignored (the server then rejects violating rows, which the run reports).
/// </summary>
internal static class CheckHints
{
    private const string Num = @"-?\d+(?:\.\d+)?";
    private const string Lit = @"'(?:[^']|'')*'|" + Num;

    private static readonly Regex InList = new(@"(?<![\w.])(\w+)\s+IN\s*\(\s*((?:" + Lit + @")(?:\s*,\s*(?:" + Lit + @"))*)\s*\)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AnyArray = new(@"(?<![\w.])(\w+)\s*=\s*ANY\s*\(\s*\(?\s*ARRAY\s*\[\s*((?:" + Lit + @")(?:\s*,\s*(?:" + Lit + @"))*)\s*\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Equal = new(@"(?<![\w.<>!])(\w+)\s*=\s*(" + Lit + ")", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Between = new(@"(?<![\w.])(\w+)\s+BETWEEN\s+(" + Num + @")\s+AND\s+(" + Num + ")", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Compare = new(@"(?<![\w.])(\w+)\s*(>=|<=|>|<)\s*(" + Num + ")", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex LitRe = new("(" + Lit + ")", RegexOptions.Compiled);
    private static readonly Regex Cast = new(@"::\s*(?:character varying|double precision|timestamp(?: with(?:out)? time zone)?|[A-Za-z_]\w*)(?:\(\d+(?:,\s*\d+)?\))?(?:\[\])?", RegexOptions.Compiled);
    private static readonly Regex BracketedName = new(@"\[(\w+)\]", RegexOptions.Compiled);
    private static readonly Regex ParenName = new(@"(?<!\w)\(([A-Za-z_]\w*)\)", RegexOptions.Compiled);
    private static readonly Regex ParenNumber = new(@"(?<=[<>=]\s{0,3})\((-?\d+(?:\.\d+)?)\)", RegexOptions.Compiled);
    private static readonly Regex Introducer = new(@"\b_[A-Za-z0-9]+(?=')", RegexOptions.Compiled);
    private static readonly Regex NPrefix = new(@"(?<!\w)N'", RegexOptions.Compiled);

    /// <summary>Hints of one constraint definition for the given columns (case-insensitive names).</summary>
    public static Dictionary<string, ColumnHint> Parse(string definition, IReadOnlyCollection<string> columns)
    {
        var result = new Dictionary<string, ColumnHint>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(definition)) return result;
        var known = new HashSet<string>(columns, StringComparer.OrdinalIgnoreCase);
        var text = Clean(definition);

        foreach (Match m in InList.Matches(text)) AddValues(result, known, m.Groups[1].Value, m.Groups[2].Value);
        foreach (Match m in AnyArray.Matches(text)) AddValues(result, known, m.Groups[1].Value, m.Groups[2].Value);

        var hasOr = Regex.IsMatch(text, @"\bOR\b", RegexOptions.IgnoreCase);
        var hasAnd = Regex.IsMatch(text, @"\bAND\b", RegexOptions.IgnoreCase);
        if (hasOr && !hasAnd)
        {
            var groups = Equal.Matches(text).GroupBy(m => m.Groups[1].Value, StringComparer.OrdinalIgnoreCase).ToList();
            if (groups.Count == 1 && groups[0].Count() >= 2 && known.Contains(groups[0].Key) && !result.ContainsKey(groups[0].Key))
                AddValues(result, known, groups[0].Key, string.Join(",", groups[0].Select(m => m.Groups[2].Value)));
        }

        // Ranges only when no OR joins alternatives (a >= 0 OR a = -1 is not a range).
        if (!hasOr)
        {
            foreach (Match m in Between.Matches(text))
                if (known.Contains(m.Groups[1].Value))
                    Merge(result, m.Groups[1].Value, h => h with { Min = Dec(m.Groups[2].Value), Max = Dec(m.Groups[3].Value) });
            foreach (Match m in Compare.Matches(text))
            {
                var name = m.Groups[1].Value;
                if (!known.Contains(name)) continue;
                var v = Dec(m.Groups[3].Value);
                switch (m.Groups[2].Value)
                {
                    case ">=": Merge(result, name, h => h with { Min = Max(h.Min, v), MinExclusive = false }); break;
                    case ">": Merge(result, name, h => h with { Min = Max(h.Min, v), MinExclusive = true }); break;
                    case "<=": Merge(result, name, h => h with { Max = Min(h.Max, v), MaxExclusive = false }); break;
                    case "<": Merge(result, name, h => h with { Max = Min(h.Max, v), MaxExclusive = true }); break;
                }
            }
        }
        return result;
    }

    private static decimal? Max(decimal? a, decimal b) => a is null ? b : Math.Max(a.Value, b);
    private static decimal? Min(decimal? a, decimal b) => a is null ? b : Math.Min(a.Value, b);
    private static decimal Dec(string s) => decimal.Parse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);

    private static string Clean(string s)
    {
        s = BracketedName.Replace(s, "$1");                       // SQL Server [col]
        s = s.Replace("\"", "", StringComparison.Ordinal).Replace("`", "", StringComparison.Ordinal);
        s = Introducer.Replace(s, "");                            // MySQL _utf8mb4'a'
        s = Cast.Replace(s, "");                                  // PostgreSQL 'a'::text
        s = ParenName.Replace(s, "$1");                           // (status) = ANY (...)
        s = ParenNumber.Replace(s, "$1");                         // SQL Server >=(0)
        return NPrefix.Replace(s, "'");                           // N'a'
    }

    private static void Merge(Dictionary<string, ColumnHint> map, string name, Func<ColumnHint, ColumnHint> f) =>
        map[name] = f(map.TryGetValue(name, out var h) ? h : new ColumnHint());

    private static void AddValues(Dictionary<string, ColumnHint> map, HashSet<string> known, string column, string list)
    {
        if (!known.Contains(column)) return;
        var values = new List<string>();
        foreach (Match m in LitRe.Matches(list))
        {
            var v = m.Groups[1].Value;
            values.Add(v.StartsWith('\'') ? v[1..^1].Replace("''", "'", StringComparison.Ordinal) : v);
        }
        if (values.Count == 0) return;
        Merge(map, column, h => h with { Values = values });
    }

    /// <summary>
    /// Hints of all columns of a table from its constraints (and enum types). Best effort: any failure (permissions, an old
    /// server) yields what was read so far.
    /// </summary>
    public static async Task<Dictionary<string, ColumnHint>> ReadAsync(ImportConnection conn, ImportDialect d, string? database, string? schema, string table,
        IReadOnlyList<ColumnDetail> columns, CancellationToken ct)
    {
        var names = columns.Select(c => c.Name).ToList();
        var result = new Dictionary<string, ColumnHint>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var definitions = new List<string>();
            switch (d.Dialect)
            {
                case Dialect.TSql:
                    await Collect(conn, "SELECT cc.definition FROM sys.check_constraints cc WHERE cc.parent_object_id = OBJECT_ID(" + d.Placeholder(0) + ")",
                        [d.Qualify(database, schema, table)], d, definitions, ct).ConfigureAwait(false);
                    break;
                case Dialect.PgSql:
                    await Collect(conn, "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.contype = 'c' AND c.conrelid = CAST(" + d.Placeholder(0) + " AS regclass)",
                        [d.Qualify(database, schema, table)], d, definitions, ct).ConfigureAwait(false);
                    await ReadPgEnumsAsync(conn, columns, result, ct).ConfigureAwait(false);
                    break;
                case Dialect.Sqlite:
                {
                    var sql = new List<string>();
                    await Collect(conn, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = " + d.Placeholder(0), [table], d, sql, ct).ConfigureAwait(false);
                    foreach (var s in sql) definitions.AddRange(SqliteChecks(s));
                    break;
                }
                case Dialect.MySql:
                    await Collect(conn,
                        "SELECT cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc " +
                        "ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME " +
                        "WHERE tc.CONSTRAINT_TYPE = 'CHECK' AND tc.TABLE_SCHEMA = IFNULL(" + d.Placeholder(0) + ", DATABASE()) AND tc.TABLE_NAME = " + d.Placeholder(1),
                        [string.IsNullOrWhiteSpace(schema) ? database : schema, table], d, definitions, ct).ConfigureAwait(false);
                    break;
                case Dialect.PlSql:
                    await Collect(conn,
                        "SELECT SEARCH_CONDITION_VC FROM ALL_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'C' AND TABLE_NAME = " + d.Placeholder(0) + " AND OWNER = NVL(" + d.Placeholder(1) + ", USER)",
                        [table, schema], d, definitions, ct).ConfigureAwait(false);
                    break;
            }
            foreach (var def in definitions)
                foreach (var (name, hint) in Parse(def, names))
                    result[name] = result.TryGetValue(name, out var old) ? Combine(old, hint) : hint;
        }
        catch (Exception ex) when (ex is DbException or InvalidOperationException or NotSupportedException)
        {
            // Hints are optional.
        }
        return result;
    }

    private static ColumnHint Combine(ColumnHint a, ColumnHint b) => new(b.Values ?? a.Values, b.Min ?? a.Min, b.Max ?? a.Max,
        b.Min is null ? a.MinExclusive : b.MinExclusive, b.Max is null ? a.MaxExclusive : b.MaxExclusive);

    /// <summary>The CHECK (...) bodies of a CREATE TABLE statement (balanced parentheses).</summary>
    public static IEnumerable<string> SqliteChecks(string createSql)
    {
        foreach (Match m in Regex.Matches(createSql ?? "", @"\bCHECK\s*\(", RegexOptions.IgnoreCase))
        {
            var depth = 1;
            var i = m.Index + m.Length;
            var start = i;
            var inQuote = false;
            for (; i < createSql!.Length && depth > 0; i++)
            {
                var c = createSql[i];
                if (c == '\'') inQuote = !inQuote;
                else if (!inQuote && c == '(') depth++;
                else if (!inQuote && c == ')') depth--;
            }
            if (depth == 0) yield return createSql[start..(i - 1)];
        }
    }

    private static async Task Collect(ImportConnection conn, string sql, IReadOnlyList<string?> args, ImportDialect d, List<string> into, CancellationToken ct)
    {
        await using var cmd = conn.Db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 15;
        for (var i = 0; i < args.Count; i++)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = d.ParameterName(i);
            p.Value = (object?)args[i] ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }
        await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await r.ReadAsync(ct).ConfigureAwait(false))
            if (!await r.IsDBNullAsync(0, ct).ConfigureAwait(false)) into.Add(Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) ?? "");
    }

    private static async Task ReadPgEnumsAsync(ImportConnection conn, IReadOnlyList<ColumnDetail> columns, Dictionary<string, ColumnHint> result, CancellationToken ct)
    {
        var enums = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        await using (var cmd = conn.Db.CreateCommand())
        {
            cmd.CommandText = "SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid ORDER BY t.typname, e.enumsortorder";
            cmd.CommandTimeout = 15;
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
            {
                var t = r.GetString(0);
                if (!enums.TryGetValue(t, out var list)) enums[t] = list = [];
                list.Add(r.GetString(1));
            }
        }
        foreach (var c in columns)
        {
            var type = (c.Type ?? "").Trim().Trim('"');
            var dot = type.LastIndexOf('.');
            if (dot >= 0) type = type[(dot + 1)..].Trim('"');
            if (enums.TryGetValue(type, out var labels)) result[c.Name] = new ColumnHint(Values: labels);
        }
    }
}
