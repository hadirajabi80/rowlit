using System.Net.Sockets;
using System.Text.Json.Nodes;
using DbStudio.Core.Catalog;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Plans;
using DbStudio.Core.SchemaCompare;
using DbStudio.Core.Services;
using DbStudio.Providers.MySql;
using DbStudio.Providers.MySql.Designer;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.Oracle.Designer;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.PostgreSql.Designer;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.Sqlite.Designer;
using DbStudio.Providers.SqlServer;
using DbStudio.Providers.SqlServer.Designer;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>The engine services the schema compare needs, over every relational provider, with an in-memory connection store.</summary>
public sealed class CompareEnv : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-compare-tests", Guid.NewGuid().ToString("N"));

    public ConnectionStore Connections { get; }
    public ProviderRegistry Providers { get; }
    public DesignerService Designer { get; }
    public SchemaCompareService Service { get; }
    public JobManager Jobs { get; }

    public CompareEnv()
    {
        Providers = new ProviderRegistry([new SqlServerProvider(), new OracleProvider(), new SqliteProvider(), new PostgreSqlProvider(), new MySqlProvider(), new MariaDbProvider()]);
        Connections = new ConnectionStore(new AppPaths(_dir), new InMemorySecretStore(), Providers);
        var features = new ProviderFeatures(
            [new SqlServerDdlScripter(), new OracleDdlScripter(), new SqliteDdlScripter(), new PgDdlScripter(), new MySqlDdlScripter("mysql"), new MySqlDdlScripter("mariadb")],
            [new SqlServerDesignerDatabase(), new OracleDesignerDatabase(), new SqliteDesignerDatabase(), new PgDesignerDatabase(), new MySqlDesignerDatabase("mysql"), new MySqlDesignerDatabase("mariadb")],
            Array.Empty<IPlanReader>(), Array.Empty<IParamBinder>());
        var events = new NullPublisher();
        Designer = new DesignerService(Connections, Providers, features, new CatalogService(Providers, Connections, events));
        Jobs = new JobManager(events);
        Service = new SchemaCompareService(Connections, Providers, features, Designer, Jobs);
    }

    public ConnectionProfile Add(string name, string providerId, Dictionary<string, JsonNode?> props, string? password = null) =>
        Connections.Create(new ConnectionProfile { Name = name, ProviderId = providerId, Props = props, HasPassword = password is not null }, password);

    /// <summary>Runs statements one by one on the connection (a DDL apply without a transaction).</summary>
    public Task<DdlApplyResult> ExecAsync(ConnectionProfile profile, string? database, IEnumerable<string> statements) =>
        Designer.ApplyAsync(profile.Id, new DdlApplyRequest(database, statements.Where(s => !string.IsNullOrWhiteSpace(s)).ToList(), false), CancellationToken.None);

    /// <summary>Like <see cref="ExecAsync"/> but ignores failures (cleanup).</summary>
    public async Task TryExecAsync(ConnectionProfile profile, string? database, IEnumerable<string> statements)
    {
        foreach (var s in statements)
        {
            try { await ExecAsync(profile, database, [s]); }
            catch (EngineException) { /* not there */ }
        }
    }

    public Task<CompareResult> CompareAsync(CompareEndpoint source, CompareEndpoint target, CompareOptions? options = null) =>
        Service.CompareNowAsync(new CompareRequest(source, target, options), CancellationToken.None);

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private sealed class NullPublisher : IEventPublisher
    {
        public void Publish(EngineEvent ev) { }
    }
}

/// <summary>Addresses of the Docker sample servers (engine/tests/docker/compose.yml), overridable like the provider test projects do.</summary>
public static class Servers
{
    public static bool Disabled => Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0";

    private static string Env(string name, string fallback) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } v ? v : fallback;

    public static async Task<bool> ReachableAsync(string host, int port)
    {
        if (Disabled) return false;
        try
        {
            using var client = new TcpClient();
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await client.ConnectAsync(host, port, cts.Token);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public static (string Host, int Port, string User, string Password) Pg =>
        (Env("DBSTUDIO_PG_HOST", "localhost"), int.Parse(Env("DBSTUDIO_PG_PORT", "15432")), Env("DBSTUDIO_PG_USER", "shop"), Env("DBSTUDIO_PG_PASSWORD", "shop"));

    public static (string Server, string User, string Password) MsSql =>
        (Env("DBSTUDIO_MSSQL_SERVER", "localhost,14333"), "sa", Env("DBSTUDIO_MSSQL_PASSWORD", "DbStudio_Dev_2026!"));

    public static (string Host, int Port, string User, string Password) MySql =>
        (Env("DBSTUDIO_MYSQL_HOST", "localhost"), int.Parse(Env("DBSTUDIO_MYSQL_PORT", "13306")), Env("DBSTUDIO_MYSQL_USER", "root"), Env("DBSTUDIO_MYSQL_PASSWORD", "shop"));

    public static (string Host, int Port, string User, string Password) MariaDb =>
        (Env("DBSTUDIO_MARIADB_HOST", "localhost"), int.Parse(Env("DBSTUDIO_MARIADB_PORT", "13307")), Env("DBSTUDIO_MARIADB_USER", "root"), Env("DBSTUDIO_MARIADB_PASSWORD", "shop"));

    public static (string Host, int Port, string Service, string User, string Password) Oracle =>
        (Env("DBSTUDIO_ORACLE_HOST", "localhost"), int.Parse(Env("DBSTUDIO_ORACLE_PORT", "15211")), "FREEPDB1", "SYSTEM", Env("DBSTUDIO_ORACLE_SYSTEM_PASSWORD", "DbStudioDev2026"));

    public static Dictionary<string, JsonNode?> PgProps(string database = "shop") => new()
    {
        ["host"] = Pg.Host, ["port"] = Pg.Port, ["database"] = database, ["user"] = Pg.User, ["sslMode"] = "disable", ["connectTimeout"] = 30,
    };

    public static Dictionary<string, JsonNode?> MsSqlProps(string database = "shop") => new()
    {
        ["server"] = MsSql.Server, ["auth"] = "sql", ["user"] = MsSql.User, ["database"] = database, ["encrypt"] = "optional",
        ["trustServerCertificate"] = true, ["connectTimeout"] = 30,
    };

    public static Dictionary<string, JsonNode?> MySqlProps(bool maria) => new()
    {
        ["host"] = maria ? MariaDb.Host : MySql.Host, ["port"] = maria ? MariaDb.Port : MySql.Port, ["database"] = "shop",
        ["user"] = maria ? MariaDb.User : MySql.User, ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true, ["connectTimeout"] = 30,
    };

    public static Dictionary<string, JsonNode?> OracleProps() => new()
    {
        ["connectionType"] = "basic", ["host"] = Oracle.Host, ["port"] = Oracle.Port, ["serviceName"] = Oracle.Service, ["user"] = Oracle.User,
        ["role"] = "normal", ["connectTimeout"] = 60,
    };

    public static Dictionary<string, JsonNode?> SqliteProps(string path) => new()
    {
        ["path"] = path, ["createIfMissing"] = true,
    };
}
