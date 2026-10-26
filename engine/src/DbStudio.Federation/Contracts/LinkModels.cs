using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0). Four work packages code against this file: change it only through an R3 request
// (docs/wp-notes/links/wp0.md). Wire mirror: ui/src/api/links.ts (camelCase, CoreJson.Options).

/// <summary>Well-known ids of the linked-databases feature.</summary>
public static class LinkIds
{
    /// <summary><see cref="ConnectionProfile.ProviderId"/> of a link; its provider's dialect is <see cref="Dialect.DuckDb"/>.</summary>
    public const string ProviderId = "linked";

    /// <summary>Explorer folder new links are saved into (the user may move them).</summary>
    public const string DefaultFolder = "Linked databases";

    /// <summary>Name of the per-link views folder (linked views are saved queries of the link under this schema).</summary>
    public const string ViewsSchema = "views";
}

/// <summary>
/// Keys of a link's <see cref="ConnectionProfile.Props"/>. A link is an ordinary saved connection (CRUD through
/// <c>/connections</c>, no password): its definition lives in these props, see <see cref="LinkDefinition.FromProfile"/>.
/// </summary>
public static class LinkProps
{
    /// <summary>JSON array of <see cref="LinkMember"/>.</summary>
    public const string Members = "members";
    /// <summary>JSON array of <see cref="VirtualRelation"/>.</summary>
    public const string Relations = "relations";
    /// <summary>JSON object <see cref="LinkOptions"/>.</summary>
    public const string Options = "options";
    /// <summary>Number: <see cref="LinkDefinition.Version"/>.</summary>
    public const string Version = "linkVersion";
}

/// <summary><see cref="LinkMember.Kind"/> tokens.</summary>
public static class LinkMemberKinds
{
    /// <summary>Tables of a saved connection (relational, MongoDB, Elasticsearch).</summary>
    public const string Connection = "connection";
    /// <summary>Local files (CSV/TSV, JSON/NDJSON, XLSX, Parquet), P3: <see cref="MountedTable.Name"/> is the absolute path.</summary>
    public const string Files = "files";
}

/// <summary>
/// The definition of one link: which tables of which connections it mounts, under which names, plus user-declared
/// relations between them. In SQL a mounted table is <c>alias.table</c> (DuckDB schema = <see cref="LinkMember.Alias"/>,
/// table = <see cref="MountedTable.LinkName"/>).
/// </summary>
public sealed record LinkDefinition
{
    public const int CurrentVersion = 1;

    public int Version { get; init; } = CurrentVersion;
    public IReadOnlyList<LinkMember> Members { get; init; } = [];
    public IReadOnlyList<VirtualRelation> Relations { get; init; } = [];
    public LinkOptions Options { get; init; } = new();

