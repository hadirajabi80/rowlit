using System.Data.Common;
using System.Globalization;
using System.Numerics;
using DbStudio.Core.Params;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;
using DuckDB.NET.Data;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Federation.Engine;

/// <summary>What the runtime needs beyond <see cref="IFederationEngine"/>: the query connection (the console session runs
/// its commands on it) and how to tell a missing-column binder error.</summary>
internal interface IFederationEngineInternals
{
    /// <summary>The connection queries run on (DuckDBConnection / SqliteConnection). Owned by the engine.</summary>
    DbConnection QueryConnection { get; }

    /// <summary>The error means a referenced column is not in an engine table (the projection missed it).</summary>
    bool IsMissingColumnError(Exception e);

    /// <summary>The error is the engine's reaction to <see cref="IFederationEngine.Interrupt"/>.</summary>
    bool IsInterrupt(Exception e);

    /// <summary>Registers a running command so <see cref="IFederationEngine.Interrupt"/> reaches it.</summary>
    IDisposable Track(DbCommand command);

    /// <summary>
    /// Runs a query on its own connection of the same database (DuckDB: a duplicated connection, so it can run while the
    /// console session queries; SQLite: the shared connection under the engine lock). The reader owns the connection.
    /// </summary>
    Task<DbDataReader> ExecuteIsolatedReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct);
}

/// <summary>
/// Opens federation engines: DuckDB, or the SQLite fallback when libduckdb does not load (plan-links 1). Singleton.
/// </summary>
public sealed class DuckDbEngineFactory(ILogger<DuckDbEngineFactory>? log = null) : IFederationEngineFactory
{
    private readonly ILogger _log = log ?? (ILogger)NullLogger.Instance;

    public FederationEngineInfo Probe() => DuckDbProbe.Info;

    public Task<IFederationEngine> OpenAsync(FederationEngineOptions options, CancellationToken ct) =>
        OpenAsync(options, [], null, ct);

    /// <summary>
    /// Opens an engine with <paramref name="schemas"/> created and (DuckDB) <c>search_path</c> = <paramref name="defaultSchema"/>
    /// before the configuration is locked.
    /// </summary>
    internal async Task<IFederationEngine> OpenAsync(FederationEngineOptions options, IReadOnlyList<string> schemas, string? defaultSchema, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(options);
        var wanted = options.Engine?.Trim().ToLowerInvariant();
        if (wanted is "sqlite") return await SqliteFederationEngine.OpenAsync(options, schemas, ct).ConfigureAwait(false);
        if (wanted is not (null or "" or "duckdb"))
            throw new ArgumentException($"Unknown federation engine '{options.Engine}' (duckdb | sqlite).", nameof(options));
        if (wanted is null or "" && Probe().Engine != "duckdb")
        {
            _log.LogWarning("DuckDB is not available ({Error}); linked databases run on the SQLite fallback engine", Probe().Error);
            return await SqliteFederationEngine.OpenAsync(options, schemas, ct).ConfigureAwait(false);
        }
        return await Task.Run(() => DuckDbEngine.Open(options, schemas, defaultSchema), ct).ConfigureAwait(false);
    }
}

/// <summary>
/// The DuckDB federation engine (plan-links 1): an in-memory database whose schemas are member aliases. Configuration
/// (memory_limit, threads, temp_directory, TimeZone UTC, search_path) is applied first, then the lockdown of
/// <see cref="DuckDbProbe.LockdownStatements"/> (no extension install/load, no file or network access) and
/// <c>lock_configuration</c>, so user SQL cannot undo any of it. Appenders run on duplicated connections of the same
/// database (<see cref="DuckDBConnection.Duplicate"/>); DDL and queries on the main connection, serialized.
/// </summary>
internal sealed class DuckDbEngine : IFederationEngine, IFederationEngineInternals
{
    private readonly DuckDBConnection _connection;
    private readonly string? _tempDirectory;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _commandsLock = new();
    private readonly HashSet<DbCommand> _running = [];
    private int _disposed;

    private DuckDbEngine(DuckDBConnection connection, string version, string? tempDirectory)
    {
        _connection = connection;
        Version = version;
        _tempDirectory = tempDirectory;
    }

    public string Name => "duckdb";
    public string Version { get; }
    public FederationEngineFeatures Features => FederationEngineFeatures.FullSql | FederationEngineFeatures.SerializeSql | FederationEngineFeatures.Interrupt
                                                | (_tempDirectory is null ? FederationEngineFeatures.None : FederationEngineFeatures.Spill);
    public DbConnection QueryConnection => _connection;

