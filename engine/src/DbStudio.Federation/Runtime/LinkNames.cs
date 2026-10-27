using DbStudio.Core.Models;
using DbStudio.Core.Sql;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Runtime;

/// <summary>
/// What a wide scope spans per provider (<see cref="LinkScopes"/>): the name levels between a member alias and its tables.
/// <list type="bullet">
/// <item>SQL Server, PostgreSQL, Snowflake: database &gt; schema. Whole database = its schemas; whole connection = databases, then schemas.</item>
/// <item>Oracle (schemas = users) and SQLite (main + attached files): one database. Both wide scopes span the schemas.</item>
/// <item>MySQL, MariaDB, ClickHouse, Cassandra (keyspaces), MongoDB: the schema is the database. Whole database = that one
/// schema (<see cref="LinkMember.Schema"/>, like a schema member); whole connection spans the schemas.</item>
/// <item>Elasticsearch and anything else: nothing to span (every index).</item>
/// </list>
/// </summary>
internal static class MemberScopes
{
    public const string DatabaseLevel = "database", SchemaLevel = "schema";

    /// <summary>Providers with a database level above the schema.</summary>
    public static bool HasDatabaseLevel(string? providerId) => providerId is "sqlserver" or "postgresql" or "snowflake";

    /// <summary>Providers whose "database" is the schema level (or a MongoDB database).</summary>
    public static bool SchemaIsDatabase(string? providerId) => providerId is "mysql" or "mariadb" or "clickhouse" or "cassandra" or "mongodb";

    private static bool OneDatabaseManySchemas(string? providerId) => providerId is "oracle" or "sqlite";

    /// <summary>The levels of a member of <paramref name="scope"/> on <paramref name="providerId"/> (empty: nothing to span).</summary>
    public static IReadOnlyList<string> Levels(string? providerId, string scope) => scope switch
    {
        LinkScopes.Database when HasDatabaseLevel(providerId) || OneDatabaseManySchemas(providerId) => [SchemaLevel],
        LinkScopes.Connection when HasDatabaseLevel(providerId) => [DatabaseLevel, SchemaLevel],
        LinkScopes.Connection when OneDatabaseManySchemas(providerId) || SchemaIsDatabase(providerId) => [SchemaLevel],
        _ => [],
    };

    /// <summary>A warning when <paramref name="scope"/> spans nothing more on this provider than a narrower scope would, else null.</summary>
    public static string? Narrowed(string? providerId, string scope, string providerName, string alias) =>
        scope == LinkScopes.Connection && Levels(providerId, scope).Count == 0 && providerId is not "elasticsearch"
            ? $"{alias}: {providerName} has nothing wider to span; the member mounts every table of its schema."
            : null;
}

/// <summary>
/// One container (schema, MongoDB database…) of a wide member: where its tables live in the source.
/// <paramref name="Parts"/>: its names, one per level (what queries write between the alias and the table).
/// </summary>
internal sealed record WideContainer(string? Database, string? Schema, IReadOnlyList<string> Parts)
{
    public string Key => string.Join("\u0001", Parts) + "\u0002" + Database + "\u0002" + Schema;
}

/// <summary>
/// The names of one wide member as far as they are known: levels, the default container and the database / schema lists.
/// Pure lookups (the runtime loads the lists first).
/// </summary>
internal sealed class WideLayout
{
    public required string Alias { get; init; }
    public required IReadOnlyList<string> Levels { get; init; }

    /// <summary>Database every container lives in when the levels do not include one (whole database on SQL Server…).</summary>
    public string? FixedDatabase { get; init; }

    /// <summary>Schema of the only container of a member without levels.</summary>
    public string? FixedSchema { get; init; }

    /// <summary>One name per level; empty strings where the connection has no default.</summary>
    public required IReadOnlyList<string> DefaultPath { get; init; }

    /// <summary>Databases (levels database, schema).</summary>
    public IReadOnlyList<string> Databases { get; init; } = [];

