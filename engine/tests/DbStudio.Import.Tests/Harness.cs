using System.Data.Common;
using System.Text.Json;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;
using DbStudio.Providers.ClickHouse;
using DbStudio.Providers.MySql;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.SqlServer;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Import.Tests;

public sealed class CapturingPublisher : IEventPublisher
{
    public List<EngineEvent> Events { get; } = [];
    public void Publish(EngineEvent ev) { lock (Events) Events.Add(ev); }
    public JobDoneEvent? Done(string jobId) { lock (Events) return Events.OfType<JobDoneEvent>().FirstOrDefault(e => e.JobId == jobId); }
    public int Progress(string jobId) { lock (Events) return Events.OfType<JobProgressEvent>().Count(e => e.JobId == jobId); }
}

/// <summary>The real import stack (connection store, catalog, jobs, service) over the providers, driven the way the endpoints do.</summary>
public sealed class Harness : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "rowlit-import-h-" + Guid.NewGuid().ToString("N"));
    public ProviderRegistry Providers { get; }
    public ConnectionStore Connections { get; }
    public CapturingPublisher Events { get; } = new();
    public JobManager Jobs { get; }
    public ImportService Service { get; }
    public DbStudio.Import.Generate.GenerateService Generate { get; }
    public CatalogService Catalog { get; }
    public IServiceProvider Services { get; } = new ServiceCollection().BuildServiceProvider();
    public string ReportDir => Service.ReportDirectory;

    public Harness()
    {
        Providers = new ProviderRegistry([new SqliteProvider(), new SqlServerProvider(), new PostgreSqlProvider(), new MySqlProvider(), new MariaDbProvider(),
            new OracleProvider(), new ClickHouseProvider()]);
        var paths = new AppPaths(Path.Combine(_dir, "data"));
        Connections = new ConnectionStore(paths, new InMemorySecretStore(), Providers);
        Catalog = new CatalogService(Providers, Connections, Events);
        Jobs = new JobManager(Events);
        Service = new ImportService(Connections, Providers, Catalog, Jobs, paths, Services, Microsoft.Extensions.Logging.Abstractions.NullLogger<ImportService>.Instance);
        Generate = new DbStudio.Import.Generate.GenerateService(Connections, Providers, Catalog, Jobs, paths, Services, Microsoft.Extensions.Logging.Abstractions.NullLogger<DbStudio.Import.Generate.GenerateService>.Instance);
    }

    public string AddConnection(ConnectionProfile profile, string? password) => Connections.Create(profile, password).Id;

    public string NewSqlite(out string path)
    {
        Directory.CreateDirectory(_dir);
        path = Path.Combine(_dir, "t-" + Guid.NewGuid().ToString("N")[..8] + ".db");
        var p = path;
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={p};Pooling=False")) { c.Open(); }
        return AddConnection(new ConnectionProfile { Name = "sqlite", ProviderId = "sqlite", Props = new() { ["path"] = p } }, null);
    }

    public async Task<ImportSummary> RunAsync(string cid, ImportRequest req)
    {
        var jobId = Service.Start(cid, req, null);
        await Jobs.WaitAsync(jobId);
        LastJobId = jobId;
        var done = Events.Done(jobId) ?? throw new InvalidOperationException("The job did not finish.");
        if (done.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"Job {done.Status}: {done.Error}");
        return done.Result!.Value.Deserialize<ImportSummary>(CoreJson.Options)!;
    }

    public string LastJobId { get; private set; } = "";

    /// <summary>Preview of the file with the options the UI would send (auto-detected).</summary>
    public async Task<PreviewResult> PreviewAsync(string path, SourceOptions? options = null) =>
        await Service.PreviewAsync(new PreviewRequest { Path = path, Options = options }, default);

    /// <summary>A request mapping every preview column to a same-named target column.</summary>
    public static ImportRequest Request(PreviewResult preview, string table, string? schema, string? database, bool create, string mode = "append",
        IEnumerable<string>? keys = null, string onError = "stop", bool transaction = true, int? batch = null, IEnumerable<string>? primaryKey = null,
        Func<string, string>? name = null)
    {
        name ??= n => ImportDialect.SanitizeName(n, 60).ToLowerInvariant().Replace(' ', '_');
        return new ImportRequest
        {
            Path = preview.Path,
            Source = preview.Options,
            Target = new ImportTargetDto { Database = database, Schema = schema, Table = table, Create = create },
            Columns = preview.Columns.Select(c => new ColumnMappingDto
            {
                Target = name(c.Name),
                From = new ValueSourceDto { Kind = "source", Index = c.Index },
                Inferred = c.Inferred,
            }).ToList(),
            PrimaryKey = primaryKey?.ToList(),
            Mode = mode,
            KeyColumns = keys?.ToList(),
            OnError = onError,
            Transaction = transaction,
            BatchSize = batch,
        };
    }

    public async Task<object?> ScalarAsync(string cid, string sql, string? database = null)
    {
        var profile = Connections.WithSecrets(Connections.Get(cid));
        var provider = Providers.Get(profile.ProviderId);
        await using var c = await ImportConnections.OpenAsync(provider, profile, Connections.GetPassword(cid), database, Services, default);
        await using var cmd = c.Db.CreateCommand();
        cmd.CommandText = sql;
        var v = await cmd.ExecuteScalarAsync();
        return v is DBNull ? null : v;
    }

    public async Task ExecAsync(string cid, string sql, string? database = null)
    {
        var profile = Connections.WithSecrets(Connections.Get(cid));
        var provider = Providers.Get(profile.ProviderId);
        await using var c = await ImportConnections.OpenAsync(provider, profile, Connections.GetPassword(cid), database, Services, default);
        await using var cmd = c.Db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