    /// <summary>The configuration statements applied before the lockdown (tests read them).</summary>
    internal static IReadOnlyList<string> ConfigurationStatements(FederationEngineOptions options, IReadOnlyList<string> schemas, string? defaultSchema)
    {
        var list = new List<string>();
        if (options.MemoryLimitBytes > 0)
            list.Add($"SET memory_limit = '{Math.Max(1, options.MemoryLimitBytes / (1024 * 1024)).ToString(CultureInfo.InvariantCulture)}MiB'");
        if (options.Threads > 0) list.Add($"SET threads = {options.Threads.ToString(CultureInfo.InvariantCulture)}");
        // In-memory databases spill to temp_directory; without one (null) nothing is written to disk.
        list.Add($"SET temp_directory = {Literal(options.TempDirectory ?? "")}");
        list.Add("SET GLOBAL TimeZone = 'UTC'");
        foreach (var s in schemas.Distinct(StringComparer.OrdinalIgnoreCase)) list.Add($"CREATE SCHEMA IF NOT EXISTS {LinkSql.QuoteIdent(s)}");
        if (!string.IsNullOrEmpty(defaultSchema)) list.Add($"SET search_path = {Literal(defaultSchema)}");
        return list;
    }

    internal static DuckDbEngine Open(FederationEngineOptions options, IReadOnlyList<string> schemas, string? defaultSchema)
    {
        if (options.TempDirectory is { Length: > 0 } dir) Directory.CreateDirectory(dir);
        var c = new DuckDBConnection(DuckDbProbe.InMemoryConnectionString);
        try
        {
            c.Open();
            foreach (var sql in ConfigurationStatements(options, schemas, defaultSchema)) Exec(c, sql);
            foreach (var sql in DuckDbProbe.LockdownStatements) Exec(c, sql);
            Exec(c, "SET lock_configuration = true");
            string version;
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT version()";
                version = cmd.ExecuteScalar() as string ?? "";
            }
            return new DuckDbEngine(c, version, string.IsNullOrEmpty(options.TempDirectory) ? null : options.TempDirectory);
        }
        catch
        {
            c.Dispose();
            if (options.TempDirectory is { Length: > 0 } d) TryDeleteDirectory(d);
            throw;
        }
    }

    private static void Exec(DuckDBConnection c, string sql)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    internal static string Literal(string s) => "'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";

    public async Task EnsureSchemaAsync(string schema, CancellationToken ct) =>
        await ExecuteNonQueryAsync($"CREATE SCHEMA IF NOT EXISTS {LinkSql.QuoteIdent(schema)}", ct).ConfigureAwait(false);

    public async Task CreateTableAsync(string schema, string table, IReadOnlyList<FederatedColumn> columns, bool replace, CancellationToken ct)
    {
        if (columns.Count == 0) throw new ArgumentException("A table needs at least one column.", nameof(columns));
        var cols = string.Join(", ", columns.Select(c => $"{LinkSql.QuoteIdent(c.Name)} {c.EngineType}"));
        var sql = $"CREATE {(replace ? "OR REPLACE " : "")}TABLE {LinkSql.Qualified(schema, table)} ({cols})";
        await ExecuteNonQueryAsync($"CREATE SCHEMA IF NOT EXISTS {LinkSql.QuoteIdent(schema)}", ct).ConfigureAwait(false);
        await ExecuteNonQueryAsync(sql, ct).ConfigureAwait(false);
    }

    public async Task DropTableAsync(string schema, string table, CancellationToken ct) =>
        await ExecuteNonQueryAsync($"DROP TABLE IF EXISTS {LinkSql.Qualified(schema, table)}", ct).ConfigureAwait(false);

    public IFederationAppender OpenAppender(string schema, string table, IReadOnlyList<FederatedColumn> columns)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        var dup = _connection.Duplicate();
        try
        {
            if (dup.State != System.Data.ConnectionState.Open) dup.Open();
            var appender = dup.CreateAppender(schema, table);
            return new DuckDbAppender(dup, appender, columns);
        }
        catch
        {
            dup.Dispose();
            throw;
        }
    }

    public async Task<DbDataReader> ExecuteReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        var cmd = _connection.CreateCommand();
        try
        {
            cmd.CommandText = sql;
            cmd.UseStreamingMode = true;
            if (parameters is { Count: > 0 }) DuckDbParamBinder.Instance.Bind(cmd, parameters, new ParamBindCursor());
            var tracking = Track(cmd);
            await using var reg = ct.Register(() => { try { cmd.Cancel(); } catch { /* best effort */ } });
            var reader = await Task.Run(() => cmd.ExecuteReader(), CancellationToken.None).ConfigureAwait(false);
            return new OwnedReader(reader, () =>
            {
                tracking.Dispose();
                cmd.Dispose();
                _gate.Release();
            });
        }
        catch
        {
            cmd.Dispose();
            _gate.Release();
            throw;
        }
    }

    public async Task<DbDataReader> ExecuteIsolatedReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        var dup = _connection.Duplicate();
        DuckDBCommand? cmd = null;
        try
        {
            if (dup.State != System.Data.ConnectionState.Open) dup.Open();
            cmd = dup.CreateCommand();
            cmd.CommandText = sql;
            cmd.UseStreamingMode = true;
            if (parameters is { Count: > 0 }) DuckDbParamBinder.Instance.Bind(cmd, parameters, new ParamBindCursor());
            var tracking = Track(cmd);
            var command = cmd;
            await using var reg = ct.Register(() => { try { command.Cancel(); } catch { /* best effort */ } });
            var reader = await Task.Run(() => command.ExecuteReader(), CancellationToken.None).ConfigureAwait(false);
            return new OwnedReader(reader, () =>
            {
                tracking.Dispose();
                command.Dispose();
                dup.Dispose();
            });
        }
        catch
        {
            cmd?.Dispose();
            dup.Dispose();
            throw;
        }
    }

    public async Task<long> ExecuteNonQueryAsync(string sql, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await Task.Run(() =>
            {
                using var cmd = _connection.CreateCommand();
                cmd.CommandText = sql;
                using var t = Track(cmd);
                return (long)cmd.ExecuteNonQuery();
            }, ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct) =>
        Task.Run(() =>
        {
            // json_serialize_sql only parses: it runs on its own duplicated connection so it never waits for a query.
            using var dup = _connection.Duplicate();
            if (dup.State != System.Data.ConnectionState.Open) dup.Open();
            return DuckDbProbe.SerializeSql(dup, sql);
        }, ct);

    public void Interrupt()
    {
        DbCommand[] running;
        lock (_commandsLock) running = [.. _running];
        foreach (var cmd in running)
        {
            try { cmd.Cancel(); } catch { /* best effort */ }
        }
    }

    public IDisposable Track(DbCommand command)
    {
        lock (_commandsLock) _running.Add(command);
        return new Untrack(this, command);
    }

    private sealed class Untrack(DuckDbEngine engine, DbCommand command) : IDisposable
    {
        public void Dispose()
        {
            lock (engine._commandsLock) engine._running.Remove(command);
        }
    }

    public bool IsMissingColumnError(Exception e) =>
        e is DuckDBException d && d.Message.Contains("Binder Error", StringComparison.OrdinalIgnoreCase)
        && (d.Message.Contains("Referenced column", StringComparison.OrdinalIgnoreCase)
            || d.Message.Contains("does not have a column", StringComparison.OrdinalIgnoreCase)
            || d.Message.Contains("not found in FROM clause", StringComparison.OrdinalIgnoreCase)
            || d.Message.Contains("could not be found", StringComparison.OrdinalIgnoreCase));

    public bool IsInterrupt(Exception e) =>
        e is OperationCanceledException
        || (e is DuckDBException d && (d.Message.Contains("INTERRUPT", StringComparison.OrdinalIgnoreCase)
                                       || d.Message.Contains("Interrupted", StringComparison.OrdinalIgnoreCase)));

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        Interrupt();
        try
        {
            await _gate.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch (ObjectDisposedException) { /* already */ }
        try { _connection.Dispose(); } catch { /* closing */ }
        if (_tempDirectory is not null) TryDeleteDirectory(_tempDirectory);
    }

    internal static void TryDeleteDirectory(string dir)
    {
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* a spill file still open: left for the next start */ }
    }
}

