using System.Data.Common;
using System.Net.Sockets;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Providers;
using DbStudio.Core.Queries;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;
using DbStudio.Federation.Materialize;
using DbStudio.Federation.Views;
using DbStudio.Providers.ClickHouse;
using DbStudio.Providers.MySql;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.SqlServer;
using DuckDBConnection = DuckDB.NET.Data.DuckDBConnection;
using DuckDBParameter = DuckDB.NET.Data.DuckDBParameter;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Federation.Tests.WpB;

public sealed class CapturingPublisher : IEventPublisher
{
    public List<EngineEvent> Events { get; } = [];
    public void Publish(EngineEvent ev) { lock (Events) Events.Add(ev); }
    public JobDoneEvent? Done(string jobId) { lock (Events) return Events.OfType<JobDoneEvent>().FirstOrDefault(e => e.JobId == jobId); }
    public List<JobProgressEvent> Progress(string jobId) { lock (Events) return Events.OfType<JobProgressEvent>().Where(e => e.JobId == jobId).ToList(); }
}

/// <summary>An appender that keeps the rows (fetcher tests).</summary>
public sealed class CapturingAppender : IFederationAppender
{
    public List<object?[]> Rows { get; } = [];
    public void AppendRow(ReadOnlySpan<object?> values) => Rows.Add(values.ToArray());
    long IFederationAppender.Rows => Rows.Count;
    public long ConversionFailures => 0;
    public void Dispose() { }
}

/// <summary>
/// ILinkRuntime over an in-memory DuckDB the test fills (schemas = aliases): OpenQueryAsync runs the SQL there, so the
/// reader carries DuckDB's CLR types exactly like WP-A's runtime will. Catalog / plan / validate are settable.
/// </summary>
public sealed class FakeLinkRuntime : ILinkRuntime, IDisposable
{
    private readonly DuckDBConnection _db = DuckDbProbe.OpenInMemory();
    public Dictionary<string, LinkDefinition> Links { get; } = new(StringComparer.Ordinal);
    public LinkCatalog Catalog { get; set; } = new([], []);
    public List<string> Queries { get; } = [];
    public List<(string? Session, IReadOnlyList<LinkTableRef>? Tables)> Refreshes { get; } = [];
    public LinkValidationResult Validation { get; set; } = new(true, [], []);

    public void Exec(string sql)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    public LinkDefinition Definition(string linkId) =>
        Links.TryGetValue(linkId, out var d) ? d : throw EngineException.NotFound($"Connection '{linkId}'");

    public Task<LinkValidationResult> ValidateAsync(LinkDefinition definition, string? linkId, bool probe, CancellationToken ct) => Task.FromResult(Validation);

    public Task<LinkCatalog> CatalogAsync(string linkId, bool refresh, CancellationToken ct)
    {
        Definition(linkId);
        return Task.FromResult(Catalog);
    }

    public Task<PushdownPlan> PlanAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct) =>
        Task.FromResult(new PushdownPlan("duckdb", true, [], [new PlanWarning("fake", sql)]));

    public Task<LinkQuery> OpenQueryAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, LinkQueryOptions options, CancellationToken ct)
    {
        Definition(linkId);
        lock (Queries) Queries.Add(sql);
        options.Progress?.Report(new LinkFetchProgress(new LinkTableRef("src", "big"), 10, false));
        options.Progress?.Report(new LinkFetchProgress(new LinkTableRef("src", "big"), 20, true));
        var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var p in parameters ?? []) cmd.Parameters.Add(new DuckDBParameter(p.BareName, ParamValues.ToClr(p)));
        DbDataReader reader = cmd.ExecuteReader();
        var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new ColumnInfo(reader.GetName(i), i, reader.GetDataTypeName(i), KindOf(reader.GetDataTypeName(i)), true,
            Precision: Precision(reader.GetDataTypeName(i)).P, Scale: Precision(reader.GetDataTypeName(i)).S)).ToList();
        return Task.FromResult(new LinkQuery(reader, columns, new PushdownPlan("duckdb", true, [], []), new Owned(cmd)));
    }

    public Task<int> RefreshSourcesAsync(string linkId, string? sessionId, IReadOnlyList<LinkTableRef>? tables, CancellationToken ct)
    {
        Definition(linkId);
        Refreshes.Add((sessionId, tables));
        return Task.FromResult(3);
    }

    public Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct) => Task.FromResult(DuckDbProbe.SerializeSql(sql));

    private static string KindOf(string type)
    {
        var t = type.ToUpperInvariant();
        if (t.StartsWith("DECIMAL", StringComparison.Ordinal)) return ColumnKinds.Decimal;
        return t switch
        {
            "BIGINT" or "INTEGER" or "SMALLINT" or "TINYINT" or "HUGEINT" or "UBIGINT" or "UINTEGER" => ColumnKinds.Int,
            "DOUBLE" or "FLOAT" => ColumnKinds.Float,
            "BOOLEAN" => ColumnKinds.Bool,
            "DATE" => ColumnKinds.Date,
            "TIME" => ColumnKinds.Time,
            "TIMESTAMP" => ColumnKinds.DateTime,
            "TIMESTAMP WITH TIME ZONE" => ColumnKinds.DateTimeOffset,
            "UUID" => ColumnKinds.Guid,
            "BLOB" => ColumnKinds.Binary,
            "JSON" => ColumnKinds.Json,
            _ => ColumnKinds.String,
        };
    }

    private static (int? P, int? S) Precision(string type)
    {
        var m = System.Text.RegularExpressions.Regex.Match(type, @"DECIMAL\((\d+),\s*(\d+)\)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return m.Success ? (int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value)) : (null, null);
    }

    private sealed class Owned(DbCommand cmd) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => cmd.DisposeAsync();
    }

    public void Dispose() => _db.Dispose();
}

