using System.Globalization;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using DbStudio.Providers.MySql;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.SqlServer;

namespace DbStudio.DataCompare.Tests;

/// <summary>Hand-made connections over the real providers (the data compare only needs sessions and catalog readers).</summary>
public sealed class TestEnv : ITransferEnvironment
{
    private readonly Dictionary<string, TransferConnection> _connections = new(StringComparer.Ordinal);
    private readonly List<IDbProvider> _providers =
        [new SqlServerProvider(), new PostgreSqlProvider(), new MySqlProvider(), new MariaDbProvider(), new SqliteProvider(), new OracleProvider()];

    public ProviderFeatures Features { get; } = new(new List<IDdlScripter>(), new List<IDesignerDatabase>(), [], []);

    public IDbProvider? FindProvider(string providerId) => _providers.FirstOrDefault(p => p.Id.Equals(providerId, StringComparison.OrdinalIgnoreCase));

    public TestEnv Add(ConnectionProfile profile, string? password)
    {
        _connections[profile.Id] = new TransferConnection(profile, password, FindProvider(profile.ProviderId)!);
        return this;
    }

    public bool Has(string id) => _connections.ContainsKey(id);

    public TransferConnection Resolve(string connectionId) =>
        _connections.TryGetValue(connectionId, out var c) ? c : throw EngineException.NotFound($"Connection '{connectionId}'");

    public async Task ExecAsync(string connectionId, string? database, params string[] statements)
    {
        var c = Resolve(connectionId);
        await using var session = await c.Provider.OpenSessionAsync(c.Profile, c.Password, new SessionOptions(Ids.New("s"), database, TransactionMode.Auto, false), CancellationToken.None);
        var sink = new Sink();
        var summary = await session.ExecuteAsync(new ExecuteRequest(statements.Select(s => new SqlBatch(s, 1, 1)).ToList(), 0, true, false, "test"), sink, CancellationToken.None);
        if (summary.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"{string.Join(" | ", statements).Substring(0, Math.Min(300, string.Join(" | ", statements).Length))} failed: {sink.FirstError}");
    }

    public async Task<List<object?[]>> QueryAsync(string connectionId, string? database, string sql)
    {
        var c = Resolve(connectionId);
        await using var session = await c.Provider.OpenSessionAsync(c.Profile, c.Password, new SessionOptions(Ids.New("s"), database, TransactionMode.Auto, false), CancellationToken.None);
        var sink = new Sink();
        var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 0, true, false, "test"), sink, CancellationToken.None);
        if (summary.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"{sql} failed: {sink.FirstError}");
        return sink.Collected;
    }

    private sealed class Sink : IExecutionSink
    {
        public List<object?[]> Collected { get; } = [];
        public string? FirstError { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows) { Collected.AddRange(rows); return ValueTask.CompletedTask; }
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error) { FirstError ??= error.Message; return ValueTask.CompletedTask; }
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }
}

/// <summary>The docker compose sample servers (engine/tests/docker/README.md); a test is skipped when its server is unreachable.</summary>
public static class Servers
{
    public static bool Disabled => Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0";

    public static (string Host, int Port) MsSql
    {
        get
        {
            var parts = MsSqlServer.Split(',');
            return (parts[0], parts.Length > 1 ? int.Parse(parts[1], CultureInfo.InvariantCulture) : 1433);
        }
    }

    public static string MsSqlServer => Environment.GetEnvironmentVariable("DBSTUDIO_MSSQL_SERVER") ?? "localhost,14333";
    public static string MsSqlUser => Environment.GetEnvironmentVariable("DBSTUDIO_MSSQL_USER") ?? "sa";
    public static string MsSqlPassword => Environment.GetEnvironmentVariable("DBSTUDIO_MSSQL_PASSWORD") ?? "DbStudio_Dev_2026!";

    public static (string Host, int Port) Pg => (Environment.GetEnvironmentVariable("DBSTUDIO_PG_HOST") ?? "localhost",
        int.TryParse(Environment.GetEnvironmentVariable("DBSTUDIO_PG_PORT"), out var p) ? p : 15432);

