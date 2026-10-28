using System.Collections.Concurrent;
using System.Data.Common;
using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Sql;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Diagnostics;
using DbStudio.Federation.Engine;
using DbStudio.Federation.Pushdown;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Federation.Runtime;

/// <summary>
/// The engine-side services of linked databases (<see cref="ILinkRuntime"/>, plan-links 2): link definitions from the
/// connection store (member credentials resolved with <see cref="ConnectionStore.WithSecrets"/> and the secret store,
/// never sent anywhere), validation, the cached link catalog, push-down plans, federation contexts (one per console
/// session, registered here so "Refresh sources" and materialize reach their caches) and one-off queries.
/// </summary>
public sealed class LinkRuntime : ILinkRuntime
{
    /// <summary>Sources fetched at the same time by one statement.</summary>
    internal const int MaxParallelFetches = 6;

    /// <summary>How long a link catalog is reused without asking the members again.</summary>
    internal static readonly TimeSpan CatalogTtl = TimeSpan.FromMinutes(2);

    private const long DefaultMaxRows = 2_000_000;
    private const int DefaultFetchTimeoutSeconds = 300;
    private const long MinMemoryLimit = 512L * 1024 * 1024;

    private readonly IServiceProvider _services;
    private readonly ConnectionStore _connections;
    private readonly ProviderRegistry _providers;
    private readonly SettingsService? _settings;
    private readonly AppPaths? _paths;
    private readonly DuckDbEngineFactory _factory;
    private readonly ILogger _log;
    private readonly ConcurrentDictionary<string, CatalogEntry> _catalogs = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _catalogGates = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, FederationContext> _contexts = new(StringComparer.Ordinal);

    private sealed record CatalogEntry(string Fingerprint, LinkCatalog Catalog, DateTimeOffset LoadedAt);

    public LinkRuntime(IServiceProvider services, ConnectionStore connections, ProviderRegistry providers, IFederationEngineFactory factory,
        SettingsService? settings = null, AppPaths? paths = null, ILogger<LinkRuntime>? log = null)
    {
        _services = services;
        _connections = connections;
        _providers = providers;
        _settings = settings;
        _paths = paths;
        _factory = factory as DuckDbEngineFactory ?? new DuckDbEngineFactory();
        _log = log ?? (ILogger)NullLogger.Instance;
        CleanStaleTempDirectories();
    }

    /// <summary>Which engine this build runs (DuckDB, or the SQLite fallback and why).</summary>
    internal FederationEngineInfo EngineInfo() => _factory.Probe();

    /// <summary>Spill directories of every federated session: <c>&lt;DataDir&gt;/tmp/links</c>.</summary>
    internal string? TempRoot => _paths is null ? null : Path.Combine(_paths.DataDir, "tmp", "links");

    private void CleanStaleTempDirectories()
    {
        // No session exists yet: whatever is left is from an engine that did not shut down cleanly.
        if (TempRoot is { } root && Directory.Exists(root)) DuckDbEngine.TryDeleteDirectory(root);
    }

    // ------------------------------------------------------------------ definitions and members

    public LinkDefinition Definition(string linkId) => LinkDefinition.FromProfile(LinkProfile(linkId));

    internal ConnectionProfile LinkProfile(string linkId)
    {
        var profile = _connections.Get(linkId);
        if (profile.ProviderId != LinkIds.ProviderId)
            throw EngineException.Validation($"The connection '{profile.Name}' is not a linked database.", new { field = "connectionId" });
        return profile;
    }

    /// <summary>A member with what it takes to read it (or why it cannot be read).</summary>
    internal sealed record MemberHandle(int Index, LinkMember Member, string? ProviderId, ISourceFetcher? Fetcher, SourceContext? Context, string? Error,
        string? ProviderName);

