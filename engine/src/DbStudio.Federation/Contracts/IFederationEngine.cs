using System.Data.Common;
using DbStudio.Core.Params;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0). WP-A implements DuckDbEngine and SqliteFederationEngine (the fallback) and the factory;
// fetchers (WP-A, WP-B) write through IFederationAppender; materialize (WP-B) reads through ILinkRuntime.

/// <summary>
/// Opens federation engines. One engine instance per federated session (its tables are the session's fetched
/// sources), plus short-lived ones for parsing and validation. Registered as a singleton.
/// </summary>
public interface IFederationEngineFactory
{
    /// <summary>
    /// Opens an in-memory engine. <see cref="FederationEngineOptions.Engine"/> null = DuckDB, falling back to SQLite (with
    /// a warning on the session) when libduckdb cannot load; "duckdb" / "sqlite" force one (no fallback).
    /// </summary>
    Task<IFederationEngine> OpenAsync(FederationEngineOptions options, CancellationToken ct);

    /// <summary>Which engine is usable and why not (GET /links/engine, the native smoke test). Loads libduckdb once.</summary>
    FederationEngineInfo Probe();
}

/// <param name="Engine">"duckdb" | "sqlite" | null (auto).</param>
/// <param name="MemoryLimitBytes">DuckDB memory_limit (0 = DuckDB default).</param>
/// <param name="Threads">DuckDB threads (0 = default).</param>
/// <param name="TempDirectory">Spill directory (created by the engine, deleted on dispose); null = no spilling.</param>
public sealed record FederationEngineOptions(string? Engine, long MemoryLimitBytes, int Threads, string? TempDirectory);

/// <param name="Engine">The engine <see cref="IFederationEngineFactory.OpenAsync"/> would use: "duckdb" | "sqlite".</param>
/// <param name="Version">DuckDB library version ("v1.4.1") or SQLite version.</param>
/// <param name="SerializeSql"><c>json_serialize_sql</c> works (the builder's SQL → model parse and the analyzer's AST).</param>
/// <param name="Error">Why DuckDB is not usable (missing/unloadable native library), else null.</param>
public sealed record FederationEngineInfo(string Engine, string Version, bool SerializeSql, string? Error = null);

/// <summary>Capabilities of an engine instance.</summary>
[Flags]
public enum FederationEngineFeatures
{
    None = 0,
    /// <summary>Runs any DuckDB SQL (false for the SQLite fallback: only the builder subset is guaranteed).</summary>
    FullSql = 1,
    /// <summary><see cref="IFederationEngine.SerializeSqlAsync"/> parses (DuckDB).</summary>
    SerializeSql = 2,
    /// <summary>Spills beyond the memory limit.</summary>
    Spill = 4,
    /// <summary><see cref="IFederationEngine.Interrupt"/> stops a running query.</summary>
    Interrupt = 8,
}

/// <summary>
/// One in-memory federation database. Schemas are member aliases, tables mounted table names, so the user's SQL runs
/// unchanged (<c>crm.customers</c>). Not thread-safe for queries (one at a time, the session serializes them), but
/// <see cref="OpenAppender"/> may be called concurrently for different tables (each appender uses its own connection).
/// </summary>
public interface IFederationEngine : IAsyncDisposable
{
    /// <summary>"duckdb" | "sqlite".</summary>
    string Name { get; }
    string Version { get; }
    FederationEngineFeatures Features { get; }

    /// <summary>CREATE SCHEMA IF NOT EXISTS.</summary>
    Task EnsureSchemaAsync(string schema, CancellationToken ct);

    /// <summary>Creates (or with <paramref name="replace"/> re-creates) <c>schema.table</c> with the given columns.</summary>
    Task CreateTableAsync(string schema, string table, IReadOnlyList<FederatedColumn> columns, bool replace, CancellationToken ct);

    Task DropTableAsync(string schema, string table, CancellationToken ct);

    /// <summary>Bulk writer into an existing table whose columns are <paramref name="columns"/> (DuckDB Appender API).</summary>
    IFederationAppender OpenAppender(string schema, string table, IReadOnlyList<FederatedColumn> columns);

    /// <summary>
    /// Runs a query. Parameters bind by name (<c>$name</c> in DuckDB SQL, see <see cref="QueryParam.BareName"/>). The reader
    /// is owned by the caller; <see cref="Interrupt"/> stops it from another thread.
    /// </summary>
    Task<DbDataReader> ExecuteReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct);

    Task<long> ExecuteNonQueryAsync(string sql, CancellationToken ct);

    /// <summary><c>SELECT json_serialize_sql(sql)</c>: the DuckDB AST as JSON. SQLite: <see cref="SqlAst.Supported"/> false.</summary>
    Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct);

    /// <summary>Interrupts the running query (thread-safe, no-op when idle).</summary>
    void Interrupt();
}

/// <summary>A column of an engine table.</summary>
/// <param name="Name">Column name (the source column name).</param>
/// <param name="Kind">ColumnKinds token of the source column; decides how <see cref="IFederationAppender"/> converts values.</param>
/// <param name="EngineType">Engine type (WP-A TypeMap: BIGINT, HUGEINT, DOUBLE, DECIMAL(38,s), VARCHAR, BOOLEAN, DATE, TIME,
/// TIMESTAMP, TIMESTAMPTZ, UUID, BLOB, JSON).</param>
/// <param name="SourceType">The source type text (plan warnings, result column metadata).</param>
public sealed record FederatedColumn(string Name, string Kind, string EngineType, bool Nullable = true, string? SourceType = null);

/// <summary>
/// Appends rows to one engine table. Single-threaded; dispose to flush and close. Accepts the CLR values drivers return
/// (any integer type, decimal, double/float, string, bool, DateTime, DateTimeOffset, DateOnly, TimeOnly, TimeSpan, Guid,
/// byte[], BigInteger, Core.Services wire values) and converts them per <see cref="FederatedColumn.Kind"/>: a value that
/// cannot be converted is stored as NULL and counted in <see cref="ConversionFailures"/>; DBNull and null are NULL;
/// DateTimeOffset is stored in UTC; guids lower-case.
/// </summary>
public interface IFederationAppender : IDisposable
{
    /// <summary>One row, values in column order (length = column count).</summary>
    void AppendRow(ReadOnlySpan<object?> values);

    long Rows { get; }
    long ConversionFailures { get; }
}

/// <summary>Result of <see cref="IFederationEngine.SerializeSqlAsync"/>.</summary>
/// <param name="Supported">The engine has a parser (false on the SQLite fallback).</param>
/// <param name="Ok">The SQL parsed.</param>
/// <param name="Json">The <c>json_serialize_sql</c> output when <paramref name="Ok"/>.</param>
/// <param name="Error">Parser message when not <paramref name="Ok"/>.</param>
public sealed record SqlAst(bool Supported, bool Ok, string? Json, string? Error = null);