/// <summary>The engine services materialize / views / endpoints need, over a temp data dir and the real providers.</summary>
public sealed class WpBHarness : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "rowlit-links-b-" + Guid.NewGuid().ToString("N"));
    public FakeLinkRuntime Runtime { get; } = new();
    public ProviderRegistry Providers { get; }
    public ConnectionStore Connections { get; }
    public CapturingPublisher Events { get; } = new();
    public JobManager Jobs { get; }
    public CatalogService Catalog { get; }
    public SavedQueryStore Queries { get; }
    public LinkedViewStore Views { get; }
    public MaterializeService Materialize { get; }
    public AppPaths Paths { get; }
    public IServiceProvider Services { get; } = new ServiceCollection().BuildServiceProvider();
    public string Dir => _dir;

    public WpBHarness()
    {
        Providers = new ProviderRegistry([new SqliteProvider(), new SqlServerProvider(), new PostgreSqlProvider(), new MySqlProvider(), new MariaDbProvider(),
            new OracleProvider(), new ClickHouseProvider()]);
        Paths = new AppPaths(Path.Combine(_dir, "data"));
        Connections = new ConnectionStore(Paths, new InMemorySecretStore(), Providers);
        Catalog = new CatalogService(Providers, Connections, Events);
        Jobs = new JobManager(Events);
        Queries = new SavedQueryStore(Paths);
        Views = new LinkedViewStore(Queries, Paths);
        Materialize = new MaterializeService(Runtime, Connections, Providers, Catalog, Jobs, Views, Services);
    }

    /// <summary>A link "l_test" known to the fake runtime (it is not a saved connection: the runtime is the authority).</summary>
    public string Link(string id = "l_test")
    {
        Runtime.Links[id] = new LinkDefinition();
        return id;
    }

    public string AddConnection(ConnectionProfile profile, string? password = null) => Connections.Create(profile, password).Id;

    public string NewSqlite(out string path, bool readOnly = false)
    {
        Directory.CreateDirectory(_dir);
        path = Path.Combine(_dir, "t-" + Guid.NewGuid().ToString("N")[..8] + ".db");
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path};Pooling=False")) { c.Open(); }
        return AddConnection(new ConnectionProfile { Name = "sqlite target", ProviderId = "sqlite", ReadOnly = readOnly, Props = new() { ["path"] = path } });
    }

    public async Task<(JobDoneEvent Done, MaterializeResult? Result)> RunAsync(string link, MaterializeRequest request)
    {
        var jobId = Materialize.Start(link, request, null);
        await Jobs.WaitAsync(jobId);
        var done = Events.Done(jobId) ?? throw new InvalidOperationException("The job did not finish.");
        LastJobId = jobId;
        return (done, done.Result is { } r ? System.Text.Json.JsonSerializer.Deserialize<MaterializeResult>(r, CoreJson.Options) : null);
    }

    public string LastJobId { get; private set; } = "";

    public async Task<object?> ScalarAsync(string cid, string sql, string? database = null)
    {
        var profile = Connections.WithSecrets(Connections.Get(cid));
        var provider = Providers.Get(profile.ProviderId);
        await using var c = await DbStudio.Import.Run.ImportConnections.OpenAsync(provider, profile, Connections.GetPassword(cid), database, Services, default);
        await using var cmd = c.Db.CreateCommand();
        cmd.CommandText = sql;
        var v = await cmd.ExecuteScalarAsync();
        return v is DBNull ? null : v;
    }

    public async Task ExecAsync(string cid, string sql, string? database = null)
    {
        var profile = Connections.WithSecrets(Connections.Get(cid));
        var provider = Providers.Get(profile.ProviderId);
        await using var c = await DbStudio.Import.Run.ImportConnections.OpenAsync(provider, profile, Connections.GetPassword(cid), database, Services, default);
        await using var cmd = c.Db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    public void Dispose()
    {
        Runtime.Dispose();
        Jobs.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(10));
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

/// <summary>A sample server of the compose project dbstudio-it (Import's Target.Reachable pattern).</summary>
public static class Docker
{
    public static bool Reachable(string host, int port)
    {
        if (Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0") return false;
        try
        {
            using var c = new TcpClient();
            return c.ConnectAsync(host, port).Wait(TimeSpan.FromSeconds(2)) && c.Connected;
        }
        catch (Exception) { return false; }
    }
}
