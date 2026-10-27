using System.Text.RegularExpressions;

namespace DbStudio.Federation.Pushdown;

/// <summary>
/// <c>EXPLAIN [ANALYZE] [(options)] select ...</c> on a link. DuckDB's <c>json_serialize_sql</c> only takes SELECT, so the
/// analyzer would fall back to "read every table named in the text, whole". The push-down analysis is done on the inner
/// query instead (the plan then shows what the real run would fetch), and a plain EXPLAIN reads only a sample of each
/// source: it prints the plan, not rows.
/// </summary>
public static partial class ExplainSql
{
    /// <summary>Rows read per source for a plain EXPLAIN (the plan does not need the data; ANALYZE runs the query and reads normally).</summary>
    public const long SampleRows = 1000;

    [GeneratedRegex(@"^\s*EXPLAIN\b\s*(?<opts>\([^)]*\))?\s*(?<analyze>ANALY[SZ]E\b)?\s*(?<opts2>\([^)]*\))?\s*(?<inner>.*)$",
        RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    /// <summary>True when <paramref name="sql"/> starts with EXPLAIN; <paramref name="inner"/> is the explained statement, <paramref name="analyze"/> whether it also runs it.</summary>
    public static bool TrySplit(string sql, out string inner, out bool analyze)
    {
        inner = sql;
        analyze = false;
        var m = Pattern().Match(sql);
        if (!m.Success || string.IsNullOrWhiteSpace(m.Groups["inner"].Value)) return false;
        inner = m.Groups["inner"].Value;
        analyze = m.Groups["analyze"].Success
                  || Regex.IsMatch(m.Groups["opts"].Value + m.Groups["opts2"].Value, @"\bANALY[SZ]E\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return true;
    }

    /// <summary>DuckDB's wording for statements it cannot serialize, said in terms a user can act on.</summary>
    public static string FriendlyReason(string? reason) =>
        reason is not null && reason.Contains("Only SELECT statements can be serialized", StringComparison.OrdinalIgnoreCase)
            ? "it is not a plain SELECT"
            : reason ?? "the statement cannot be analysed";
}