    internal MemberHandle ResolveMember(int index, LinkMember member, FederationLimits limits, string? sessionId)
    {
        if (member.Kind == LinkMemberKinds.Files)
        {
            var fetcher = _services.GetKeyedService<ISourceFetcher>(FetcherKeys.Files);
            if (fetcher is null) return new MemberHandle(index, member, null, null, null, "File members are not supported in this build.", null);
            return new MemberHandle(index, member, FetcherKeys.Files, fetcher,
                new SourceContext { Member = member, Limits = limits, Services = _services, SessionId = sessionId }, null, "files");
        }
        if (string.IsNullOrWhiteSpace(member.ConnectionId))
            return new MemberHandle(index, member, null, null, null, $"The member '{member.Alias}' has no connection.", null);
        var stored = _connections.Find(member.ConnectionId);
        if (stored is null)
            return new MemberHandle(index, member, null, null, null, $"The connection of member '{member.Alias}' no longer exists.", null);
        if (stored.ProviderId == LinkIds.ProviderId)
            return new MemberHandle(index, member, stored.ProviderId, null, null, $"The member '{member.Alias}' is itself a linked database.", null);
        var key = FetcherKeys.For(member, stored.ProviderId);
        var f = _services.GetKeyedService<ISourceFetcher>(key);
        var relational = _providers.Find(stored.ProviderId);
        IDataSourceProvider? source = null;
        if (relational is null) source = _services.GetService<SourceRegistry>()?.Find(stored.ProviderId);
        var display = relational?.DisplayName ?? source?.DisplayName ?? stored.ProviderId;
        if (f is null)
            return new MemberHandle(index, member, stored.ProviderId, null, null, $"{display} connections cannot be members of a linked database yet.", display);
        ConnectionProfile memberProfile;
        try
        {
            memberProfile = _connections.ResolveForOpen(stored); // WP-SSH: a member with a tunnel is fetched through it
        }
        catch (EngineException ex)
        {
            return new MemberHandle(index, member, stored.ProviderId, null, null, $"The member '{member.Alias}': {ex.Message}", display);
        }
        var context = new SourceContext
        {
            Member = member,
            Profile = memberProfile,
            Password = _connections.GetPassword(stored.Id),
            Provider = relational,
            Source = source,
            Limits = limits,
            Services = _services,
            SessionId = sessionId,
        };
        return new MemberHandle(index, member, stored.ProviderId, f, context, null, display);
    }

    // ------------------------------------------------------------------ limits

    /// <summary>The <c>links.*</c> settings merged with the link's options (and a per-query row cap).</summary>
    internal FederationLimits Limits(LinkDefinition def, string contextId, long? maxRowsOverride = null)
    {
        var s = _settings?.Get()["links"] as System.Text.Json.Nodes.JsonObject;
        double Num(string key, double fallback) => s?[key] is { } n ? SettingsService.Number(n) : fallback;
        var maxRows = maxRowsOverride ?? def.Options.MaxRowsPerSource ?? (long)Num("maxRowsPerSource", DefaultMaxRows);
        var timeout = def.Options.FetchTimeoutSeconds ?? (int)Num("fetchTimeoutSeconds", DefaultFetchTimeoutSeconds);
        var memoryMb = (long)Num("memoryLimitMb", 0);
        var memory = memoryMb > 0 ? memoryMb * 1024 * 1024 : AutoMemoryLimit();
        var threads = (int)Num("threads", 0);
        var cache = def.Options.CacheSources ?? (s?["cacheSources"] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<bool>(out var b) ? b : true);
        var temp = TempRoot is { } root ? Path.Combine(root, contextId) : Path.Combine(Path.GetTempPath(), "rowlit-links", contextId);
        return new FederationLimits(Math.Max(1, maxRows), TimeSpan.FromSeconds(Math.Max(1, timeout)), memory, Math.Max(0, threads), temp, cache);
    }

    /// <summary>25% of the memory available to the process, at least 512 MB.</summary>
    internal static long AutoMemoryLimit()
    {
        var total = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
        return Math.Max(MinMemoryLimit, total > 0 ? total / 4 : MinMemoryLimit);
    }

    // ------------------------------------------------------------------ contexts

    /// <summary>Opens the federation context of a console session (or of one query): an engine with the members' schemas.</summary>
    internal async Task<FederationContext> OpenContextAsync(string linkId, LinkDefinition def, string contextId, bool register, long? maxRowsOverride,
        CancellationToken ct)
    {
        var limits = Limits(def, contextId, maxRowsOverride);
        var aliases = def.Members.Select(m => m.Alias).Where(LinkRules.IsValidAlias).ToList();
        var options = new FederationEngineOptions(def.Options.Engine, limits.MemoryLimitBytes, limits.Threads, limits.TempDirectory);
        var engine = await _factory.OpenAsync(options, aliases, aliases.FirstOrDefault(), ct).ConfigureAwait(false);
        var warning = engine.Name == "sqlite" ? _factory.Probe().Error ?? "DuckDB is not available." : null;
        var context = new FederationContext(this, linkId, contextId, engine, limits, warning);
        if (register) _contexts[contextId] = context;
        return context;
    }

