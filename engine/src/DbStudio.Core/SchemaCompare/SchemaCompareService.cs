using System.Diagnostics;
using System.Text;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.SchemaCompare;

/// <summary>
/// Schema compare / structure synchronization: compares two schemas of the same kind of database (SQL Server, PostgreSQL,
/// MySQL, MariaDB, SQLite, Oracle) and scripts what the target needs to match the source. The comparison runs as a job
/// (<c>schema.compare</c>, progress and result over the WebSocket); its result stays in memory so items, scripts and the
/// apply work on the same snapshot. Tables are diffed and scripted with the table designer's own diff and per-dialect
/// scripters; views, routines, triggers and sequences are compared by normalised definition.
/// </summary>
public sealed class SchemaCompareService(ConnectionStore connections, ProviderRegistry providers, ProviderFeatures features, DesignerService designer,
    JobManager jobs)
{
    public const string JobKind = "schema.compare";

    private static readonly HashSet<string> Supported = new(StringComparer.OrdinalIgnoreCase)
        { "sqlserver", "postgresql", "mysql", "mariadb", "sqlite", "oracle" };

    private readonly CompareStore _store = new();

    /// <summary><c>GET /schema-compare/support?connectionId=</c>: whether the connection's provider can be compared, and why not.</summary>
    public CompareSupport Support(string? connectionId)
    {
        if (string.IsNullOrWhiteSpace(connectionId)) throw EngineException.Validation("connectionId is required.", new { field = "connectionId" });
        var profile = connections.Get(connectionId);
        var provider = providers.Find(profile.ProviderId);
        if (provider is null)
            return new CompareSupport(false, profile.ProviderId, null, false, profile.ReadOnly, $"Schema compare needs a relational connection; '{profile.Name}' is not one.");
        if (!Supported.Contains(provider.Id))
            return new CompareSupport(false, provider.Id, CoreJson.ToWire(provider.Dialect), false, profile.ReadOnly,
                $"Schema compare is not supported for {provider.DisplayName} yet. It works with SQL Server, PostgreSQL, MySQL, MariaDB, SQLite and Oracle.");
        return new CompareSupport(true, provider.Id, CoreJson.ToWire(provider.Dialect), DialectInfo.SchemaIsDatabase(provider.Dialect), profile.ReadOnly, null);
    }

    // ------------------------------------------------------------------ start

    /// <summary>Validates the request and starts the comparison job; returns the job id.</summary>
    public string Start(CompareRequest? request, string? clientId)
    {
        var (src, tgt, sourceEndpoint, targetEndpoint, options) = Validate(request);
        return jobs.Start(JobKind, targetEndpoint.ConnectionId, clientId, async (job, ct) =>
        {
            var sw = Stopwatch.StartNew();
            return await RunAsync(src, tgt, sourceEndpoint, targetEndpoint, options, clientId ?? "", job, ct, sw).ConfigureAwait(false);
        });
    }

    private (ProviderContext Src, ProviderContext Tgt, CompareEndpoint SrcEp, CompareEndpoint TgtEp, CompareOptions Options) Validate(CompareRequest? request)
    {
        if (request?.Source is null || request.Target is null) throw EngineException.Validation("source and target are required.", new { field = "source" });
        var src = Resolve(request.Source, "source");
        var tgt = Resolve(request.Target, "target");
        if (!src.ProviderId.Equals(tgt.ProviderId, StringComparison.OrdinalIgnoreCase))
            throw EngineException.Validation($"Source and target must be the same kind of database ({src.Provider.DisplayName} and {tgt.Provider.DisplayName} differ).",
                new { field = "target" });
        if (SameEndpoint(request.Source, request.Target))
            throw EngineException.Validation("Source and target are the same schema.", new { field = "target" });
        return (src, tgt, request.Source, request.Target, request.Options ?? new CompareOptions());
    }

    private static bool SameEndpoint(CompareEndpoint a, CompareEndpoint b) =>
        a.ConnectionId == b.ConnectionId && string.Equals(a.Database ?? "", b.Database ?? "", StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.Schema ?? "", b.Schema ?? "", StringComparison.OrdinalIgnoreCase);

    private ProviderContext Resolve(CompareEndpoint endpoint, string field)
    {
        if (string.IsNullOrWhiteSpace(endpoint.ConnectionId)) throw EngineException.Validation($"{field}.connectionId is required.", new { field });
        var profile = connections.ResolveForOpen(connections.Get(endpoint.ConnectionId));
        var provider = providers.Find(profile.ProviderId)
                       ?? throw new EngineException(400, ErrorCodes.NotSupported, $"Schema compare needs a relational connection; '{profile.Name}' is not one.");
        if (!Supported.Contains(provider.Id))
            throw new EngineException(400, ErrorCodes.NotSupported,
                $"Schema compare is not supported for {provider.DisplayName} yet. It works with SQL Server, PostgreSQL, MySQL, MariaDB, SQLite and Oracle.");
        return new ProviderContext(profile, connections.GetPassword(endpoint.ConnectionId), provider, features.Database(provider.Id), features.Scripter(provider.Id));
    }

    private async Task<CompareResult> RunAsync(ProviderContext src, ProviderContext tgt, CompareEndpoint srcEp, CompareEndpoint tgtEp, CompareOptions options,
        string clientId, JobContext job, CancellationToken ct, Stopwatch sw)
    {
        job.Report(0, null, "Reading the schemas", force: true);
        long done = 0, total = 0;
        void Progress(string name) => job.Report(Interlocked.Increment(ref done), Interlocked.Read(ref total), name);
        void AddTotal(int n) => Interlocked.Add(ref total, n);

        var (srcDb, srcSchema) = await SnapshotReader.ResolveAsync(src, srcEp, ct).ConfigureAwait(false);
        var (tgtDb, tgtSchema) = await SnapshotReader.ResolveAsync(tgt, tgtEp, ct).ConfigureAwait(false);
        var srcTask = SnapshotReader.ReadAsync(src, srcDb, srcSchema, options, Progress, AddTotal, ct);
        var tgtTask = SnapshotReader.ReadAsync(tgt, tgtDb, tgtSchema, options, Progress, AddTotal, ct);
        await Task.WhenAll(srcTask, tgtTask).ConfigureAwait(false);
        var srcSnap = await srcTask.ConfigureAwait(false);
        var tgtSnap = await tgtTask.ConfigureAwait(false);

        job.Report(done, total, "Comparing", force: true);
        var items = SchemaComparer.Compare(srcSnap, tgtSnap, options, tgt.Dialect, tgt.ProviderId);
        var model = new ComparisonModel
        {
            Id = Ids.New("cmp"), Source = src, Target = tgt, SourceEndpoint = srcEp, TargetEndpoint = tgtEp, SourceSnapshot = srcSnap,
            TargetSnapshot = tgtSnap, Options = options, Items = items, ClientId = clientId,
        };
        _store.Add(model);

        var notes = srcSnap.Notes.Concat(tgtSnap.Notes).Distinct(StringComparer.Ordinal).ToList();
        var ctx = await model.ContextAsync(null, ct).ConfigureAwait(false);
        var transactional = tgt.Scripter.GetTypes(ctx).Features.TransactionalDdl;
        var counts = new CompareCounts(items.Count(i => i.Status == CompareStatus.Create), items.Count(i => i.Status == CompareStatus.Drop),
            items.Count(i => i.Status == CompareStatus.Alter), items.Count(i => i.Status == CompareStatus.Identical));
        return new CompareResult(model.Id, tgt.ProviderId, CoreJson.ToWire(tgt.Dialect), Label(src, srcDb, srcSchema), Label(tgt, tgtDb, tgtSchema),
            srcSchema, tgtSchema, items.Select(i => i.ToWire()).ToList(), counts, notes, transactional, sw.ElapsedMilliseconds);
    }

    private static string Label(ProviderContext p, string? database, string schema) =>
        string.Join(" › ", new[] { p.Profile.Name, database, schema }.Where(s => !string.IsNullOrWhiteSpace(s)));

    // ------------------------------------------------------------------ items

    public async Task<CompareItemDetail> ItemAsync(string compareId, string itemId, CancellationToken ct)
    {
        var model = _store.Get(compareId);
        var item = model.Find(itemId) ?? throw EngineException.NotFound($"Item '{itemId}'");
        string? srcDdl = null, tgtDdl = null;
        var ctx = await model.ContextAsync(item.Kind == CompareKinds.Table ? item.Name : null, ct).ConfigureAwait(false);
        if (item.Kind == CompareKinds.Table)
        {
            srcDdl = item.SrcTable is null ? null : TableDdl(model, item.SrcTable, ctx);
            tgtDdl = item.TgtTable is null ? null : TableDdl(model, item.TgtTable, ctx);
        }
        else
        {
            srcDdl = item.CreateDdl is null ? null : item.CreateDdl.Trim();
            tgtDdl = item.Tgt?.Ddl.Trim();
        }
        var script = item.Status == CompareStatus.Identical ? null : await ScriptBuilder.BuildAsync(model, [item.Id], ct).ConfigureAwait(false);
        var statements = script?.Statements ?? [];
        return new CompareItemDetail(item.ToWire(), srcDdl, tgtDdl, statements);
    }

    private static string TableDdl(ComparisonModel model, TableModel table, DdlScriptContext ctx)
    {
        try
        {
            var script = model.Target.Scripter.ScriptTable(null, table, ctx);
            return DesignerService.HistorySql(model.Dialect, script.Statements.Select(s => s.Sql).ToList());
        }
        catch (ArgumentException ex)
        {
            return $"-- The table could not be scripted: {ex.Message}";
        }
    }

    // ------------------------------------------------------------------ script

    public async Task<CompareScript> ScriptAsync(string compareId, CompareScriptRequest? request, CancellationToken ct)
    {
        var model = _store.Get(compareId);
        var built = await ScriptBuilder.BuildAsync(model, request?.ItemIds, ct).ConfigureAwait(false);
        var text = ScriptText.Build(model, built);
        return new CompareScript(built.Statements, text, built.Warnings, built.TransactionalDdl, built.ItemCount);
    }

    // ------------------------------------------------------------------ apply

    public async Task<CompareApplyResult> ApplyAsync(string compareId, CompareApplyRequest? request, string? clientId, CancellationToken ct)
    {
        var model = _store.Get(compareId);
        var built = await ScriptBuilder.BuildAsync(model, request?.ItemIds, ct).ConfigureAwait(false);
        var statements = built.Statements;
        var sw = Stopwatch.StartNew();
        if (statements.Count == 0) return new CompareApplyResult(true, 0, 0, false, built.TransactionalDdl, 0, []);
        var stop = request?.StopOnError ?? true;
        var connectionId = model.TargetEndpoint.ConnectionId;
        var database = model.TargetDatabase;
        var failures = new List<CompareApplyFailure>();

        if (stop || model.Dialect == Dialect.Sqlite)
        {
            try
            {
                var result = await designer.ApplyAsync(connectionId,
                    new DdlApplyRequest(database, statements.Select(s => s.Sql).ToList(), built.TransactionalDdl, model.TargetSchema), clientId, ct).ConfigureAwait(false);
                return new CompareApplyResult(result.Ok, result.Executed, statements.Count, false, built.TransactionalDdl, result.ElapsedMs, []);
            }
            catch (DdlFailedException ex)
            {
                var index = Math.Clamp(ex.FailedIndex, 0, statements.Count - 1);
                failures.Add(new CompareApplyFailure(index, statements[index].Sql, ex.ProviderError.Message, ex.ProviderError.Code, statements[index].ItemId));
                return new CompareApplyResult(false, ex.Executed, statements.Count, ex.RolledBack, built.TransactionalDdl, sw.ElapsedMilliseconds, failures);
            }
        }

        // continue on error: every statement on its own, failures are collected
        var executed = 0;
        for (var i = 0; i < statements.Count; i++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await designer.ApplyAsync(connectionId, new DdlApplyRequest(database, [statements[i].Sql], false, model.TargetSchema), clientId, ct).ConfigureAwait(false);
                executed++;
            }
            catch (DdlFailedException ex)
            {
                failures.Add(new CompareApplyFailure(i, statements[i].Sql, ex.ProviderError.Message, ex.ProviderError.Code, statements[i].ItemId));
            }
        }
        return new CompareApplyResult(failures.Count == 0, executed, statements.Count, false, built.TransactionalDdl, sw.ElapsedMilliseconds, failures);
    }

    public void Discard(string compareId) => _store.Remove(compareId);

    /// <summary>Runs a comparison to completion in the caller's task, without a job and its events (embedding and tests).</summary>
    public async Task<CompareResult> CompareNowAsync(CompareRequest request, CancellationToken ct)
    {
        var (src, tgt, srcEp, tgtEp, options) = Validate(request);
        var job = new JobContext(jobs, "j_inline", JobKind, tgtEp.ConnectionId);
        return await RunAsync(src, tgt, srcEp, tgtEp, options, "", job, ct, Stopwatch.StartNew()).ConfigureAwait(false);
    }
}