/// <summary>A reader that releases its command (and the engine gate) when disposed.</summary>
internal sealed class OwnedReader(DbDataReader inner, Action release) : DbDataReader
{
    private int _released;

    private void ReleaseOnce()
    {
        if (Interlocked.Exchange(ref _released, 1) == 0) release();
    }

    public override object this[int ordinal] => inner[ordinal];
    public override object this[string name] => inner[name];
    public override int Depth => inner.Depth;
    public override int FieldCount => inner.FieldCount;
    public override bool HasRows => inner.HasRows;
    public override bool IsClosed => inner.IsClosed;
    public override int RecordsAffected => inner.RecordsAffected;
    public override bool GetBoolean(int ordinal) => inner.GetBoolean(ordinal);
    public override byte GetByte(int ordinal) => inner.GetByte(ordinal);
    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => inner.GetBytes(ordinal, dataOffset, buffer, bufferOffset, length);
    public override char GetChar(int ordinal) => inner.GetChar(ordinal);
    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => inner.GetChars(ordinal, dataOffset, buffer, bufferOffset, length);
    public override string GetDataTypeName(int ordinal) => inner.GetDataTypeName(ordinal);
    public override DateTime GetDateTime(int ordinal) => inner.GetDateTime(ordinal);
    public override decimal GetDecimal(int ordinal) => inner.GetDecimal(ordinal);
    public override double GetDouble(int ordinal) => inner.GetDouble(ordinal);
    public override Type GetFieldType(int ordinal) => inner.GetFieldType(ordinal);
    public override float GetFloat(int ordinal) => inner.GetFloat(ordinal);
    public override Guid GetGuid(int ordinal) => inner.GetGuid(ordinal);
    public override short GetInt16(int ordinal) => inner.GetInt16(ordinal);
    public override int GetInt32(int ordinal) => inner.GetInt32(ordinal);
    public override long GetInt64(int ordinal) => inner.GetInt64(ordinal);
    public override string GetName(int ordinal) => inner.GetName(ordinal);
    public override int GetOrdinal(string name) => inner.GetOrdinal(name);
    public override string GetString(int ordinal) => inner.GetString(ordinal);
    public override object GetValue(int ordinal) => inner.GetValue(ordinal);
    public override int GetValues(object[] values) => inner.GetValues(values);
    public override bool IsDBNull(int ordinal) => inner.IsDBNull(ordinal);
    public override bool NextResult() => inner.NextResult();
    public override bool Read() => inner.Read();
    public override System.Collections.IEnumerator GetEnumerator() => ((System.Collections.IEnumerable)inner).GetEnumerator();
    public override System.Data.DataTable? GetSchemaTable() => inner.GetSchemaTable();