    internal void Unregister(FederationContext context) => _contexts.TryRemove(new KeyValuePair<string, FederationContext>(context.Id, context));

    internal FederationContext? FindContext(string id) => _contexts.GetValueOrDefault(id);

    // ------------------------------------------------------------------ catalog

    public async Task<LinkCatalog> CatalogAsync(string linkId, bool refresh, CancellationToken ct)
    {
        var profile = LinkProfile(linkId);
        var def = LinkDefinition.FromProfile(profile);
        var fingerprint = JsonSerializer.Serialize(profile.Props, CoreJson.Options);
        if (!refresh && _catalogs.TryGetValue(linkId, out var hit) && hit.Fingerprint == fingerprint && DateTimeOffset.UtcNow - hit.LoadedAt < CatalogTtl)
            return hit.Catalog;
        var gate = _catalogGates.GetOrAdd(linkId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (!refresh && _catalogs.TryGetValue(linkId, out hit) && hit.Fingerprint == fingerprint && DateTimeOffset.UtcNow - hit.LoadedAt < CatalogTtl)
                return hit.Catalog;
            var catalog = await LoadCatalogAsync(def, ct).ConfigureAwait(false);
            _catalogs[linkId] = new CatalogEntry(fingerprint, catalog, DateTimeOffset.UtcNow);
            return catalog;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Drops the cached catalog of a link (it reloads on the next use).</summary>
    internal void ForgetCatalog(string linkId) => _catalogs.TryRemove(linkId, out _);

    internal async Task<LinkCatalog> LoadCatalogAsync(LinkDefinition def, CancellationToken ct)
    {
        var limits = Limits(def, "catalog");
        var tasks = def.Members.Select((m, i) => LoadMemberAsync(ResolveMember(i, m, limits, null), ct)).ToList();
        var schemas = await Task.WhenAll(tasks).ConfigureAwait(false);
        return new LinkCatalog(schemas, def.Relations);
    }

    private async Task<LinkCatalogSchema> LoadMemberAsync(MemberHandle h, CancellationToken ct)
    {
        var m = h.Member;
        if (h.Error is not null || h.Fetcher is null || h.Context is null)
            return new LinkCatalogSchema(m.Alias, m.Kind, m.ConnectionId, h.ProviderId, [], [], h.Error ?? "The member cannot be read.");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(60));
            var cat = await h.Fetcher.LoadCatalogAsync(h.Context, timeout.Token).ConfigureAwait(false);
            return new LinkCatalogSchema(m.Alias, m.Kind, m.ConnectionId, h.ProviderId, cat.Tables, cat.Warnings);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            _log.LogInformation("Linked database member {Alias} could not be read: {Message}", m.Alias, e.Message);
            var message = e is OperationCanceledException ? "The member did not answer within 60 s." : e.Message;
            return new LinkCatalogSchema(m.Alias, m.Kind, m.ConnectionId, h.ProviderId, [], [], message);
        }
    }

    internal static LinkTableCatalog TableCatalog(LinkCatalog catalog) =>
        new(catalog.Schemas.Where(s => s.Error is null).SelectMany(s => s.Tables.Select(t => (s.Alias, t))),
            catalog.Schemas.FirstOrDefault()?.Alias);

    // ------------------------------------------------------------------ validation

