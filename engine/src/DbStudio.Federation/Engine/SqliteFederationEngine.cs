using System.Data.Common;
using System.Globalization;
using System.Numerics;
using DbStudio.Core.Params;
using DbStudio.Federation.Contracts;
using Microsoft.Data.Sqlite;

namespace DbStudio.Federation.Engine;

/// <summary>
/// Fallback federation engine (plan-links 1) when libduckdb cannot load: an in-memory SQLite whose schemas are attached
/// in-memory databases named by alias, so <c>alias.table</c> resolves as on DuckDB. Only the builder subset of SQL is
/// guaranteed (SELECT, joins, WHERE, GROUP BY, ORDER BY, LIMIT); no parser (<see cref="SerializeSqlAsync"/> unsupported:
/// the analyzer falls back to whole tables), no spilling. Single connection: appenders buffer rows and write them in
/// batches under the engine lock, so parallel fetches stay safe.
/// </summary>
internal sealed class SqliteFederationEngine : IFederationEngine, IFederationEngineInternals
{
    private const int FlushRows = 5_000;
    private readonly SqliteConnection _connection;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly HashSet<string> _schemas = new(StringComparer.OrdinalIgnoreCase);
    private int _disposed;

    private SqliteFederationEngine(SqliteConnection connection)
    {
        _connection = connection;
        Version = connection.ServerVersion;
    }

    public string Name => "sqlite";
    public string Version { get; }
    public FederationEngineFeatures Features => FederationEngineFeatures.Interrupt;
    public DbConnection QueryConnection => _connection;

