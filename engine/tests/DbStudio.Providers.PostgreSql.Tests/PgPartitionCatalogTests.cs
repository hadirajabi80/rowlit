using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.PostgreSql.Tests;

/// <summary>
/// Partitioned tables, inheritance, materialized views WITH NO DATA and trigger names reused on several tables
/// (a scratch schema per test class run; skipped without Docker).
/// </summary>
public sealed class PgPartitionCatalogTests(PgFixture fixture) : IClassFixture<PgFixture>, IAsyncLifetime
{
    private const string Schema = "zz_qa_parts";
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    private async Task RunAsync(string sql)
    {
        await using var s = await fixture.OpenSessionAsync();
        var sink = new RecordingSink();
        var summary = await s.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 10, true, false, "script"), sink, CancellationToken.None).WaitAsync(Timeout);
        Assert.True(summary.Status == ExecutionStatus.Ok, sink.Describe());
    }

    public async Task InitializeAsync()
    {
        if (!fixture.IsAvailable) return;
        await RunAsync($"DROP SCHEMA IF EXISTS {Schema} CASCADE");
        await RunAsync($$"""
            CREATE SCHEMA {{Schema}};
            CREATE TABLE {{Schema}}.meas (id bigint, logdate date NOT NULL, temp int) PARTITION BY RANGE (logdate);
            CREATE TABLE {{Schema}}.meas_2025 PARTITION OF {{Schema}}.meas FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
            CREATE TABLE {{Schema}}.meas_def PARTITION OF {{Schema}}.meas DEFAULT;
            INSERT INTO {{Schema}}.meas SELECT i, '2025-06-01', i FROM generate_series(1, 2000) i;
            CREATE TABLE {{Schema}}.parent_t (id int, a text);
            CREATE TABLE {{Schema}}.child_t (extra int) INHERITS ({{Schema}}.parent_t);
            CREATE MATERIALIZED VIEW {{Schema}}.mv_empty AS SELECT 1 AS x WITH NO DATA;
            CREATE MATERIALIZED VIEW {{Schema}}.mv_full AS SELECT 1 AS x;
            CREATE FUNCTION {{Schema}}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
            CREATE TRIGGER trg_touch BEFORE INSERT ON {{Schema}}.meas FOR EACH ROW EXECUTE FUNCTION {{Schema}}.touch();
            CREATE TABLE {{Schema}}.a (id int);
            CREATE TABLE {{Schema}}.b (id int);
            CREATE TRIGGER trg_shared BEFORE INSERT ON {{Schema}}.a FOR EACH ROW EXECUTE FUNCTION {{Schema}}.touch();
            CREATE TRIGGER trg_shared BEFORE INSERT ON {{Schema}}.b FOR EACH ROW EXECUTE FUNCTION {{Schema}}.touch();
            ANALYZE {{Schema}}.meas
            """);
    }

    public async Task DisposeAsync()
    {
        if (fixture.IsAvailable) await RunAsync($"DROP SCHEMA IF EXISTS {Schema} CASCADE");
    }

    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");

    private async Task<string> DdlAsync(string name, string type)
    {
        await using var reader = await fixture.OpenCatalogAsync();
        return (await reader.GetDdlAsync(new ObjectRef(null, Schema, name, type), CancellationToken.None)).Ddl;
    }

    [SkippableFact]
    public async Task Triggers_ArePerTable_NotClonedOntoPartitions_AndSharedNamesAreDisambiguated()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var catalog = await reader.LoadSchemaAsync(null, Schema, CancellationToken.None);
        var triggers = catalog.Objects.Where(o => o.Type == ObjectTypes.Trigger).Select(o => o.Name).Order().ToList();
        Assert.Equal(["trg_shared on a", "trg_shared on b", "trg_touch"], triggers);
        Assert.DoesNotContain(catalog.Objects, o => o.Name is "meas_2025" or "meas_def");

        var a = await DdlAsync("trg_shared on a", ObjectTypes.Trigger);
        var b = await DdlAsync("trg_shared on b", ObjectTypes.Trigger);
        Assert.Contains($"ON {Schema}.a ", a);
        Assert.DoesNotContain($"{Schema}.b", a);
        Assert.Contains($"ON {Schema}.b ", b);
        // A plain name still resolves (to one of them) and the unique trigger keeps its plain name.
        Assert.Contains("trg_touch", await DdlAsync("trg_touch", ObjectTypes.Trigger));

        await using var deps = await new PostgreSqlProvider().OpenDependencyReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var graph = await deps.GetDependenciesAsync(new ObjectRef(null, Schema, "trg_shared on b", ObjectTypes.Trigger), CancellationToken.None);
        Assert.Contains(graph.Uses, d => d.Object.Name == "b");
        Assert.DoesNotContain(graph.Uses, d => d.Object.Name == "a");
        await using var lister = await new PostgreSqlProvider().OpenObjectListReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var list = await lister.ListAsync(null, Schema, ObjectTypes.Trigger, CancellationToken.None);
        Assert.Equal(["trg_shared on a", "trg_shared on b", "trg_touch"], list.Select(i => i.Name).Order());
    }

    [SkippableFact]
    public async Task Ddl_ScriptsPartitions_Inheritance_AndMaterializedViewPopulation()
    {
        RequireAvailable();
        var parent = await DdlAsync("meas", ObjectTypes.Table);
        Assert.Contains("PARTITION BY RANGE (logdate)", parent);
        Assert.Contains($"CREATE TABLE {Schema}.meas_2025 PARTITION OF {Schema}.meas FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');", parent);
        Assert.Contains($"CREATE TABLE {Schema}.meas_def PARTITION OF {Schema}.meas DEFAULT;", parent);

        var partition = await DdlAsync("meas_2025", ObjectTypes.Table);
        Assert.StartsWith($"CREATE TABLE {Schema}.meas_2025 PARTITION OF {Schema}.meas FOR VALUES FROM", partition);
        Assert.DoesNotContain("logdate date", partition);

        var child = await DdlAsync("child_t", ObjectTypes.Table);
        Assert.Contains($"INHERITS ({Schema}.parent_t)", child);

        Assert.Contains("WITH NO DATA;", await DdlAsync("mv_empty", ObjectTypes.MView));
        Assert.Contains("WITH DATA;", await DdlAsync("mv_full", ObjectTypes.MView));
    }

    [SkippableFact]
    public async Task ObjectList_PartitionedTable_ReportsTheSizeAndRowsOfItsPartitions()
    {
        RequireAvailable();
        await using var deps = await new PostgreSqlProvider().OpenObjectListReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var meas = (await deps.ListAsync(null, Schema, ObjectTypes.Table, CancellationToken.None)).Single(i => i.Name == "meas");
        Assert.True(meas.SizeBytes > 0, "partitioned parent size");
        Assert.Equal(2000, meas.RowCount);
        Assert.DoesNotContain(await deps.ListAsync(null, Schema, null, CancellationToken.None), i => i.Name.StartsWith("meas_", StringComparison.Ordinal));
    }
}
