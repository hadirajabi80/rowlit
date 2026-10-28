using System.Net.Sockets;
using System.Text.Json.Nodes;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;
using DbStudio.Providers.Cassandra.Designer;
using DbStudio.Providers.ClickHouse.Designer;
using DbStudio.Providers.MySql;
using DbStudio.Providers.MySql.Designer;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.Oracle.Designer;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.PostgreSql.Designer;
using DbStudio.Providers.Snowflake;
using DbStudio.Providers.Snowflake.Designer;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.Sqlite.Designer;
using DbStudio.Providers.SqlServer;
using DbStudio.Providers.SqlServer.Designer;

namespace DbStudio.Transfer.Tests;

/// <summary>A transfer environment over hand-made connections and the real providers' designer features.</summary>
public sealed class TestEnv : ITransferEnvironment
{
    private readonly Dictionary<string, TransferConnection> _connections = new(StringComparer.Ordinal);
    private readonly List<IDbProvider> _providers =
    [
        new SqlServerProvider(), new PostgreSqlProvider(), new MySqlProvider(), new MariaDbProvider(), new SqliteProvider(), new OracleProvider(),
        new DbStudio.Providers.ClickHouse.ClickHouseProvider(), new SnowflakeProvider(),
    ];

    public TestEnv()
    {
        var scripters = new List<IDdlScripter>
        {
            new SqlServerDdlScripter(), new PgDdlScripter(), new MySqlDdlScripter("mysql"), new MySqlDdlScripter("mariadb"), new SqliteDdlScripter(),
            new OracleDdlScripter(), new ChDdlScripter(), new SnowflakeDdlScripter(), new CqlDdlScripter(),
        };
        var databases = new List<IDesignerDatabase>
        {
            new SqlServerDesignerDatabase(), new PgDesignerDatabase(), new MySqlDesignerDatabase("mysql"), new MySqlDesignerDatabase("mariadb"),
            new SqliteDesignerDatabase(), new OracleDesignerDatabase(),
        };
        Features = new ProviderFeatures(scripters, databases, [], []);
    }

    public ProviderFeatures Features { get; }

    public IDbProvider Provider(string id) => _providers.First(p => p.Id == id);

    public IDbProvider? FindProvider(string providerId) => _providers.FirstOrDefault(p => p.Id.Equals(providerId, StringComparison.OrdinalIgnoreCase));

    public TestEnv Add(ConnectionProfile profile, string? password)
    {
        _connections[profile.Id] = new TransferConnection(profile, password, Provider(profile.ProviderId));
        return this;
    }

    public TransferConnection Resolve(string connectionId) =>
        _connections.TryGetValue(connectionId, out var c) ? c : throw EngineException.NotFound($"Connection '{connectionId}'");

    /// <summary>Runs SQL statements on a fresh session of the connection (setup / teardown / verification).</summary>
    public async Task ExecAsync(string connectionId, string? database, params string[] statements)
    {
        var c = Resolve(connectionId);
        await using var session = await c.Provider.OpenSessionAsync(c.Profile, c.Password,
            new SessionOptions(Ids.New("s"), database, TransactionMode.Auto, false), CancellationToken.None);
        var sink = new Sink();
        var summary = await session.ExecuteAsync(new ExecuteRequest(statements.Select(s => new SqlBatch(s, 1, 1)).ToList(), 0, true, false, "test"), sink, CancellationToken.None);
        if (summary.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"{string.Join(" | ", statements)} failed: {sink.FirstError}");
    }

    /// <summary>Runs a query and returns its rows as wire values.</summary>
    public async Task<List<object?[]>> QueryAsync(string connectionId, string? database, string sql)
    {
        var c = Resolve(connectionId);
        await using var session = await c.Provider.OpenSessionAsync(c.Profile, c.Password,
            new SessionOptions(Ids.New("s"), database, TransactionMode.Auto, false), CancellationToken.None);
        var sink = new Sink();
        var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 0, true, false, "test"), sink, CancellationToken.None);
        if (summary.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"{sql} failed: {sink.FirstError}");
        return sink.Collected;
    }

    public async Task<object?> ScalarAsync(string connectionId, string? database, string sql) =>
        (await QueryAsync(connectionId, database, sql)).FirstOrDefault()?[0];

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
            var s = Environment.GetEnvironmentVariable("DBSTUDIO_MSSQL_SERVER") ?? "localhost,14333";
            var parts = s.Split(',');
            return (parts[0], parts.Length > 1 ? int.Parse(parts[1]) : 1433);
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

    public static ConnectionProfile MsSqlProfile(string id = "c_ms", string database = "shop") => new()
    {
        Id = id, Name = "IT SQL Server", ProviderId = "sqlserver", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["server"] = MsSqlServer, ["auth"] = "sql", ["user"] = MsSqlUser, ["database"] = database,
            ["encrypt"] = "optional", ["trustServerCertificate"] = true, ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile PgProfile(string id = "c_pg", string database = "shop") => new()
    {
        Id = id, Name = "IT PostgreSQL", ProviderId = "postgresql", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["host"] = Pg.Host, ["port"] = Pg.Port, ["database"] = database, ["user"] = PgUser, ["sslMode"] = "disable", ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile MySqlProfile(string id = "c_my", string? database = "shop") => new()
    {
        Id = id, Name = "IT MySQL", ProviderId = "mysql", HasPassword = true,
        Props = new Dictionary<string, JsonNode?>
        {
            ["host"] = MySql.Host, ["port"] = MySql.Port, ["database"] = database, ["user"] = MySqlUser, ["sslMode"] = "none",
            ["allowPublicKeyRetrieval"] = true, ["connectTimeout"] = 30,
        },
    };

    public static ConnectionProfile SqliteProfile(string path, string id = "c_lite") => new()
    {
        Id = id, Name = "IT SQLite", ProviderId = "sqlite", Props = new Dictionary<string, JsonNode?> { ["path"] = path, ["createIfMissing"] = true },
    };
}