    internal static async Task<IFederationEngine> OpenAsync(FederationEngineOptions options, IReadOnlyList<string> schemas, CancellationToken ct)
    {
        var c = new SqliteConnection("Data Source=:memory:");
        try
        {
            await c.OpenAsync(ct).ConfigureAwait(false);
            var e = new SqliteFederationEngine(c);
            foreach (var s in schemas) await e.EnsureSchemaAsync(s, ct).ConfigureAwait(false);
            return e;
        }
        catch
        {
            await c.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static string Q(string name) => "\"" + name.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    /// <summary>SQLite column type for an engine (DuckDB) type: affinity INTEGER / REAL / NUMERIC / TEXT / BLOB.</summary>
    internal static string ColumnType(string engineType) => EngineValues.ClassOf(engineType) switch
    {
        StorageClass.BigInt or StorageClass.Boolean => "INTEGER",
        StorageClass.Double => "REAL",
        StorageClass.Decimal or StorageClass.HugeInt => "NUMERIC",
        StorageClass.Blob => "BLOB",
        _ => "TEXT",
    };

    public async Task EnsureSchemaAsync(string schema, CancellationToken ct)
    {
        if (string.Equals(schema, "main", StringComparison.OrdinalIgnoreCase)) return;
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_schemas.Contains(schema)) return;
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText = $"ATTACH DATABASE ':memory:' AS {Q(schema)}";
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            _schemas.Add(schema);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task CreateTableAsync(string schema, string table, IReadOnlyList<FederatedColumn> columns, bool replace, CancellationToken ct)
    {
        await EnsureSchemaAsync(schema, ct).ConfigureAwait(false);
        var cols = string.Join(", ", columns.Select(c => $"{Q(c.Name)} {ColumnType(c.EngineType)}"));
        if (replace) await ExecuteNonQueryAsync($"DROP TABLE IF EXISTS {Q(schema)}.{Q(table)}", ct).ConfigureAwait(false);
        await ExecuteNonQueryAsync($"CREATE TABLE {Q(schema)}.{Q(table)} ({cols})", ct).ConfigureAwait(false);
    }

    public Task DropTableAsync(string schema, string table, CancellationToken ct) =>
        ExecuteNonQueryAsync($"DROP TABLE IF EXISTS {Q(schema)}.{Q(table)}", ct);

    public IFederationAppender OpenAppender(string schema, string table, IReadOnlyList<FederatedColumn> columns) =>
        new SqliteAppender(this, $"{Q(schema)}.{Q(table)}", columns);

    public async Task<DbDataReader> ExecuteReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        var cmd = _connection.CreateCommand();
        try
        {
            cmd.CommandText = sql;
            if (parameters is { Count: > 0 }) SqliteFallbackBinder.Instance.Bind(cmd, parameters, new ParamBindCursor());
            await using var reg = ct.Register(Interrupt);
            var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            return new OwnedReader(reader, () =>
            {
                cmd.Dispose();
                _gate.Release();
            });
        }
        catch
        {
            await cmd.DisposeAsync().ConfigureAwait(false);
            _gate.Release();
            throw;
        }
    }

    public Task<DbDataReader> ExecuteIsolatedReaderAsync(string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct) =>
        ExecuteReaderAsync(sql, parameters, ct);

    public async Task<long> ExecuteNonQueryAsync(string sql, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText = sql;
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct) =>
        Task.FromResult(new SqlAst(false, false, null, "The SQLite fallback engine has no SQL parser."));

    public void Interrupt()
    {
        var handle = _connection.Handle;
        if (handle is not null && !handle.IsInvalid) SQLitePCL.raw.sqlite3_interrupt(handle);
    }

    public IDisposable Track(DbCommand command) => NoOp.Instance;

    private sealed class NoOp : IDisposable
    {
        public static readonly NoOp Instance = new();
        public void Dispose() { }
    }

    public bool IsMissingColumnError(Exception e) =>
        e is SqliteException s && s.Message.Contains("no such column", StringComparison.OrdinalIgnoreCase);

    public bool IsInterrupt(Exception e) =>
        e is OperationCanceledException || (e is SqliteException s && s.SqliteErrorCode == 9 /* SQLITE_INTERRUPT */);

    /// <summary>Writes buffered rows in one transaction under the engine lock.</summary>
    internal void Write(string qualifiedTable, int columnCount, List<object?[]> rows)
    {
        if (rows.Count == 0) return;
        _gate.Wait();
        try
        {
            using var tx = _connection.BeginTransaction();
            using var cmd = _connection.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = $"INSERT INTO {qualifiedTable} VALUES ({string.Join(", ", Enumerable.Range(0, columnCount).Select(i => "$p" + i.ToString(CultureInfo.InvariantCulture)))})";
            var ps = new SqliteParameter[columnCount];
            for (var i = 0; i < columnCount; i++) ps[i] = cmd.Parameters.Add("$p" + i.ToString(CultureInfo.InvariantCulture), SqliteType.Text);
            foreach (var row in rows)
            {
                for (var i = 0; i < columnCount; i++)
                {
                    var v = row[i];
                    ps[i].SqliteType = v switch
                    {
                        long or bool => SqliteType.Integer,
                        double => SqliteType.Real,
                        byte[] => SqliteType.Blob,
                        _ => SqliteType.Text,
                    };
                    ps[i].Value = v ?? DBNull.Value;
                }
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        Interrupt();
        await _connection.DisposeAsync().ConfigureAwait(false);
    }

    private sealed class SqliteAppender(SqliteFederationEngine engine, string table, IReadOnlyList<FederatedColumn> columns) : IFederationAppender
    {
        private readonly StorageClass[] _classes = columns.Select(c => EngineValues.ClassOf(c.EngineType)).ToArray();
        private List<object?[]> _buffer = new(FlushRows);
        private long _rows;
        private long _failures;

        public long Rows => _rows;
        public long ConversionFailures => _failures;

        public void AppendRow(ReadOnlySpan<object?> values)
        {
            var row = new object?[_classes.Length];
            for (var i = 0; i < row.Length; i++)
            {
                var v = values[i];
                if (v is null or DBNull) continue;
                if (!EngineValues.Convert(v, _classes[i], out var c) || c is null)
                {
                    _failures++;
                    continue;
                }
                row[i] = c switch
                {
                    long or double or bool or byte[] or string => c,
                    decimal m => m.ToString(CultureInfo.InvariantCulture),
                    BigInteger bi => bi.ToString(CultureInfo.InvariantCulture),
                    Guid g => g.ToString("D"),
                    _ => EngineValues.ToText(c),
                };
            }
            _buffer.Add(row);
            _rows++;
            if (_buffer.Count >= FlushRows) Flush();
        }

        private void Flush()
        {
            var rows = _buffer;
            _buffer = new List<object?[]>(FlushRows);
            engine.Write(table, _classes.Length, rows);
        }

        public void Dispose() => Flush();
    }
}

/// <summary>Named <c>$name</c> / <c>?</c> binding on the SQLite fallback (Microsoft.Data.Sqlite accepts <c>$name</c>).</summary>
internal sealed class SqliteFallbackBinder : ParamBinderBase
{
    public static readonly SqliteFallbackBinder Instance = new();

    public override string ProviderId => LinkIds.ProviderId;

    public override IReadOnlyList<ParamPlaceholder> FindPlaceholders(string sql) => DuckDbParamBinder.Instance.FindPlaceholders(sql);

    protected override DbParameter CreateParameter(DbCommand command, QueryParam p, string? placeholderName) =>
        new SqliteParameter(placeholderName is null ? null : "$" + placeholderName, ParamValues.ToClr(p) ?? DBNull.Value);
}