    /// <summary>The member mounted under <paramref name="alias"/> (case-insensitive), or null.</summary>
    public LinkMember? FindMember(string alias) =>
        Members.FirstOrDefault(m => string.Equals(m.Alias, alias, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Reads the definition from a link profile's props. Tolerant: missing keys give empty lists / default options, so a
    /// half-written profile still loads (validation reports what is wrong, see <c>POST /links/validate</c>).
    /// Throws <see cref="EngineException"/> VALIDATION for props that are not valid JSON shapes.
    /// </summary>
    public static LinkDefinition FromProfile(ConnectionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        try
        {
            var members = Read<List<LinkMember>>(profile, LinkProps.Members) ?? [];
            var relations = Read<List<VirtualRelation>>(profile, LinkProps.Relations) ?? [];
            var options = Read<LinkOptions>(profile, LinkProps.Options) ?? new LinkOptions();
            var version = profile.GetInt(LinkProps.Version, CurrentVersion);
            return new LinkDefinition { Version = version, Members = members, Relations = relations, Options = options };
        }
        catch (JsonException e)
        {
            throw EngineException.Validation($"The link definition of '{profile.Name}' is not valid: {e.Message}", new { field = "props" });
        }
    }

    /// <summary>Writes the definition into <paramref name="props"/> (replacing the four link keys, keeping any other prop).</summary>
    public void WriteTo(IDictionary<string, JsonNode?> props)
    {
        ArgumentNullException.ThrowIfNull(props);
        props[LinkProps.Version] = JsonValue.Create(Version);
        props[LinkProps.Members] = JsonSerializer.SerializeToNode(Members, CoreJson.Options);
        props[LinkProps.Relations] = JsonSerializer.SerializeToNode(Relations, CoreJson.Options);
        props[LinkProps.Options] = JsonSerializer.SerializeToNode(Options, CoreJson.Options);
    }

    private static T? Read<T>(ConnectionProfile p, string key) where T : class =>
        p.Props.TryGetValue(key, out var node) && node is not null ? node.Deserialize<T>(CoreJson.Options) : null;
}

/// <summary>One source of a link: some tables of one connection (or some files) mounted under a schema alias.</summary>
public sealed record LinkMember
{
    /// <summary>
    /// Schema name of the member inside the link: <c>^[a-z_][a-z0-9_]{0,62}$</c>, unique (case-insensitive) within the
    /// link, not one of <see cref="LinkRules.ReservedAliases"/>. The editor proposes <see cref="LinkRules.Slugify"/> of the
    /// connection name.
    /// </summary>
    public string Alias { get; init; } = "";

    /// <summary><see cref="LinkMemberKinds"/>; default <c>connection</c>.</summary>
    public string Kind { get; init; } = LinkMemberKinds.Connection;

    /// <summary>The saved connection (kind <c>connection</c>). Its credentials never leave the engine.</summary>
    public string? ConnectionId { get; init; }

    /// <summary>Database of providers with a database level (SQL Server, PostgreSQL, Snowflake); null = the connection's default.</summary>
    public string? Database { get; init; }

    /// <summary>
    /// Schema (Oracle schema, MySQL/ClickHouse database, Cassandra keyspace, MongoDB database; null = the connection's
    /// default). Elasticsearch and files have none.
    /// </summary>
    public string? Schema { get; init; }

    /// <summary>
    /// True: every table and view of the schema is mounted (resolved whenever the catalog loads, so new tables appear);
    /// <see cref="Tables"/> then only carries per-table overrides (<see cref="MountedTable.As"/>).
    /// </summary>
    public bool AllTables { get; init; }

    /// <summary>Mounted tables (explicit list), or overrides when <see cref="AllTables"/>.</summary>
    public IReadOnlyList<MountedTable> Tables { get; init; } = [];

    /// <summary>Optional display label of the member (explorer tooltip); the alias is what SQL uses.</summary>
    public string? Label { get; init; }
}

/// <summary>A table (view, collection, index, file) of a member, as it appears in the link.</summary>
public sealed record MountedTable
{
    /// <summary>
    /// Source name: relational table/view name inside <see cref="LinkMember.Database"/>.<see cref="LinkMember.Schema"/>,
    /// MongoDB collection, Elasticsearch index / alias / pattern, or the absolute path of a file.
    /// </summary>
    public string Name { get; init; } = "";

    /// <summary>
    /// Name inside the link (same rules as an alias, but case is kept); null = <see cref="Name"/>. Required for files
    /// (the editor proposes the slugified file name). Unique (case-insensitive) within the member.
    /// </summary>
    public string? As { get; init; }

    /// <summary>Informational source object type: an <see cref="ObjectTypes"/> token, or collection | index | file.</summary>
    public string? Type { get; init; }

    /// <summary>
    /// Fetcher-specific options. Files: <c>format</c> (csv | tsv | json | ndjson | xlsx | parquet), <c>sheet</c>,
    /// <c>delimiter</c>, <c>header</c>, <c>encoding</c>. MongoDB: <c>sampleSize</c> (schema inference). Unknown keys are ignored.
    /// </summary>
    public JsonObject? Options { get; init; }

    /// <summary>The table name SQL uses: <see cref="As"/> ?? <see cref="Name"/>.</summary>
    [JsonIgnore] public string LinkName => string.IsNullOrEmpty(As) ? Name : As;
}

/// <summary>A mounted table addressed the way SQL addresses it: <c>alias.table</c>.</summary>
public sealed record LinkTableRef(string Alias, string Table)
{
    public override string ToString() => $"{Alias}.{Table}";
}

/// <summary>
/// A user-declared relation between two mounted tables (typically across members, where no FK can exist). Shaped like
/// a foreign key: <see cref="From"/> (the many side) references <see cref="To"/> (the one side), column by column.
/// The link catalog reports it as a foreign key of <see cref="From"/>; the builder suggests joins from it.
/// </summary>
public sealed record VirtualRelation
{
    public string Id { get; init; } = "";
    public string? Name { get; init; }
    public LinkTableRef From { get; init; } = new("", "");
    public IReadOnlyList<string> FromColumns { get; init; } = [];
    public LinkTableRef To { get; init; } = new("", "");
    public IReadOnlyList<string> ToColumns { get; init; } = [];
}

/// <summary>Per-link overrides of the <c>links.*</c> settings (null = the setting).</summary>
public sealed record LinkOptions
{
    /// <summary>Row cap per mounted table and query (settings <c>links.maxRowsPerSource</c>).</summary>
    public long? MaxRowsPerSource { get; init; }

    /// <summary>Per source fetch timeout (settings <c>links.fetchTimeoutSeconds</c>).</summary>
    public int? FetchTimeoutSeconds { get; init; }

    /// <summary>Reuse fetched sources within a session until "Refresh sources" (settings <c>links.cacheSources</c>).</summary>
    public bool? CacheSources { get; init; }

    /// <summary>"duckdb" | "sqlite" | null (auto: DuckDB, SQLite when the native library cannot load).</summary>
    public string? Engine { get; init; }
}

/// <summary>Effective limits of one federated query (settings merged with <see cref="LinkOptions"/>).</summary>
/// <param name="MaxRowsPerSource">Row cap per mounted table; a fetcher reads at most this many rows (+1 to detect truncation).</param>
/// <param name="FetchTimeout">Per source fetch timeout.</param>
/// <param name="MemoryLimitBytes">DuckDB <c>memory_limit</c>; beyond it DuckDB spills to <paramref name="TempDirectory"/>.</param>
/// <param name="Threads">DuckDB threads (0 = DuckDB's default).</param>
/// <param name="TempDirectory">Spill directory of the session: <c>&lt;DataDir&gt;/tmp/links/&lt;sessionId&gt;</c>, deleted on close.</param>
/// <param name="CacheSources">Keep fetched tables for the session's next queries.</param>
public sealed record FederationLimits(long MaxRowsPerSource, TimeSpan FetchTimeout, long MemoryLimitBytes, int Threads, string TempDirectory, bool CacheSources);
