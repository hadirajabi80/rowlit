using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;
using DbStudio.Federation.Pushdown;
using DbStudio.Federation.Runtime;
using DbStudio.Providers.ClickHouse;
using DbStudio.Providers.MySql;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.SqlServer;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>Builders of source tables / catalogs for analyzer and push-down tests.</summary>
internal static class Cat
{
    public static SourceColumn Col(string name, string kind, string? type = null, bool pk = false) =>
        new(name, type ?? kind, kind, !pk, pk);

    public static SourceTable Table(string name, params SourceColumn[] columns) =>
        new(name, name, null, "dbo", ObjectTypes.Table, columns, columns.Where(c => c.IsPk).Select(c => c.Name).ToList(), []);

    /// <summary>crm.customers(id, name, email, country_id, active, created, uid), crm.countries(id, name), shop.orders(id, customer_id, total, status, order_date), shop.lines(order_id, product_id, qty).</summary>
    public static LinkTableCatalog Shop()
    {
        var customers = Table("customers", Col("id", ColumnKinds.Int, "int", true), Col("name", ColumnKinds.String, "nvarchar(100)"),
            Col("email", ColumnKinds.String), Col("country_id", ColumnKinds.Int), Col("active", ColumnKinds.Bool, "bit"),
            Col("created", ColumnKinds.DateTime, "datetime2"), Col("uid", ColumnKinds.Guid, "uniqueidentifier"), Col("birthday", ColumnKinds.Date, "date"));
        var countries = Table("countries", Col("id", ColumnKinds.Int, "int", true), Col("name", ColumnKinds.String));
        var orders = Table("orders", Col("id", ColumnKinds.Int, "integer", true), Col("customer_id", ColumnKinds.Int), Col("total", ColumnKinds.Decimal, "numeric(12,2)"),
            Col("status", ColumnKinds.String), Col("order_date", ColumnKinds.DateTime, "timestamp"));
        var lines = Table("lines", Col("order_id", ColumnKinds.Int), Col("product_id", ColumnKinds.Int), Col("qty", ColumnKinds.Int));
        return new LinkTableCatalog([("crm", customers), ("crm", countries), ("shop", orders), ("shop", lines)], "crm");
    }

    public static QueryAnalysis Analyze(string sql, LinkTableCatalog? catalog = null) =>
        QueryAnalyzer.Analyze(DuckDbProbe.SerializeSql(sql), sql, catalog ?? Shop());

    public static AnalyzedTable T(this QueryAnalysis a, string reference) =>
        a.Tables.Single(t => t.Table.ToString().Equals(reference, StringComparison.OrdinalIgnoreCase));

    public static string Preds(this AnalyzedTable t) =>
        string.Join(" AND ", t.Predicates.Select(p => p.Op switch
        {
            PushdownOps.IsNotNull => $"{p.Column} isNotNull",
            _ => $"{p.Column} {p.Op} {string.Join(",", p.Values.Select(v => $"{v.Kind}:{v.Value}"))}",
        }));
}

/// <summary>Collects what a session reports.</summary>
internal sealed class CollectingSink : IExecutionSink
{
    public List<ColumnInfo[]> ResultSets { get; } = [];
    public List<List<object?[]>> Sets { get; } = [];
    public List<(MessageSeverity Severity, string Text)> Messages { get; } = [];
    public List<ErrorInfo> Errors { get; } = [];
    public List<BatchStatus> Batches { get; } = [];

    public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;

    public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns)
    {
        lock (this)
        {
            ResultSets.Add(columns);
            Sets.Add([]);
        }
        return ValueTask.CompletedTask;
    }

    public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows)
    {
        lock (this) Sets[^1].AddRange(rows);
        return ValueTask.CompletedTask;
    }

    public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
    public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;

    public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source)
    {
        lock (this) Messages.Add((severity, text));
        return ValueTask.CompletedTask;
    }

    public ValueTask Error(int batchIndex, ErrorInfo error)
    {
        lock (this) Errors.Add(error);
        return ValueTask.CompletedTask;
    }

    public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status)
    {
        lock (this) Batches.Add(status);
        return ValueTask.CompletedTask;
    }

    public List<object?[]> Single()
    {
        Assert.True(Errors.Count == 0, string.Join("; ", Errors.Select(e => $"{e.Code}: {e.Message}")));
        return Assert.Single(Sets);
    }
}