    /// <summary>Schemas of the default (or fixed) database.</summary>
    public IReadOnlyList<string> Schemas { get; init; } = [];

    public bool HasDefault => DefaultPath.All(p => p.Length > 0);

    /// <summary>The default container (its tables answer to <c>alias.table</c>), or null when the connection has none.</summary>
    public WideContainer? Default => HasDefault ? Container(DefaultPath) : null;

    /// <summary>The container of a full path (one name per level).</summary>
    public WideContainer Container(IReadOnlyList<string> parts)
    {
        if (parts.Count != Levels.Count) throw new ArgumentException($"A path of {Levels.Count} names is expected.", nameof(parts));
        return Levels.Count switch
        {
            0 => new WideContainer(FixedDatabase, FixedSchema, []),
            1 => new WideContainer(FixedDatabase, parts[0], parts.ToList()),
            _ => new WideContainer(parts[0], parts[1], parts.ToList()),
        };
    }

    private static string? Match(IEnumerable<string> names, string name) =>
        names.FirstOrDefault(n => string.Equals(n, name, StringComparison.Ordinal))
        ?? names.FirstOrDefault(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase));

    public string? FindDatabase(string name) => Levels.Count == 2 ? Match(Databases, name) : null;

    /// <summary>A schema of the default / fixed database.</summary>
    public string? FindSchema(string name) => Levels.Count >= 1 ? Match(Schemas, name) : null;

    /// <summary>The name parts queries write for a table of <paramref name="c"/>: the default database / schema left out.</summary>
    public IReadOnlyList<string> PathOf(WideContainer c, string table)
    {
        bool Default(int level) => level < DefaultPath.Count && string.Equals(c.Parts[level], DefaultPath[level], StringComparison.OrdinalIgnoreCase);
        return c.Parts.Count switch
        {
            0 => [table],
            1 => Default(0) ? [table] : [c.Parts[0], table],
            // the default database may be left out alone (alias.schema.table); a default schema of another database may not
            _ => Default(0) ? (Default(1) ? [table] : [c.Parts[1], table]) : [c.Parts[0], c.Parts[1], table],
        };
    }

    /// <summary>The engine name of a table of <paramref name="c"/> (<see cref="PathOf"/> joined with ".").</summary>
    public string EngineName(WideContainer c, string table) => string.Join(".", PathOf(c, table));

    /// <summary>
    /// Where an engine name (<c>"sales.orders"</c>, <c>"shop.dbo.orders"</c>) would live, by the known lists: the container
    /// and the table's name inside it. Null when the name has no known prefix (then only the default container can have it).
    /// </summary>
    public (WideContainer Container, string Table)? Locate(string engineName)
    {
        var dot = engineName.IndexOf('.');
        if (dot <= 0 || dot == engineName.Length - 1) return null;
        var first = engineName[..dot];
        var rest = engineName[(dot + 1)..];
        if (Levels.Count == 2 && FindDatabase(first) is { } db)
        {
            var dot2 = rest.IndexOf('.');
            if (dot2 > 0 && dot2 < rest.Length - 1) return (Container([db, rest[..dot2]]), rest[(dot2 + 1)..]);
        }
        if (Levels.Count == 2 && HasDefault && FindSchema(first) is { } s2) return (Container([DefaultPath[0], s2]), rest);
        if (Levels.Count == 1 && FindSchema(first) is { } s1) return (Container([s1]), rest);
        return null;
    }
}