    public override void Close()
    {
        try { inner.Close(); } finally { ReleaseOnce(); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try { inner.Dispose(); } finally { ReleaseOnce(); }
        }
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        try { await inner.DisposeAsync().ConfigureAwait(false); } finally { ReleaseOnce(); }
        await base.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>DuckDB appender with per-column conversion (<see cref="EngineValues"/>).</summary>
internal sealed class DuckDbAppender : IFederationAppender
{
    private readonly DuckDBConnection _connection;
    private readonly DuckDBAppender _appender;
    private readonly StorageClass[] _classes;
    private readonly int[] _scales;
    private long _rows;
    private long _failures;
    private bool _disposed;

    public DuckDbAppender(DuckDBConnection connection, DuckDBAppender appender, IReadOnlyList<FederatedColumn> columns)
    {
        _connection = connection;
        _appender = appender;
        _classes = columns.Select(c => EngineValues.ClassOf(c.EngineType)).ToArray();
        _scales = columns.Select(c => EngineValues.ScaleOf(c.EngineType)).ToArray();
    }

    public long Rows => _rows;
    public long ConversionFailures => _failures;

    public void AppendRow(ReadOnlySpan<object?> values)
    {
        if (values.Length != _classes.Length)
            throw new ArgumentException($"The row has {values.Length} values; the table has {_classes.Length} columns.", nameof(values));
        var row = _appender.CreateRow();
        for (var i = 0; i < values.Length; i++)
        {
            var v = values[i];
            if (v is null or DBNull)
            {
                row.AppendNullValue();
                continue;
            }
            if (!EngineValues.Convert(v, _classes[i], out var c) || c is null)
            {
                _failures++;
                row.AppendNullValue();
                continue;
            }
            switch (c)
            {
                case long l: row.AppendValue(l); break;
                case BigInteger bi: row.AppendValue(bi); break;
                case double d: row.AppendValue(d); break;
                case decimal m: row.AppendValue(Math.Round(m, Math.Min(_scales[i], 28), MidpointRounding.AwayFromZero)); break;
                case bool b: row.AppendValue(b); break;
                case DateOnly d: row.AppendValue(d); break;
                case TimeOnly t: row.AppendValue(t); break;
                case DateTime dt: row.AppendValue(dt); break;
                case DateTimeOffset dto: row.AppendValue(dto); break;
                case Guid g: row.AppendValue(g); break;
                case byte[] bytes: row.AppendValue(bytes); break;
                case string s: row.AppendValue(s); break;
                default: row.AppendValue(EngineValues.ToText(c)); break;
            }
        }
        row.EndRow();
        _rows++;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            _appender.Dispose(); // flushes
        }
        finally
        {
            _connection.Dispose();
        }
    }
}