    public async Task<LinkValidationResult> ValidateAsync(LinkDefinition definition, string? linkId, bool probe, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(definition);
        var problems = new List<LinkProblem>();
        var statuses = new List<LinkMemberStatus>();
        if (definition.Members.Count == 0) problems.Add(new LinkProblem("error", LinkProblemCodes.Empty, "Add at least one member."));
        var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var limits = Limits(definition, "validate");
        var handles = new List<MemberHandle>();
        for (var i = 0; i < definition.Members.Count; i++)
        {
            var m = definition.Members[i];
            if (LinkRules.ReservedAliases.Contains(m.Alias) || LinkSql.Reserved.Contains(m.Alias.ToUpperInvariant()))
                problems.Add(new LinkProblem("error", LinkProblemCodes.AliasReserved, $"'{m.Alias}' is reserved; choose another alias.", i));
            else if (!LinkRules.IsValidAlias(m.Alias))
                problems.Add(new LinkProblem("error", LinkProblemCodes.AliasInvalid,
                    $"'{m.Alias}' is not a valid alias (lower-case letters, digits and _, starting with a letter or _).", i));
            if (!aliases.Add(m.Alias)) problems.Add(new LinkProblem("error", LinkProblemCodes.AliasDuplicate, $"The alias '{m.Alias}' is used twice.", i));

            var h = ResolveMember(i, m, limits, null);
            handles.Add(h);
            if (h.Error is not null)
            {
                var code = h.ProviderId == LinkIds.ProviderId ? LinkProblemCodes.MemberLinked
                    : h.ProviderId is null ? LinkProblemCodes.MemberMissing
                    : LinkProblemCodes.MemberUnsupported;
                problems.Add(new LinkProblem("error", code, h.Error, i));
            }
            if (!m.AllTables && m.Tables.Count == 0)
                problems.Add(new LinkProblem("error", LinkProblemCodes.NoTables, $"The member '{m.Alias}' mounts no table.", i));
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in m.Tables)
            {
                if (!LinkRules.IsValidTableName(t.LinkName))
                    problems.Add(new LinkProblem("error", LinkProblemCodes.TableInvalid, $"'{t.LinkName}' is not a valid table name.", i, t.LinkName));
                else if (!names.Add(t.LinkName))
                    problems.Add(new LinkProblem("error", LinkProblemCodes.TableDuplicate, $"{m.Alias}.{t.LinkName} is mounted twice.", i, t.LinkName));
            }
        }

        // Relations: both ends are mounted (when the tables are explicit) and the column lists pair up.
        for (var r = 0; r < definition.Relations.Count; r++)
        {
            var rel = definition.Relations[r];
            string? Why()
            {
                if (rel.FromColumns.Count == 0 || rel.FromColumns.Count != rel.ToColumns.Count) return "the column lists must be non-empty and of the same length";
                foreach (var end in new[] { rel.From, rel.To })
                {
                    var member = definition.FindMember(end.Alias);
                    if (member is null) return $"'{end.Alias}' is not a member";
                    if (!member.AllTables && !member.Tables.Any(t => string.Equals(t.LinkName, end.Table, StringComparison.OrdinalIgnoreCase)))
                        return $"{end} is not mounted";
                }
                return null;
            }
            if (Why() is { } why) problems.Add(new LinkProblem("error", LinkProblemCodes.RelationInvalid, $"Relation {rel.Name ?? rel.Id}: {why}.", Relation: r));
        }

