using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0). WP-A writes RelationalFetcher (every relational provider id); WP-B writes the P3 fetchers
// (MongoFetcher "mongodb", ElasticFetcher "elasticsearch", FileFetcher "files"); WP-A's session and runtime consume them.

/// <summary>
/// Reads one member's catalog and fetches mounted tables into the federation engine. Registered keyed by provider id
/// (<c>services.AddKeyedSingleton&lt;ISourceFetcher, RelationalFetcher&gt;("postgresql")</c>, …; files members use
/// <see cref="FetcherKeys.Files"/>) and resolved with <c>GetKeyedService&lt;ISourceFetcher&gt;(key)</c>; a member whose
/// key has no fetcher is reported by validation (problem <see cref="LinkProblemCodes.MemberUnsupported"/>).
/// Stateless and thread-safe: the session fetches different tables of one member in parallel.
/// <para>
/// Correctness rule: a fetch may return MORE rows than the query needs, never fewer (except the documented row cap,
/// which the plan reports as truncation). The federation engine re-applies every predicate of the query, so a fetcher
/// that cannot push a predicate simply drops it in <see cref="Accept"/>.
/// </para>
/// </summary>
public interface ISourceFetcher
{
    /// <summary>
    /// The member's mounted tables with columns, keys and same-source foreign keys: the explicit
    /// <see cref="LinkMember.Tables"/>, or every table and view of the schema when <see cref="LinkMember.AllTables"/>
    /// (with the overrides applied). A mounted table that no longer exists is left out with a warning.
    /// </summary>
    Task<SourceCatalog> LoadCatalogAsync(SourceContext context, CancellationToken ct);

    /// <summary>
    /// What this fetcher will actually push for <paramref name="proposed"/>: the same request with the predicates it
    /// cannot render removed. Dropping any predicate must also drop <see cref="FetchRequest.Limit"/> (a limit is only
    /// correct when every predicate is applied at the source). Pure: no I/O.
    /// </summary>
    FetchRequest Accept(SourceContext context, FetchRequest proposed);

    /// <summary>The source query text of an accepted request, for the plan preview (SQL, a Mongo pipeline, an ES body…). Never executed.</summary>
    string Describe(SourceContext context, FetchRequest request);

    /// <summary>
    /// Runs an accepted request and appends the rows to <paramref name="target"/> (an engine table created with exactly
    /// <see cref="FetchRequest.Columns"/>, in that order). Reads at most <see cref="FetchRequest.MaxRows"/> rows and one
    /// more to report <see cref="FetchResult.Truncated"/>. Cancellation: cancels the driver command
    /// (<c>DbCommand.Cancel</c>) and throws <see cref="OperationCanceledException"/>. Driver errors are thrown as
    /// <see cref="FetchException"/> (message names the member and table).
    /// </summary>
    Task<FetchResult> FetchAsync(SourceContext context, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct);
}

/// <summary>Fetcher keys that are not provider ids.</summary>
public static class FetcherKeys
{
    /// <summary>Members of kind <see cref="LinkMemberKinds.Files"/>.</summary>
    public const string Files = "files";

    /// <summary>The key of a member: its connection's provider id, or <see cref="Files"/>.</summary>
    public static string For(LinkMember member, string? providerId) =>
        member.Kind == LinkMemberKinds.Files ? Files : providerId ?? "";
}

/// <summary>Everything a fetcher needs about one member. Built by the runtime per query (never persisted, never sent to the UI).</summary>
public sealed class SourceContext
{
    public required LinkMember Member { get; init; }

    /// <summary>The member connection, a runtime copy with its secrets restored (<c>ConnectionStore.WithSecrets</c>); null for files.</summary>
    public ConnectionProfile? Profile { get; init; }

    /// <summary>The member connection's password (secret store), or null.</summary>
    public string? Password { get; init; }

    /// <summary>The relational provider of the member connection, null for MongoDB / Elasticsearch / files.</summary>
    public IDbProvider? Provider { get; init; }

    /// <summary>The provider of a non-relational member connection (MongoDB, Elasticsearch), else null.</summary>
    public IDataSourceProvider? Source { get; init; }

    /// <summary>Dialect of a relational member (push-down SQL rendering), else null.</summary>
    public Dialect? Dialect => Provider?.Dialect;

    public required FederationLimits Limits { get; init; }

    /// <summary>The engine's services (SourceClientManager, ConnectionStore, ProviderFeatures, loggers…).</summary>
    public required IServiceProvider Services { get; init; }

    /// <summary>Federated session the fetch belongs to (null for catalog reads / validation).</summary>
    public string? SessionId { get; init; }
}

/// <summary>A member's catalog as the link sees it.</summary>
public sealed record SourceCatalog(IReadOnlyList<SourceTable> Tables, IReadOnlyList<string> Warnings);