/// <summary>
/// Multi-part names of wide members in link SQL. DuckDB has at most three name parts and its schemas are the member
/// aliases, so <c>crm.sales.orders</c> (database scope) and <c>crm.shop.dbo.orders</c> (connection scope) are rewritten
/// to the engine table <c>crm."sales.orders"</c> / <c>crm."shop.dbo.orders"</c> before the statement is analysed or run;
/// the default database / schema is left out (<c>crm.dbo.customers</c> → <c>crm.customers</c>). A rewritten table in a
/// FROM / JOIN position without an alias gets <c>AS orders</c>, so <c>orders.amount</c> works as on the source; a column
/// written <c>crm.sales.orders.amount</c> becomes <c>orders.amount</c>. Strings, comments and quoted text are left alone
/// (tokenizer). A name whose second part is not a known schema / database is not touched (DuckDB reports it).
/// </summary>
internal static class LinkNames
{
    private static readonly HashSet<string> ClauseWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "SELECT", "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "OFFSET", "QUALIFY", "WINDOW", "UNION", "EXCEPT", "INTERSECT",
        "ON", "USING", "JOIN", "VALUES", "RETURNING", "FETCH",
    };

    /// <summary>Words that end a table reference (after them no alias follows).</summary>
    private static readonly HashSet<string> NotAnAlias = new(StringComparer.OrdinalIgnoreCase)
    {
        "WHERE", "GROUP", "ORDER", "LIMIT", "OFFSET", "HAVING", "QUALIFY", "WINDOW", "UNION", "EXCEPT", "INTERSECT", "JOIN", "INNER",
        "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "NATURAL", "POSITIONAL", "ASOF", "ANTI", "SEMI", "ON", "USING", "SAMPLE", "TABLESAMPLE",
        "PIVOT", "UNPIVOT", "FETCH", "FOR", "WITH", "RETURNING", "LATERAL", "SELECT",
    };

    private static readonly HashSet<string> TableIntro = new(StringComparer.OrdinalIgnoreCase)
    {
        "FROM", "JOIN", "DESCRIBE", "DESC", "SUMMARIZE", "TABLE",
    };

    internal static string NameOf(SqlToken t) =>
        t.Kind == SqlTokenKind.QuotedIdentifier && t.Value.Length >= 2 && t.Value[0] == '"' && t.Value[^1] == '"'
            ? t.Value[1..^1].Replace("\"\"", "\"", StringComparison.Ordinal)
            : t.Value;

    /// <summary>Aliases of wide members the text names (<c>alias.</c> somewhere), so the runtime loads only their lists.</summary>
    public static IReadOnlySet<string> NamedAliases(string sql, IEnumerable<string> wideAliases)
    {
        var wanted = new HashSet<string>(wideAliases, StringComparer.OrdinalIgnoreCase);
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (wanted.Count == 0) return found;
        var tokens = SqlTokenizer.Tokenize(sql, Dialect.DuckDb);
        for (var i = 0; i + 1 < tokens.Count; i++)
        {
            if (!tokens[i].IsIdentifier || !tokens[i + 1].IsPunct('.')) continue;
            if (i > 0 && tokens[i - 1].IsPunct('.')) continue;
            var name = NameOf(tokens[i]);
            if (wanted.Contains(name)) found.Add(name);
        }
        return found;
    }

    /// <summary>Engine names <c>alias.name</c> of wide members in (rewritten) SQL: what the runtime must load.</summary>
    public static IReadOnlyList<LinkTableRef> EngineReferences(string sql, IEnumerable<string> wideAliases)
    {
        var wanted = new HashSet<string>(wideAliases, StringComparer.OrdinalIgnoreCase);
        var list = new List<LinkTableRef>();
        if (wanted.Count == 0) return list;
        var tokens = SqlTokenizer.Tokenize(sql, Dialect.DuckDb);
        for (var i = 0; i + 2 < tokens.Count; i++)
        {
            if (!tokens[i].IsIdentifier || !tokens[i + 1].IsPunct('.') || !tokens[i + 2].IsIdentifier) continue;
            if (i > 0 && tokens[i - 1].IsPunct('.')) continue;
            var alias = NameOf(tokens[i]);
            if (!wanted.Contains(alias)) continue;
            var r = new LinkTableRef(alias, NameOf(tokens[i + 2]));
            if (!list.Contains(r)) list.Add(r);
        }
        return list;
    }

    /// <summary>Rewrites the multi-part names of <paramref name="layouts"/> (by alias, case-insensitive) in <paramref name="sql"/>.</summary>
    public static string Rewrite(string sql, IReadOnlyDictionary<string, WideLayout> layouts)
    {
        if (layouts.Count == 0) return sql;
        var tokens = SqlTokenizer.Tokenize(sql, Dialect.DuckDb);
        var edits = new List<(int Start, int End, string Text)>();
        var clause = new Stack<string?>();
        clause.Push(null);
        for (var i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.IsPunct('(')) { clause.Push(null); continue; }
            if (t.IsPunct(')')) { if (clause.Count > 1) clause.Pop(); continue; }
            if (t.Kind == SqlTokenKind.Word && ClauseWords.Contains(t.Value))
            {
                clause.Pop();
                clause.Push(t.Value.ToUpperInvariant());
            }
            if (!t.IsIdentifier || (i > 0 && tokens[i - 1].IsPunct('.'))) continue;
            if (!layouts.TryGetValue(NameOf(t), out var layout) || layout.Levels.Count == 0) continue;

            // the dotted chain alias.p1.p2…
            var parts = new List<int> { i };
            var j = i;
            while (j + 2 < tokens.Count && tokens[j + 1].IsPunct('.') && tokens[j + 2].IsIdentifier)
            {
                j += 2;
                parts.Add(j);
            }
            var names = parts.Select(p => NameOf(tokens[p])).ToList();
            WideContainer? container = null;
            var used = 0;
            if (layout.Levels.Count == 2 && names.Count >= 4 && layout.FindDatabase(names[1]) is { } db)
            {
                container = layout.Container([db, names[2]]);
                used = 4;
            }
            else if (names.Count >= 3 && layout.FindSchema(names[1]) is { } schema && (layout.Levels.Count == 1 || layout.HasDefault))
            {
                container = layout.Container(layout.Levels.Count == 1 ? [schema] : [layout.DefaultPath[0], schema]);
                used = 3;
            }
            if (container is null) { i = j; continue; }

            var table = names[used - 1];
            var engine = layout.EngineName(container, table);
            var aliasText = sql[t.Start..t.End];
            var lastTableToken = tokens[parts[used - 1]];
            string text;
            if (names.Count > used)
            {
                // a column: crm.sales.orders.amount → orders.amount (the table's implicit alias), crm.dbo.t.c → crm.t.c
                text = engine.Contains('.') ? LinkSql.QuoteIdent(table) : aliasText + "." + LinkSql.QuoteIdent(engine);
            }
            else
            {
                text = aliasText + "." + LinkSql.QuoteIdent(engine);
                var prev = i > 0 ? tokens[i - 1] : default;
                var tablePosition = i > 0 && ((prev.Kind == SqlTokenKind.Word && TableIntro.Contains(prev.Value))
                                              || (prev.IsPunct(',') && clause.Peek() is "FROM"));
                var next = parts[used - 1] + 1 < tokens.Count ? tokens[parts[used - 1] + 1] : (SqlToken?)null;
                var aliased = next is { } n && (n.IsWord("AS") || (n.IsIdentifier && !(n.Kind == SqlTokenKind.Word && NotAnAlias.Contains(n.Value))));
                if (engine.Contains('.') && tablePosition && !aliased) text += " AS " + LinkSql.QuoteIdent(table);
            }
            edits.Add((t.Start, lastTableToken.End, text));
            i = j;
        }
        if (edits.Count == 0) return sql;
        var sb = new System.Text.StringBuilder(sql.Length + edits.Count * 8);
        var at = 0;
        foreach (var (start, end, text) in edits)
        {
            sb.Append(sql, at, start - at).Append(text);
            at = end;
        }
        sb.Append(sql, at, sql.Length - at);
        return sb.ToString();
    }
}