        if (!probe)
        {
            statuses.AddRange(handles.Select(h => new LinkMemberStatus(h.Index, h.Member.Alias, h.ProviderId, null, null, h.Error)));
        }
        else
        {
            var loaded = await Task.WhenAll(handles.Select(h => LoadMemberAsync(h, ct))).ConfigureAwait(false);
            for (var i = 0; i < loaded.Length; i++)
            {
                var schema = loaded[i];
                var h = handles[i];
                var reachable = schema.Error is null;
                statuses.Add(new LinkMemberStatus(i, schema.Alias, h.ProviderId, h.Error is null ? reachable : null, reachable ? schema.Tables.Count : null, schema.Error));
                if (h.Error is null && !reachable)
                    problems.Add(new LinkProblem("warning", LinkProblemCodes.MemberUnreachable, $"{schema.Alias}: {schema.Error}", i));
                foreach (var w in schema.Warnings)
                    problems.Add(new LinkProblem("warning", LinkProblemCodes.TableMissing, w, i));
                if (reachable && h.Member.AllTables && schema.Tables.Count == 0)
                    problems.Add(new LinkProblem("warning", LinkProblemCodes.NoTables, $"{schema.Alias}: the schema has no tables or views.", i));
            }
            // Relation columns exist (probed only).
            var catalog = new LinkCatalog(loaded, definition.Relations);
            for (var r = 0; r < definition.Relations.Count; r++)
            {
                var rel = definition.Relations[r];
                foreach (var (end, cols) in new[] { (rel.From, rel.FromColumns), (rel.To, rel.ToColumns) })
                {
                    var table = catalog.Schemas.FirstOrDefault(s => string.Equals(s.Alias, end.Alias, StringComparison.OrdinalIgnoreCase) && s.Error is null)?
                        .Tables.FirstOrDefault(t => string.Equals(t.LinkName, end.Table, StringComparison.OrdinalIgnoreCase));
                    if (table is null) continue;
                    foreach (var c in cols.Where(c => !table.Columns.Any(tc => string.Equals(tc.Name, c, StringComparison.OrdinalIgnoreCase))))
                        problems.Add(new LinkProblem("warning", LinkProblemCodes.RelationInvalid, $"Relation {rel.Name ?? rel.Id}: {end} has no column '{c}'.", Relation: r));
                }
            }
        }
        return new LinkValidationResult(!problems.Any(p => p.Severity == "error"), problems, statuses);
    }

    // ------------------------------------------------------------------ plans

    public async Task<SqlAst> SerializeSqlAsync(string sql, CancellationToken ct)
    {
        if (_factory.Probe().Engine != "duckdb") return new SqlAst(false, false, null, "DuckDB is not available: " + _factory.Probe().Error);
        return await Task.Run(() => DuckDbProbe.SerializeSql(sql), ct).ConfigureAwait(false);
    }

    /// <summary>Analysis + accepted requests of one statement over a context's link (no I/O beyond the catalog).</summary>
    internal async Task<PlannedFetches> PlanFetchesAsync(FederationContext context, string sql, bool allColumns, long? maxRowsOverride, CancellationToken ct)
    {
        var catalog = await CatalogAsync(context.LinkId, false, ct).ConfigureAwait(false);
        var def = Definition(context.LinkId);
        var limits = maxRowsOverride is null ? context.Limits : context.Limits with { MaxRowsPerSource = Math.Max(1, maxRowsOverride.Value) };
        // EXPLAIN [ANALYZE] select ...: analysed as the inner query (push-down applies); a plain EXPLAIN reads a sample only.
        var sampled = false;
        if (ExplainSql.TrySplit(sql, out var inner, out var analyze))
        {
            sql = inner;
            if (!analyze && maxRowsOverride is null && limits.MaxRowsPerSource > ExplainSql.SampleRows)
            {
                limits = limits with { MaxRowsPerSource = ExplainSql.SampleRows };
                sampled = true;
            }
        }
        var ast = await context.Engine.SerializeSqlAsync(sql, ct).ConfigureAwait(false);
        var planned = BuildFetches(def, catalog, sql, ast, limits, allColumns, context.Id, context.EngineWarning);
        return sampled ? planned with { Sampled = true } : planned;
    }

    internal PlannedFetches BuildFetches(LinkDefinition def, LinkCatalog catalog, string sql, SqlAst ast, FederationLimits limits, bool allColumns,
        string? sessionId, string? engineWarning)
    {
        // A member that could not be read and that the statement names: say so instead of DuckDB's "table does not exist".
        var failed = catalog.Schemas.Where(s => s.Error is not null).ToList();
        if (failed.Count > 0)
        {
            var tokens = SqlTokenizer.Tokenize(sql, Dialect.DuckDb);
            for (var i = 0; i + 1 < tokens.Count; i++)
            {
                if (tokens[i].Kind is not (SqlTokenKind.Word or SqlTokenKind.QuotedIdentifier) || tokens[i + 1].Value != ".") continue;
                var name = tokens[i].Value.Trim('"');
                var bad = failed.FirstOrDefault(f => string.Equals(f.Alias, name, StringComparison.OrdinalIgnoreCase));
                if (bad is not null) throw EngineException.SourceUnavailable($"{bad.Alias}: {bad.Error}", new { alias = bad.Alias });
            }
        }

        var tableCatalog = TableCatalog(catalog);
        var analysis = QueryAnalyzer.Analyze(ast, sql, tableCatalog);
        var warnings = new List<PlanWarning>();
        if (engineWarning is not null)
            warnings.Add(new PlanWarning(PlanWarningCodes.FallbackEngine, $"The SQLite fallback engine runs this query ({engineWarning}); only the query builder's SQL is supported."));
        if (analysis.SyntaxError is not null) return new PlannedFetches(false, [], warnings, analysis.SyntaxError);
        if (!analysis.Parsed && analysis.Tables.Count > 0)
            warnings.Add(new PlanWarning(PlanWarningCodes.Fallback,
                $"The statement was not analysed ({ExplainSql.FriendlyReason(analysis.FallbackReason)}); whole tables are read without filters."));
        if (analysis.LimitWithoutOrder)
            warnings.Add(new PlanWarning(PlanWarningCodes.LimitWithoutOrder, "LIMIT without ORDER BY: which rows come back is arbitrary."));
        foreach (var j in analysis.JoinPairs)
        {
            if (!SameKindFamily(j.LeftColumn.Kind, j.RightColumn.Kind))
                warnings.Add(new PlanWarning(PlanWarningCodes.JoinKinds,
                    $"{j.Left}.{j.LeftColumn.Name} ({j.LeftColumn.SourceType}) is joined to {j.Right}.{j.RightColumn.Name} ({j.RightColumn.SourceType}): different kinds compare after a conversion.", j.Left));
            else if (j.LeftColumn.Kind == ColumnKinds.String && j.LeftColumn.Collation is { } lc && j.RightColumn.Collation is { } rc
                     && !string.Equals(lc, rc, StringComparison.OrdinalIgnoreCase))
                warnings.Add(new PlanWarning(PlanWarningCodes.JoinCollation,
                    $"{j.Left}.{j.LeftColumn.Name} ({lc}) and {j.Right}.{j.RightColumn.Name} ({rc}) have different collations; the join compares exact text.", j.Left));
        }

        var members = def.Members.Select((m, i) => (m, i)).ToDictionary(x => x.m.Alias, x => x, StringComparer.OrdinalIgnoreCase);
        var fetches = new List<PlannedFetch>();
        foreach (var t in analysis.Tables)
        {
            if (!members.TryGetValue(t.Table.Alias, out var mi)) continue;
            var h = ResolveMember(mi.i, mi.m, limits, sessionId);
            if (h.Error is not null || h.Fetcher is null || h.Context is null)
                throw EngineException.SourceUnavailable($"{t.Table.Alias}: {h.Error ?? "the member cannot be read."}", new { alias = t.Table.Alias });
            var columns = allColumns || t.AllColumns ? t.Source.Columns.Select(c => c.Name).ToList() : t.Columns.ToList();
            if (columns.Count == 0)
            {
                // A table without columns cannot be created in the engine; say so instead of DuckDB's "table does not exist".
                if (t.Source.Columns.Count == 0)
                    throw EngineException.Validation(
                        $"{t.Table} has no columns the link can read (a ClickHouse parametrised view, a table function or a source that returned no schema): it cannot be queried here.",
                        new { alias = t.Table.Alias, table = t.Table.Table });
                continue;
            }
            var maxRows = t.Limit is { } l ? Math.Min(limits.MaxRowsPerSource, l) : limits.MaxRowsPerSource;
            var proposed = new FetchRequest
            {
                Table = t.Source,
                Columns = columns,
                Predicates = t.Predicates,
                Limit = t.Limit,
                MaxRows = maxRows,
                Timeout = limits.FetchTimeout,
            };
            var accepted = h.Fetcher.Accept(h.Context, proposed);
            if (accepted.Limit is null && proposed.Limit is not null) accepted = accepted with { MaxRows = limits.MaxRowsPerSource };
            if (h.ProviderId == "cassandra" && accepted.Predicates.Count < proposed.Predicates.Count)
                warnings.Add(new PlanWarning(PlanWarningCodes.FullScan,
                    $"{t.Table}: Cassandra filters only on the whole partition key; the table is read whole and filtered here.", t.Table));
            foreach (var c in columns)
            {
                var sc = t.Source.Columns.First(x => string.Equals(x.Name, c, StringComparison.OrdinalIgnoreCase));
                TypeMap.EngineType(sc, out var widened);
                if (widened is not null) warnings.Add(new PlanWarning(PlanWarningCodes.DecimalWidened, $"{t.Table}.{widened}", t.Table));
            }
            fetches.Add(new PlannedFetch(t.Table, h.Member.ConnectionId, h.ProviderId ?? "", h.ProviderName, h.Fetcher, h.Context, accepted));
        }
        return new PlannedFetches(analysis.Parsed, fetches, warnings, null);
    }

    private static bool SameKindFamily(string a, string b)
    {
        static string Family(string k) => k switch
        {
            ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float => "number",
            ColumnKinds.Date or ColumnKinds.DateTime or ColumnKinds.DateTimeOffset => "time",
            _ => k,
        };
        return Family(a) == Family(b);
    }

    public async Task<PushdownPlan> PlanAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sql);
        var def = Definition(linkId);
        var catalog = await CatalogAsync(linkId, false, ct).ConfigureAwait(false);
        var probe = _factory.Probe();
        var engineName = def.Options.Engine is { Length: > 0 } forced ? forced.ToLowerInvariant() : probe.Engine;
        if (ExplainSql.TrySplit(sql, out var explained, out _)) sql = explained;
        var ast = engineName == "duckdb" && probe.Engine == "duckdb"
            ? await SerializeSqlAsync(sql, ct).ConfigureAwait(false)
            : new SqlAst(false, false, null, "no parser");
        var limits = Limits(def, "plan");
        var planned = BuildFetches(def, catalog, sql, ast, limits, false, null, engineName == "sqlite" ? probe.Error ?? "forced by the link" : null);
        var sources = planned.Fetches.Select(f =>
        {
            var cached = FindCachedAnywhere(linkId, f.Table, f.Request);
            return new SourceFetchPlan(f.Table, f.ConnectionId, f.ProviderId, f.Fetcher.Describe(f.Context, f.Request), f.Request.Columns, f.Request.Predicates,
                f.Request.Limit, f.Request.MaxRows, Cached: cached is not null, FetchedAt: cached?.FetchedAt);
        }).ToList();
        return new PushdownPlan(engineName, planned.Parsed, sources, planned.Warnings);
    }

    private CachedSource? FindCachedAnywhere(string linkId, LinkTableRef table, FetchRequest request) =>
        _contexts.Values.Where(c => c.LinkId == linkId && c.Limits.CacheSources)
            .Select(c => c.Cache.GetValueOrDefault(table.ToString()))
            .FirstOrDefault(c => c is not null && FederationContext.Reusable(c, request));

    // ------------------------------------------------------------------ queries

    public async Task<LinkQuery> OpenQueryAsync(string linkId, string sql, IReadOnlyList<QueryParam>? parameters, LinkQueryOptions options, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sql);
        ArgumentNullException.ThrowIfNull(options);
        var profile = LinkProfile(linkId);
        EnsureQueryOnly(profile.Name, sql);
        ParamValues.Validate(parameters);
        var def = LinkDefinition.FromProfile(profile);

        var shared = options.SessionId is { } sid ? FindContext(sid) : null;
        if (shared is not null && shared.LinkId != linkId) shared = null;
        var context = shared ?? await OpenContextAsync(linkId, def, Ids.New("q"), register: false, options.MaxRowsPerSource, ct).ConfigureAwait(false);
        try
        {
            var plan = await context.PrepareAsync(sql, false, options.MaxRowsPerSource, options.Progress, null, ct).ConfigureAwait(false);
            DbDataReader reader;
            try
            {
                reader = await context.Internals.ExecuteIsolatedReaderAsync(sql, parameters, ct).ConfigureAwait(false);
            }
            catch (Exception e) when (context.Internals.IsMissingColumnError(e))
            {
                plan = await context.PrepareAsync(sql, true, options.MaxRowsPerSource, options.Progress, null, ct).ConfigureAwait(false);
                reader = await context.Internals.ExecuteIsolatedReaderAsync(sql, parameters, ct).ConfigureAwait(false);
            }
            var columns = ResultValues.Describe(reader);
            return new LinkQuery(reader, columns, plan, shared is null ? context : null);
        }
        catch
        {
            if (shared is null) await context.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    /// <summary>403 READ_ONLY unless every statement of <paramref name="sql"/> only reads.</summary>
    internal static void EnsureQueryOnly(string linkName, string sql)
    {
        var classification = StatementClassifier.Classify(sql, Dialect.DuckDb);
        if (classification.IsQueryOnly && classification.Statements.All(s => s.Category == StatementCategory.Query)) return;
        var kind = classification.Statements.FirstOrDefault(s => s.Category != StatementCategory.Query)?.Kind ?? classification.PrimaryKind ?? "statement";
        throw new EngineException(403, ErrorCodes.ReadOnly, $"The linked database '{linkName}' is read-only: {kind} is not allowed.", new { kind });
    }

    public async Task<int> RefreshSourcesAsync(string linkId, string? sessionId, IReadOnlyList<LinkTableRef>? tables, CancellationToken ct)
    {
        LinkProfile(linkId);
        ForgetCatalog(linkId);
        var contexts = _contexts.Values.Where(c => c.LinkId == linkId && (sessionId is null || c.Id == sessionId)).ToList();
        var dropped = 0;
        foreach (var c in contexts) dropped += await c.InvalidateAsync(tables, ct).ConfigureAwait(false);
        return dropped;
    }
}