/// <summary>The script of a comparison as console text: header, warnings, statements with the dialect's batch separators.</summary>
internal static class ScriptText
{
    public static string Build(ComparisonModel m, BuiltScript built)
    {
        var d = m.Dialect;
        var sb = new StringBuilder();
        sb.Append("-- Rowlit schema synchronization\n");
        sb.Append("-- Source: ").Append(Label(m.Source, m.SourceSnapshot)).Append('\n');
        sb.Append("-- Target: ").Append(Label(m.Target, m.TargetSnapshot)).Append(" (this script changes the target)\n");
        sb.Append("-- ").Append(built.ItemCount).Append(built.ItemCount == 1 ? " object, " : " objects, ").Append(built.Statements.Count)
            .Append(built.Statements.Count == 1 ? " statement" : " statements").Append(built.TransactionalDdl ? "; DDL is transactional on this server.\n" : "; DDL is not transactional on this server: a failure leaves earlier statements applied.\n");
        var dataLoss = built.Warnings.Where(w => w.Severity == "dataLoss").Select(w => w.Message).Distinct().ToList();
        if (dataLoss.Count > 0)
        {
            sb.Append("--\n-- DATA LOSS WARNINGS\n");
            foreach (var w in dataLoss) sb.Append("--   ").Append(OneLine(w)).Append('\n');
        }
        sb.Append('\n');
        foreach (var st in built.Statements)
        {
            if (!string.IsNullOrWhiteSpace(st.Warning)) sb.Append("-- WARNING: ").Append(OneLine(st.Warning)).Append('\n');
            sb.Append(Terminated(d, st)).Append("\n\n");
        }
        return sb.ToString().TrimEnd() + "\n";
    }