/// <summary>The real federation stack (connection store, providers, runtime, linked provider) in a temp data directory.</summary>
internal sealed class FederationHarness : IAsyncDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "rowlit-fed-" + Guid.NewGuid().ToString("N")[..10]);
    private readonly ServiceProvider _services;
    private readonly List<IDbSession> _sessions = [];

    public FederationHarness(Action<JsonObject>? settings = null)
    {
        Directory.CreateDirectory(_dir);
        Paths = new AppPaths(Path.Combine(_dir, "data"));
        Directory.CreateDirectory(Paths.DataDir);
        var services = new ServiceCollection();
        services.AddSingleton(Paths);
        services.AddSingleton<ISecretStore>(new InMemorySecretStore());
        services.AddSingleton<IDbProvider, SqliteProvider>();
        services.AddSingleton<IDbProvider, SqlServerProvider>();
        services.AddSingleton<IDbProvider, PostgreSqlProvider>();
        services.AddSingleton<IDbProvider, MySqlProvider>();
        services.AddSingleton<IDbProvider, MariaDbProvider>();
        services.AddSingleton<IDbProvider, OracleProvider>();
        services.AddSingleton<IDbProvider, ClickHouseProvider>();
        services.AddSingleton<ProviderRegistry>();
        services.AddSingleton(sp => new ConnectionStore(Paths, sp.GetRequiredService<ISecretStore>(), sp.GetRequiredService<ProviderRegistry>()));
        var settingsService = new SettingsService(Paths);
        if (settings is not null)
        {
            var links = new JsonObject();
            settings(links);
            settingsService.Update(new JsonObject { ["links"] = links });
        }
        services.AddSingleton(settingsService);
        new FederationModule().ConfigureServices(services);
        _services = services.BuildServiceProvider();
    }

    public AppPaths Paths { get; }
    public string Dir => _dir;
    public IServiceProvider Services => _services;
    public ConnectionStore Connections => _services.GetRequiredService<ConnectionStore>();
    public ProviderRegistry Providers => _services.GetRequiredService<ProviderRegistry>();
    public LinkRuntime Runtime => _services.GetRequiredService<LinkRuntime>();
    public IDbProvider Linked => Providers.Get(LinkIds.ProviderId);

    public string AddConnection(ConnectionProfile profile, string? password) => Connections.Create(profile, password).Id;

    /// <summary>A SQLite database file seeded with <paramref name="sql"/>, saved as a connection.</summary>
    public string AddSqlite(string name, string sql)
    {
        var path = Path.Combine(_dir, name + ".db");
        using (var c = new SqliteConnection($"Data Source={path};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
        return AddConnection(new ConnectionProfile { Name = name, ProviderId = "sqlite", Props = new() { ["path"] = path } }, null);
    }

    public string AddLink(string name, LinkDefinition def)
    {
        var profile = new ConnectionProfile { Name = name, ProviderId = LinkIds.ProviderId, ReadOnly = true, Folder = LinkIds.DefaultFolder };
        def.WriteTo(profile.Props);
        return AddConnection(profile, null);
    }

    public async Task<IDbSession> OpenAsync(string linkId)
    {
        var profile = Connections.WithSecrets(Connections.Get(linkId));
        var s = await Linked.OpenSessionAsync(profile, null, new SessionOptions(Ids.New("s"), null, TransactionMode.Auto, false), default);
        _sessions.Add(s);
        return s;
    }

    public static async Task<CollectingSink> RunAsync(IDbSession session, string sql, int maxRows = 0, bool writesConfirmed = false,
        IReadOnlyList<DbStudio.Core.Params.QueryParam>? parameters = null)
    {
        var sink = new CollectingSink();
        await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], maxRows, true, false, "statement", parameters, writesConfirmed), sink, default);
        return sink;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var s in _sessions)
        {
            try { await s.DisposeAsync(); } catch { /* closing */ }
        }
        await _services.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch { /* files still open */ }
    }
}