/// <summary>One mounted table with its source columns.</summary>
/// <param name="Name">Source name (<see cref="MountedTable.Name"/>).</param>
/// <param name="LinkName">Name inside the link (<see cref="MountedTable.LinkName"/>).</param>
/// <param name="Database">Source database (providers with a database level), else null.</param>
/// <param name="Schema">Source schema (or MongoDB database / MySQL database…), else null.</param>
/// <param name="Type">ObjectTypes token (table, view, mview…) or collection | index | file.</param>
/// <param name="PrimaryKey">Source primary key columns (source names), empty when none.</param>
/// <param name="ForeignKeys">Same-source foreign keys whose referenced table is mounted in the same member (source names; RefTable = source name).</param>
/// <param name="RowEstimate">Server row estimate, when cheap to get.</param>
/// <param name="Options">The mounted table's <see cref="MountedTable.Options"/>.</param>
public sealed record SourceTable(
    string Name,
    string LinkName,
    string? Database,
    string? Schema,
    string Type,
    IReadOnlyList<SourceColumn> Columns,
    IReadOnlyList<string> PrimaryKey,
    IReadOnlyList<ForeignKeyRef> ForeignKeys,
    long? RowEstimate = null,
    JsonObject? Options = null,
    string? Comment = null);

/// <summary>A source column.</summary>
/// <param name="SourceType">Type text as the source reports it ("nvarchar(50)", "NUMBER(10,2)", "Nullable(String)"…).</param>
/// <param name="Kind"><see cref="Core.Services.ColumnKinds"/> token (ValueConverter.KindFor); decides the engine type (WP-A TypeMap).</param>
/// <param name="Collation">Source collation when known (plan warnings on joins across collations).</param>
public sealed record SourceColumn(
    string Name,
    string SourceType,
    string Kind,
    bool Nullable,
    bool IsPk = false,
    int? Size = null,
    int? Precision = null,
    int? Scale = null,
    string? Collation = null);

/// <summary>What to fetch from one mounted table.</summary>
public sealed record FetchRequest
{
    public required SourceTable Table { get; init; }

    /// <summary>
    /// Projection (source column names), never empty: the analyzer always pushes the projection; a query that needs no
    /// column of the table (COUNT(*)) fetches its first key column, else its first column.
    /// </summary>
    public required IReadOnlyList<string> Columns { get; init; }

    /// <summary>Conjunctive single-table predicates (AND), see <see cref="PushdownPredicate"/>.</summary>
    public IReadOnlyList<PushdownPredicate> Predicates { get; init; } = [];

    /// <summary>LIMIT to push (only for single-table queries without joins/aggregates/DISTINCT/ORDER BY whose predicates are all pushed).</summary>
    public long? Limit { get; init; }

    /// <summary>Row cap (<see cref="FederationLimits.MaxRowsPerSource"/>, or the limit when smaller).</summary>
    public required long MaxRows { get; init; }

    public required TimeSpan Timeout { get; init; }
}

/// <summary>Outcome of one fetch.</summary>
/// <param name="Rows">Rows appended.</param>
/// <param name="Truncated">The source had more than <see cref="FetchRequest.MaxRows"/> rows.</param>
/// <param name="SourceQuery">What was sent to the source (as <see cref="ISourceFetcher.Describe"/>).</param>
/// <param name="ConversionFailures">Values the appender could not convert to the column type (stored as NULL), see <see cref="IFederationAppender"/>.</param>
public sealed record FetchResult(long Rows, bool Truncated, string SourceQuery, long ElapsedMs, long ConversionFailures = 0, IReadOnlyList<string>? Warnings = null);

/// <summary><see cref="PushdownPredicate.Op"/> tokens.</summary>
public static class PushdownOps
{
    public const string Eq = "=", Ne = "<>", Lt = "<", Gt = ">", Le = "<=", Ge = ">=", In = "in", Between = "between", Like = "like",
        IsNotNull = "isNotNull";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Eq, Ne, Lt, Gt, Le, Ge, In, Between, Like, IsNotNull };
}

/// <summary>
/// <c>column Op literal(s)</c> on one mounted table (column = source name). Values: none for isNotNull, two for
/// between, one or more for in, one otherwise. Never IS NULL, functions, parameters, OR, or a column on both sides
/// (plan-links 1, "Push-down").
/// </summary>
public sealed record PushdownPredicate(string Column, string Op, IReadOnlyList<PushdownLiteral> Values);

/// <summary>
/// A typed literal. <see cref="Kind"/> is a ColumnKinds token (int, decimal, float, string, bool, date, time, datetime,
/// datetimeoffset, guid); <see cref="Value"/> is the invariant text form: integers/decimals as digits ("-12", "120.50"),
/// floats round-trip ("R"), bools "true"/"false", dates "yyyy-MM-dd", times "HH:mm:ss[.fffffff]", datetimes
/// "yyyy-MM-ddTHH:mm:ss[.fffffff]", datetimeoffsets ISO 8601 with offset, guids lower-case "D" format, strings verbatim.
/// Each fetcher renders it for its source (T-SQL N'…', Oracle DATE '…' / TO_TIMESTAMP, booleans 1/0 on T-SQL/Oracle…).
/// </summary>
public sealed record PushdownLiteral(string Kind, string Value);

/// <summary>A fetcher's failure, reported per member/table (the query fails with PROVIDER_ERROR naming them).</summary>
public sealed class FetchException(string alias, string table, string message, Exception? inner = null)
    : Exception($"{alias}.{table}: {message}", inner)
{
    public string Alias { get; } = alias;
    public string Table { get; } = table;
}