    public static string PgUser => Environment.GetEnvironmentVariable("DBSTUDIO_PG_USER") ?? "shop";
    public static string PgPassword => Environment.GetEnvironmentVariable("DBSTUDIO_PG_PASSWORD") ?? "shop";

    public static (string Host, int Port) MySql => (Environment.GetEnvironmentVariable("DBSTUDIO_MYSQL_HOST") ?? "localhost",
        int.TryParse(Environment.GetEnvironmentVariable("DBSTUDIO_MYSQL_PORT"), out var p) ? p : 13306);

    public static string MySqlUser => Environment.GetEnvironmentVariable("DBSTUDIO_MYSQL_USER") ?? "root";
    public static string MySqlPassword => Environment.GetEnvironmentVariable("DBSTUDIO_MYSQL_PASSWORD") ?? "shop";

    public static bool Reachable((string Host, int Port) endpoint)
    {
        if (Disabled) return false;
        try
        {
            using var client = new TcpClient();
            return client.ConnectAsync(endpoint.Host, endpoint.Port).Wait(TimeSpan.FromSeconds(2)) && client.Connected;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public static ConnectionProfile MsSqlProfile(string id = "c_ms") => new()
    {
        Id = id, Name = "IT SQL Server", ProviderId = "sqlserver", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["server"] = MsSqlServer, ["auth"] = "sql", ["user"] = MsSqlUser, ["database"] = "shop",
            ["encrypt"] = "optional", ["trustServerCertificate"] = true, ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile PgProfile(string id = "c_pg") => new()
    {
        Id = id, Name = "IT PostgreSQL", ProviderId = "postgresql", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["host"] = Pg.Host, ["port"] = Pg.Port, ["database"] = "shop", ["user"] = PgUser, ["sslMode"] = "disable", ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile MySqlProfile(string id = "c_my") => new()
    {
        Id = id, Name = "IT MySQL", ProviderId = "mysql", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["host"] = MySql.Host, ["port"] = MySql.Port, ["user"] = MySqlUser, ["sslMode"] = "none",
            ["allowPublicKeyRetrieval"] = true, ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile SqliteProfile(string path, string id, bool readOnly = false) => new()
    {
        Id = id, Name = "IT SQLite " + Path.GetFileNameWithoutExtension(path), ProviderId = "sqlite", ReadOnly = readOnly,
        Props = new Dictionary<string, JsonNode?> { ["path"] = path, ["createIfMissing"] = true },
    };
}

public enum Kind { MsSql, Pg, MySql, Sqlite }

/// <summary>
/// A scratch schema (SQL Server / PostgreSQL), database (MySQL) or SQLite file the test creates and drops, with the
/// "items" sample: <see cref="Rows"/> rows of several column types, seeded deterministically.
/// </summary>
public sealed class Scratch : IAsyncDisposable
{
    public const int Rows = 600;

    private readonly TestEnv _env;
    private readonly Func<Task> _drop;

    private Scratch(TestEnv env, Kind kind, string connectionId, string? database, string schema, Func<Task> drop)
    {
        _env = env;
        Kind = kind;
        ConnectionId = connectionId;
        Database = database;
        Schema = schema;
        _drop = drop;
    }

    public Kind Kind { get; }
    public string ConnectionId { get; }
    public string? Database { get; }
    public string Schema { get; }
    public Dialect Dialect => Kind switch { Kind.MsSql => Dialect.TSql, Kind.Pg => Dialect.PgSql, Kind.MySql => Dialect.MySql, _ => Dialect.Sqlite };

    public static bool Available(Kind kind) => kind switch
    {
        Kind.MsSql => Servers.Reachable(Servers.MsSql),
        Kind.Pg => Servers.Reachable(Servers.Pg),
        Kind.MySql => Servers.Reachable(Servers.MySql),
        _ => true,
    };

    public static string NewName(string prefix = "dcmp") => prefix + "_" + Guid.NewGuid().ToString("N")[..8];

    public static async Task<Scratch> CreateAsync(TestEnv env, Kind kind, bool readOnly = false)
    {
        var name = NewName();
        switch (kind)
        {
            case Kind.MsSql:
            {
                const string id = "c_ms";
                if (!env.Has(id)) env.Add(Servers.MsSqlProfile(id), Servers.MsSqlPassword);
                await env.ExecAsync(id, "shop", $"CREATE SCHEMA [{name}]");
                return new Scratch(env, kind, id, "shop", name, async () =>
                {
                    foreach (var t in await env.QueryAsync(id, "shop", $"SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = '{name}'"))
                        await env.ExecAsync(id, "shop", $"DROP TABLE [{name}].[{t[0]}]");
                    await env.ExecAsync(id, "shop", $"DROP SCHEMA [{name}]");
                });
            }
            case Kind.Pg:
            {
                const string id = "c_pg";
                if (!env.Has(id)) env.Add(Servers.PgProfile(id), Servers.PgPassword);
                await env.ExecAsync(id, "shop", $"CREATE SCHEMA {name}");
                return new Scratch(env, kind, id, "shop", name, () => env.ExecAsync(id, "shop", $"DROP SCHEMA IF EXISTS {name} CASCADE"));
            }
            case Kind.MySql:
            {
                const string id = "c_my";
                if (!env.Has(id)) env.Add(Servers.MySqlProfile(id), Servers.MySqlPassword);
                await env.ExecAsync(id, null, $"CREATE DATABASE `{name}`");
                return new Scratch(env, kind, id, null, name, () => env.ExecAsync(id, null, $"DROP DATABASE IF EXISTS `{name}`"));
            }
            default:
            {
                var id = "c_lite_" + name;
                var path = Path.Combine(Path.GetTempPath(), name + ".db");
                env.Add(Servers.SqliteProfile(path, id, readOnly), null);
                if (readOnly)
                {
                    // create the file through a writable twin, then compare through the read-only profile
                    env.Add(Servers.SqliteProfile(path, id + "_rw"), null);
                }
                return new Scratch(env, kind, id, null, "main", () =>
                {
                    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                    foreach (var f in Directory.GetFiles(Path.GetTempPath(), name + ".db*")) { try { File.Delete(f); } catch (IOException) { } }
                    return Task.CompletedTask;
                });
            }
        }
    }

    /// <summary>The endpoint of a table of this scratch area.</summary>
    public Core.DataCompare.DataCompareSide Side(string table, string? where = null) =>
        new(ConnectionId, Database, Kind == Kind.Sqlite ? null : Schema, table, null, where);

    public Core.DataCompare.DataCompareSide QuerySide(string query) => new(ConnectionId, Database, Kind == Kind.Sqlite ? null : Schema, null, query);

    public string Q(string table) => TransferSql.Qualified(Dialect, Kind == Kind.Sqlite ? null : Schema, table);

    private string WritableId => _env.Has(ConnectionId + "_rw") ? ConnectionId + "_rw" : ConnectionId;

    public Task ExecAsync(params string[] sql) => _env.ExecAsync(WritableId, Database, sql);

    public Task<List<object?[]>> QueryAsync(string sql) => _env.QueryAsync(ConnectionId, Database, sql);

    public async ValueTask DisposeAsync()
    {
        try { await _drop(); }
        catch (Exception) { /* best effort: scratch areas have random names */ }
    }

    // ------------------------------------------------------------------ the items sample

    /// <summary>Creates <paramref name="table"/> (id key, code, name, price, qty, ratio, active, created, note) with the seeded rows.</summary>
    public async Task SeedItemsAsync(string table = "items", int rows = Rows)
    {
        var d = Dialect;
        var (idT, codeT, nameT, priceT, qtyT, ratioT, boolT, dateT, noteT) = Kind switch
        {
            Kind.MsSql => ("int", "varchar(20)", "nvarchar(100)", "decimal(10,2)", "int", "float", "bit", "datetime2(3)", "nvarchar(max)"),
            Kind.Pg => ("integer", "varchar(20)", "varchar(100)", "numeric(10,2)", "integer", "double precision", "boolean", "timestamp(3)", "text"),
            Kind.MySql => ("int", "varchar(20)", "varchar(100)", "decimal(10,2)", "int", "double", "tinyint(1)", "datetime(3)", "text"),
            _ => ("integer", "varchar(20)", "varchar(100)", "decimal(10,2)", "integer", "real", "boolean", "datetime", "text"),
        };
        string Q1(string n) => TransferSql.Quote(d, n);
        await ExecAsync($"CREATE TABLE {Q(table)} ({Q1("id")} {idT} NOT NULL PRIMARY KEY, {Q1("code")} {codeT} NOT NULL, {Q1("name")} {nameT}, {Q1("price")} {priceT}, " +
                        $"{Q1("qty")} {qtyT}, {Q1("ratio")} {ratioT}, {Q1("active")} {boolT}, {Q1("created")} {dateT}, {Q1("note")} {noteT})");
        var all = Enumerable.Range(1, rows).Select(Item).ToList();
        foreach (var chunk in all.Chunk(200))
        {
            var values = chunk.Select(r => "(" + string.Join(", ", r.Select((v, i) => Lit(i, v))) + ")");
            await ExecAsync($"INSERT INTO {Q(table)} ({string.Join(", ", new[] { "id", "code", "name", "price", "qty", "ratio", "active", "created", "note" }.Select(Q1))}) VALUES {string.Join(", ", values)}");
        }
    }

    /// <summary>The seeded values of row <paramref name="i"/>.</summary>
    public static object?[] Item(int i) =>
    [
        i, $"C{i:D5}", i % 7 == 0 ? null : $"Item {i} é", (i * 13 % 1000) + 0.25m, i % 50, i / 8.0, i % 3 == 0,
        new DateTime(2024, 1, 1).AddMinutes(i * 37).AddMilliseconds(i % 1000), i % 11 == 0 ? null : $"note {i}",
    ];

    private string Lit(int col, object? v)
    {
        var d = Dialect;
        return v switch
        {
            null => "NULL",
            int n => n.ToString(CultureInfo.InvariantCulture),
            decimal m => m.ToString(CultureInfo.InvariantCulture),
            double x => x.ToString("R", CultureInfo.InvariantCulture),
            bool b => d == Dialect.PgSql ? (b ? "TRUE" : "FALSE") : b ? "1" : "0",
            DateTime dt => TransferSql.Str(d, dt.ToString(d == Dialect.Sqlite ? "yyyy-MM-dd HH:mm:ss.fff" : "yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture)),
            string s => TransferSql.Str(d, s),
            _ => throw new ArgumentOutOfRangeException(nameof(col)),
        };
    }

    /// <summary>
    /// Injects the standard differences into a seeded copy: 5 changed rows (price / name / note / active), 3 deleted rows
    /// (only in the other side), 4 extra rows (only in this side).
    /// </summary>
    public async Task MutateAsync(string table = "items")
    {
        var d = Dialect;
        string Q1(string n) => TransferSql.Quote(d, n);
        var t = Q(table);
        var on = d == Dialect.PgSql ? "TRUE" : "1";
        await ExecAsync(
            $"UPDATE {t} SET {Q1("price")} = 999.99 WHERE {Q1("id")} = 10",
            $"UPDATE {t} SET {Q1("name")} = {TransferSql.Str(d, "Renamed")} WHERE {Q1("id")} = 20",
            $"UPDATE {t} SET {Q1("note")} = NULL WHERE {Q1("id")} = 30",
            $"UPDATE {t} SET {Q1("note")} = {TransferSql.Str(d, "late note")} WHERE {Q1("id")} = 33",
            $"UPDATE {t} SET {Q1("active")} = {on}, {Q1("qty")} = 4242 WHERE {Q1("id")} = 40",
            $"DELETE FROM {t} WHERE {Q1("id")} IN (100, 200, 300)",
            $"INSERT INTO {t} ({Q1("id")}, {Q1("code")}, {Q1("name")}) VALUES (9001, 'X1', 'extra 1'), (9002, 'X2', 'extra 2'), (9003, 'X3', NULL), (9004, 'X4', 'extra 4')");
    }
}