    private static string Label(ProviderContext p, SchemaSnapshot s) =>
        string.Join(" > ", new[] { p.Profile.Name, s.Database, s.Schema }.Where(x => !string.IsNullOrWhiteSpace(x)));

    private static string OneLine(string s) => s.Replace("\r", " ").Replace("\n", " ");

    private static bool IsBlock(ScriptStatement st) =>
        st.ItemId is { } id && (id.StartsWith("proc:", StringComparison.OrdinalIgnoreCase) || id.StartsWith("func:", StringComparison.OrdinalIgnoreCase)
                                || id.StartsWith("trigger:", StringComparison.OrdinalIgnoreCase) || id.StartsWith("package:", StringComparison.OrdinalIgnoreCase))
        && st.Sql.TrimStart().StartsWith("CREATE", StringComparison.OrdinalIgnoreCase);

    internal static string Terminated(Dialect d, ScriptStatement st)
    {
        var sql = st.Sql.TrimEnd();
        switch (d)
        {
            case Dialect.TSql:
                return sql + "\nGO";
            case Dialect.PlSql:
                return IsBlock(st) ? sql + "\n/" : sql + ";";
            case Dialect.MySql when IsBlock(st) && sql.Contains(';', StringComparison.Ordinal):
                return "DELIMITER $$\n" + sql + " $$\nDELIMITER ;";
            default:
                return sql.EndsWith(';') ? sql : sql + ";";
        }
    }
}
