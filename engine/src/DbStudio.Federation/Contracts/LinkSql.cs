using System.Text;
using System.Text.RegularExpressions;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0), implemented by WP0 so every package quotes and names alike. UI twins (identical rules):
// ui/src/lib/sql.ts quoteIdent(name, 'duckdb') and ui/src/api/links.ts slugifyAlias / uniqueAlias / isValidAlias.

/// <summary>DuckDB identifier quoting as the link SQL uses it (builder compile, analyzer rewrites, materialize).</summary>
public static partial class LinkSql
{
    /// <summary>
    /// PostgreSQL reserved key words (DuckDB uses PostgreSQL's grammar), the same list as ui/src/lib/sql.ts PG_RESERVED:
    /// an identifier spelled like one of them is quoted.
    /// </summary>
    public static readonly IReadOnlySet<string> Reserved = new HashSet<string>(
        ("ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC AUTHORIZATION BINARY BOTH CASE CAST CHECK COLLATE COLLATION COLUMN " +
         "CONCURRENTLY CONSTRAINT CREATE CROSS CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP " +
         "CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT FALSE FETCH FOR FOREIGN FREEZE FROM FULL GRANT GROUP HAVING " +
         "ILIKE IN INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL LEADING LEFT LIKE LIMIT LOCALTIME LOCALTIMESTAMP NATURAL NOT " +
         "NOTNULL NULL OFFSET ON ONLY OR ORDER OUTER OVERLAPS PLACING PRIMARY REFERENCES RETURNING RIGHT SELECT SESSION_USER SIMILAR " +
         "SOME SYMMETRIC SYSTEM_USER TABLE TABLESAMPLE THEN TO TRAILING TRUE UNION UNIQUE USER USING VARIADIC VERBOSE WHEN WHERE " +
         "WINDOW WITH").Split(' '),
        StringComparer.Ordinal);

    [GeneratedRegex("^[A-Za-z_][A-Za-z0-9_]*$")]
    private static partial Regex PlainIdentifier();

    /// <summary>True when <paramref name="name"/> must be written in double quotes.</summary>
    public static bool NeedsQuoting(string name) => !PlainIdentifier().IsMatch(name) || Reserved.Contains(name.ToUpperInvariant());

    /// <summary><paramref name="name"/> as is when plain, else <c>"name"</c> with inner quotes doubled.</summary>
    public static string QuoteIdent(string name) => NeedsQuoting(name) ? "\"" + name.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : name;

    /// <summary><c>alias.table</c>, each part quoted when needed.</summary>
    public static string Qualified(string alias, string table) => QuoteIdent(alias) + "." + QuoteIdent(table);
}

/// <summary>Naming rules of member aliases and mounted table names.</summary>
public static partial class LinkRules
{
    /// <summary>Longest alias / link table name (DuckDB has no limit; this keeps names readable and portable).</summary>
    public const int MaxNameLength = 63;

    /// <summary>
    /// Aliases a member cannot take: DuckDB's own catalogs/schemas and the link's views folder (<see cref="LinkIds.ViewsSchema"/>).
    /// Case-insensitive.
    /// </summary>
    public static readonly IReadOnlySet<string> ReservedAliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "main", "temp", "system", "memory", "information_schema", "pg_catalog", LinkIds.ViewsSchema,
    };

    [GeneratedRegex("^[a-z_][a-z0-9_]*$")]
    private static partial Regex AliasPattern();

    /// <summary>Lower-case identifier of at most <see cref="MaxNameLength"/> characters, not a reserved word or alias.</summary>
    public static bool IsValidAlias(string alias) =>
        alias.Length is > 0 and <= MaxNameLength && AliasPattern().IsMatch(alias)
        && !LinkSql.Reserved.Contains(alias.ToUpperInvariant()) && !ReservedAliases.Contains(alias);

    /// <summary>A mounted table name: non-empty, at most <see cref="MaxNameLength"/> characters, no control characters (any case; quoted when needed).</summary>
    public static bool IsValidTableName(string name) =>
        name.Length is > 0 and <= MaxNameLength && !name.Any(char.IsControl) && name.Trim().Length == name.Length;

    /// <summary>
    /// Alias proposal for a name (UI twin: slugifyAlias): lower-case ASCII letters and digits kept, every other run of
    /// characters becomes one "_", leading/trailing "_" trimmed, a leading digit prefixed with "_", cut to
    /// <see cref="MaxNameLength"/>; empty → "db". Not checked for uniqueness (see <see cref="UniqueAlias"/>).
    /// </summary>
    public static string Slugify(string name)
    {
        var sb = new StringBuilder(name.Length);
        var pendingUnderscore = false;
        foreach (var raw in name)
        {
            var c = raw is >= 'A' and <= 'Z' ? (char)(raw + 32) : raw;
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                if (pendingUnderscore && sb.Length > 0) sb.Append('_');
                pendingUnderscore = false;
                sb.Append(c);
            }
            else pendingUnderscore = true;
        }
        var s = sb.ToString();
        if (s.Length == 0) return "db";
        if (s[0] is >= '0' and <= '9') s = "_" + s;
        return s.Length > MaxNameLength ? s[..MaxNameLength].TrimEnd('_') : s;
    }

    /// <summary>
    /// <paramref name="proposal"/> when it is a valid alias not in <paramref name="taken"/> (case-insensitive), else
    /// proposal_2, proposal_3, … (UI twin: uniqueAlias). An invalid proposal (reserved word) gets the suffix too.
    /// </summary>
    public static string UniqueAlias(string proposal, IEnumerable<string> taken)
    {
        var used = new HashSet<string>(taken, StringComparer.OrdinalIgnoreCase);
        if (IsValidAlias(proposal) && !used.Contains(proposal)) return proposal;
        for (var n = 2; ; n++)
        {
            var suffix = "_" + n.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var stem = proposal.Length + suffix.Length > MaxNameLength ? proposal[..(MaxNameLength - suffix.Length)] : proposal;
            var candidate = stem + suffix;
            if (IsValidAlias(candidate) && !used.Contains(candidate)) return candidate;
        }
    }
}
