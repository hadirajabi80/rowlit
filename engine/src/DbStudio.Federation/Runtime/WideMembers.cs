using System.Collections.Concurrent;
using System.Text.Json;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Runtime;

/// <summary>
/// Wide members (scopes database / connection): their layout (levels, defaults, database and schema lists) and their
/// containers' tables, each loaded the first time something names it and cached for <see cref="CatalogTtl"/> (refresh and
/// "Refresh sources" drop them). The link catalog only holds a wide member's default container; statements, the builder
/// (<see cref="BrowseAsync"/>, <see cref="ResolveTablesAsync"/>) and the explorer reach the others through here.
/// </summary>
public sealed partial class LinkRuntime
{
    private sealed record CachedLoad<T>(Task<T> Task, DateTimeOffset At);

    private readonly ConcurrentDictionary<string, CachedLoad<WideLayout>> _layouts = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CachedLoad<IReadOnlyList<string>>> _schemaLists = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CachedLoad<SourceCatalog>> _containers = new(StringComparer.Ordinal);

    /// <summary>How long one wide-member read may take (the same budget as a member's catalog).</summary>
    private static readonly TimeSpan WideLoadTimeout = TimeSpan.FromSeconds(60);

    private static string MemberKey(string? linkId, LinkMember m) =>
        (linkId ?? "~") + "|" + m.Alias.ToLowerInvariant() + "|" + JsonSerializer.Serialize(m, CoreJson.Options);

    /// <summary>Drops the wide-member caches of a link.</summary>
    private void ForgetWide(string linkId)
    {
        var prefix = linkId + "|";
        foreach (var k in _layouts.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))) _layouts.TryRemove(k, out _);
        foreach (var k in _schemaLists.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))) _schemaLists.TryRemove(k, out _);
        foreach (var k in _containers.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal))) _containers.TryRemove(k, out _);
    }

    /// <summary>
    /// A cached load: one source read per key and TTL, shared by concurrent callers. The read itself is not cancelled by a
    /// caller giving up (another may be waiting for it); it has its own <see cref="WideLoadTimeout"/>.
    /// </summary>
    private static async Task<T> CachedAsync<T>(ConcurrentDictionary<string, CachedLoad<T>> map, string key, bool refresh,
        Func<CancellationToken, Task<T>> load, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        if (refresh || !map.TryGetValue(key, out var entry) || entry.Task.IsFaulted || entry.Task.IsCanceled || now - entry.At >= CatalogTtl)
        {
            var fresh = new CachedLoad<T>(Task.Run(async () =>
            {
                using var timeout = new CancellationTokenSource(WideLoadTimeout);
                return await load(timeout.Token).ConfigureAwait(false);
            }, CancellationToken.None), now);
            entry = refresh ? map[key] = fresh : map.AddOrUpdate(key, fresh, (_, old) =>
                old.Task.IsFaulted || old.Task.IsCanceled || now - old.At >= CatalogTtl ? fresh : old);
        }
        try
        {
            return await entry.Task.WaitAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw EngineException.SourceUnavailable($"The source did not answer within {WideLoadTimeout.TotalSeconds:0} s.");
        }
    }

    /// <summary>A copy of <paramref name="c"/> for <paramref name="member"/> (a schema-scoped container of a wide member).</summary>
    internal static SourceContext WithMember(SourceContext c, LinkMember member) => new()
    {
        Member = member,
        Profile = c.Profile,
        Password = c.Password,
        Provider = c.Provider,
        Source = c.Source,
        Limits = c.Limits,
        Services = c.Services,
        SessionId = c.SessionId,
    };

    /// <summary>The schema-scoped member a wide member's container is read as (overrides only for the default container).</summary>
    private static LinkMember ContainerMember(LinkMember wide, string? database, string? schema, bool isDefault) => wide with
    {
        Scope = LinkScopes.Schema,
        AllTables = true,
        Database = database,
        Schema = schema,
        Tables = isDefault ? wide.Tables : [],
    };

    /// <summary>The member a fetch of <paramref name="table"/> reads through: the table's own container for a wide member.</summary>
    internal static SourceContext FetchContext(MemberHandle h, SourceTable table) =>
        h.Member.IsWide && h.Context is { } c
            ? WithMember(c, ContainerMember(h.Member, table.Database ?? h.Member.Database, table.Schema ?? h.Member.Schema, false))
            : h.Context!;

    private static EngineException CannotSpan(MemberHandle h) =>
        EngineException.Validation($"{h.Member.Alias}: {h.ProviderName ?? h.ProviderId ?? "this source"} connections cannot be mounted as a whole database or connection; choose Whole schema or Tables.",
            new { alias = h.Member.Alias });

    /// <summary>The layout of a wide member (lists of its first level, defaults).</summary>
    internal Task<WideLayout> LayoutAsync(string? linkId, MemberHandle h, bool refresh, CancellationToken ct)
    {
        if (h.Error is not null || h.Fetcher is null || h.Context is null)
            throw EngineException.SourceUnavailable($"{h.Member.Alias}: {h.Error ?? "the member cannot be read."}", new { alias = h.Member.Alias });
        var m = h.Member;
        var levels = MemberScopes.Levels(h.ProviderId, m.EffectiveScope);
        if (levels.Count == 0)
            return Task.FromResult(new WideLayout { Alias = m.Alias, Levels = [], DefaultPath = [], FixedDatabase = m.Database, FixedSchema = m.Schema });
        if (h.Fetcher is not IScopedSourceFetcher scoped) throw CannotSpan(h);
        var context = h.Context;
        return CachedAsync(_layouts, MemberKey(linkId, m), refresh, async t =>
        {
            var hasDb = MemberScopes.HasDatabaseLevel(h.ProviderId);
            if (levels.Count == 1)
            {
                // whole database (SQL Server…: its schemas; Oracle / SQLite: every schema) or a whole MySQL-like connection
                var root = WithMember(context, m with { Schema = null, Database = hasDb ? m.Database : null });
                var (db, schema) = await scoped.DefaultsAsync(root, t).ConfigureAwait(false);
                var fixedDb = hasDb ? m.Database ?? db : null;
                var schemas = await scoped.ListSchemasAsync(root, fixedDb, t).ConfigureAwait(false);
                return new WideLayout
                {
                    Alias = m.Alias, Levels = levels, FixedDatabase = fixedDb, DefaultPath = [schema ?? ""],
                    Schemas = schema is not null && !schemas.Contains(schema, StringComparer.OrdinalIgnoreCase) ? [schema, .. schemas] : schemas,
                };
            }
            var top = WithMember(context, m with { Schema = null, Database = null });
            var (defaultDb, defaultSchema) = await scoped.DefaultsAsync(top, t).ConfigureAwait(false);
            var databases = (await scoped.ListDatabasesAsync(top, t).ConfigureAwait(false)).ToList();
            if (defaultDb is not null && !databases.Contains(defaultDb, StringComparer.OrdinalIgnoreCase)) databases.Insert(0, defaultDb);
            var defaultSchemas = defaultDb is null ? [] : await scoped.ListSchemasAsync(top, defaultDb, t).ConfigureAwait(false);
            return new WideLayout
            {
                Alias = m.Alias, Levels = levels, DefaultPath = [defaultDb ?? "", defaultSchema ?? ""], Databases = databases, Schemas = defaultSchemas,
            };
        }, ct);
    }

    /// <summary>Schemas of one database of a whole-connection member (the default database's are in the layout).</summary>
    private async Task<IReadOnlyList<string>> SchemasOfAsync(string? linkId, MemberHandle h, WideLayout layout, string database, bool refresh, CancellationToken ct)
    {
        if (layout.Levels.Count == 2 && layout.HasDefault && string.Equals(database, layout.DefaultPath[0], StringComparison.OrdinalIgnoreCase) && !refresh)
            return layout.Schemas;
        var scoped = h.Fetcher as IScopedSourceFetcher ?? throw CannotSpan(h);
        var context = WithMember(h.Context!, h.Member with { Schema = null, Database = database });
        return await CachedAsync(_schemaLists, MemberKey(linkId, h.Member) + "|" + database, refresh,
            t => scoped.ListSchemasAsync(context, database, t), ct).ConfigureAwait(false);
    }

    /// <summary>The tables of one container, named as the link names them (<see cref="WideLayout.EngineName"/>).</summary>
    internal Task<SourceCatalog> ContainerAsync(string? linkId, MemberHandle h, WideLayout layout, WideContainer container, bool refresh, CancellationToken ct)
    {
        var isDefault = layout.Default is { } d && d.Key == container.Key || layout.Levels.Count == 0;
        var member = ContainerMember(h.Member, container.Database, container.Schema, isDefault);
        var context = WithMember(h.Context!, member);
        return CachedAsync(_containers, MemberKey(linkId, h.Member) + "|" + container.Key, refresh, async t =>
        {
            var cat = await h.Fetcher!.LoadCatalogAsync(context, t).ConfigureAwait(false);
            var tables = cat.Tables.Select(x =>
            {
                var path = layout.PathOf(container, x.LinkName);
                return path.Count > 1 ? x with { LinkName = string.Join(".", path), Path = path } : x;
            }).ToList();
            return new SourceCatalog(tables, cat.Warnings);
        }, ct);
    }

    /// <summary>A wide member's table by engine name (<c>"sales.orders"</c>), loading its container; null when unknown.</summary>
    private async Task<SourceTable?> FindWideTableAsync(string? linkId, MemberHandle h, string engineName, CancellationToken ct)
    {
        var layout = await LayoutAsync(linkId, h, false, ct).ConfigureAwait(false);
        var at = layout.Locate(engineName);
        if (at is null && layout.Levels.Count == 2 && engineName.IndexOf('.') is > 0 and var dot)
        {
            // a database the layout's list did not show (permissions): try it as alias.database.schema.table
            var rest = engineName[(dot + 1)..];
            if (rest.IndexOf('.') is > 0 and var dot2) at = (layout.Container([engineName[..dot], rest[..dot2]]), rest[(dot2 + 1)..]);
        }
        if (at is not { } loc) return null;
        if (layout.Levels.Count == 2 && !string.Equals(loc.Container.Parts[0], layout.DefaultPath[0], StringComparison.OrdinalIgnoreCase))
        {
            var schemas = await SchemasOfAsync(linkId, h, layout, loc.Container.Parts[0], false, ct).ConfigureAwait(false);
            var s = schemas.FirstOrDefault(x => string.Equals(x, loc.Container.Parts[1], StringComparison.Ordinal))
                    ?? schemas.FirstOrDefault(x => string.Equals(x, loc.Container.Parts[1], StringComparison.OrdinalIgnoreCase));
            if (s is null) return null;
            loc = (layout.Container([loc.Container.Parts[0], s]), loc.Table);
        }
        var cat = await ContainerAsync(linkId, h, layout, loc.Container, false, ct).ConfigureAwait(false);
        return cat.Tables.FirstOrDefault(t => string.Equals(t.LinkName, engineName, StringComparison.Ordinal))
               ?? cat.Tables.FirstOrDefault(t => string.Equals(t.LinkName, engineName, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>The catalog schema of a wide member: its default container (plain names) plus its levels.</summary>
    private async Task<LinkCatalogSchema> LoadWideMemberAsync(string? linkId, MemberHandle h, CancellationToken ct)
    {
        var m = h.Member;
        var layout = await LayoutAsync(linkId, h, false, ct).ConfigureAwait(false);
        var warnings = new List<string>();
        IReadOnlyList<SourceTable> tables = [];
        if (layout.Levels.Count == 0 || layout.Default is not null)
        {
            var container = layout.Levels.Count == 0 ? layout.Container([]) : layout.Default!;
            var cat = await ContainerAsync(linkId, h, layout, container, false, ct).ConfigureAwait(false);
            tables = cat.Tables;
            warnings.AddRange(cat.Warnings);
        }
        return new LinkCatalogSchema(m.Alias, m.Kind, m.ConnectionId, h.ProviderId, tables, warnings, null, m.EffectiveScope, layout.Levels,
            layout.Levels.Count == 0 ? [] : layout.DefaultPath);
    }

    /// <summary>
    /// The statement with the multi-part names of wide members rewritten, and <paramref name="catalog"/> extended with every
    /// wide-member table it names.
    /// </summary>
    internal async Task<LinkSqlResolution> ResolveSqlCoreAsync(string? linkId, LinkDefinition def, LinkCatalog catalog, string sql, CancellationToken ct)
    {
        var ok = catalog.Schemas.Where(s => s.Error is null).Select(s => s.Alias).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var wide = def.Members.Select((m, i) => (m, i)).Where(x => x.m.IsWide && ok.Contains(x.m.Alias)).ToList();
        if (wide.Count == 0) return new LinkSqlResolution(sql, catalog);
        var named = LinkNames.NamedAliases(sql, wide.Select(w => w.m.Alias));
        if (named.Count == 0) return new LinkSqlResolution(sql, catalog);
        var limits = Limits(def, "catalog");
        var handles = wide.Where(w => named.Contains(w.m.Alias)).ToDictionary(w => w.m.Alias, w => ResolveMember(w.i, w.m, limits, null), StringComparer.OrdinalIgnoreCase);
        var layouts = new Dictionary<string, WideLayout>(StringComparer.OrdinalIgnoreCase);
        foreach (var (alias, h) in handles) layouts[alias] = await LayoutAsync(linkId, h, false, ct).ConfigureAwait(false);
        var rewritten = LinkNames.Rewrite(sql, layouts);
        var refs = LinkNames.EngineReferences(rewritten, handles.Keys);
        var extended = await ExtendAsync(linkId, catalog, refs, handles, ct).ConfigureAwait(false);
        return new LinkSqlResolution(rewritten, extended);
    }

    /// <summary><paramref name="catalog"/> plus the wide-member tables of <paramref name="refs"/> it does not have yet.</summary>
    private async Task<LinkCatalog> ExtendAsync(string? linkId, LinkCatalog catalog, IEnumerable<LinkTableRef> refs, IReadOnlyDictionary<string, MemberHandle> handles,
        CancellationToken ct)
    {
        var added = new Dictionary<string, List<SourceTable>>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in refs)
        {
            if (!handles.TryGetValue(r.Alias, out var h)) continue;
            var schema = catalog.Schemas.FirstOrDefault(s => string.Equals(s.Alias, r.Alias, StringComparison.OrdinalIgnoreCase));
            if (schema is null || schema.Tables.Any(t => string.Equals(t.LinkName, r.Table, StringComparison.OrdinalIgnoreCase))) continue;
            if (!r.Table.Contains('.')) continue;
            var table = await FindWideTableAsync(linkId, h, r.Table, ct).ConfigureAwait(false);
            if (table is null) continue;
            if (!added.TryGetValue(schema.Alias, out var list)) added[schema.Alias] = list = [];
            if (!list.Any(t => string.Equals(t.LinkName, table.LinkName, StringComparison.OrdinalIgnoreCase))) list.Add(table);
        }
        if (added.Count == 0) return catalog;
        return catalog with
        {
            Schemas = catalog.Schemas.Select(s => added.TryGetValue(s.Alias, out var more) ? s with { Tables = [.. s.Tables, .. more] } : s).ToList(),
        };
    }

    public async Task<LinkSqlResolution> ResolveSqlAsync(string linkId, string sql, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(sql);
        var def = Definition(linkId);
        var catalog = await CatalogAsync(linkId, false, ct).ConfigureAwait(false);
        return await ResolveSqlCoreAsync(linkId, def, catalog, sql, ct).ConfigureAwait(false);
    }

    public async Task<LinkBrowseResult> BrowseAsync(string linkId, LinkBrowseRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        var def = Definition(linkId);
        var index = def.Members.ToList().FindIndex(m => string.Equals(m.Alias, request.Alias, StringComparison.OrdinalIgnoreCase));
        if (index < 0) throw EngineException.NotFound($"Member '{request.Alias}'");
        var member = def.Members[index];
        var path = (request.Path ?? []).ToList();
        if (!member.IsWide)
        {
            if (path.Count > 0) throw EngineException.Validation($"{member.Alias} mounts one schema: browse it with an empty path.", new { field = "path" });
            var catalog = await CatalogAsync(linkId, request.Refresh, ct).ConfigureAwait(false);
            var s = catalog.Schemas.First(x => string.Equals(x.Alias, member.Alias, StringComparison.OrdinalIgnoreCase));
            if (s.Error is not null) throw EngineException.SourceUnavailable($"{s.Alias}: {s.Error}", new { alias = s.Alias });
            return new LinkBrowseResult(member.Alias, [], null, [], s.Tables, s.Warnings);
        }
        var h = ResolveMember(index, member, Limits(def, "catalog"), null);
        var layout = await LayoutAsync(linkId, h, request.Refresh, ct).ConfigureAwait(false);
        if (path.Count > layout.Levels.Count)
            throw EngineException.Validation($"{member.Alias} has {layout.Levels.Count} level(s) above its tables: the path is too long.", new { field = "path" });
        if (path.Count < layout.Levels.Count)
        {
            var level = layout.Levels[path.Count];
            IReadOnlyList<string> names;
            if (level == MemberScopes.DatabaseLevel) names = layout.Databases;
            else if (layout.Levels.Count == 2) names = await SchemasOfAsync(linkId, h, layout, path[0], request.Refresh, ct).ConfigureAwait(false);
            else names = layout.Schemas;
            var onDefault = path.Count == 0 || (layout.DefaultPath.Count > 0 && string.Equals(path[0], layout.DefaultPath[0], StringComparison.OrdinalIgnoreCase));
            var children = names.Select(n => new LinkBrowseNode(n,
                onDefault && path.Count < layout.DefaultPath.Count && string.Equals(n, layout.DefaultPath[path.Count], StringComparison.OrdinalIgnoreCase))).ToList();
            return new LinkBrowseResult(member.Alias, path, level, children, [], []);
        }
        var cat = await ContainerAsync(linkId, h, layout, layout.Container(path), request.Refresh, ct).ConfigureAwait(false);
        return new LinkBrowseResult(member.Alias, path, null, [], cat.Tables, cat.Warnings);
    }

    public async Task<LinkResolveResult> ResolveTablesAsync(string linkId, IReadOnlyList<LinkTableRef> tables, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(tables);
        var def = Definition(linkId);
        var catalog = await CatalogAsync(linkId, false, ct).ConfigureAwait(false);
        var limits = Limits(def, "catalog");
        var found = new List<LinkResolvedTable>();
        var missing = new List<LinkTableRef>();
        foreach (var r in tables)
        {
            var index = def.Members.ToList().FindIndex(m => string.Equals(m.Alias, r.Alias, StringComparison.OrdinalIgnoreCase));
            var schema = catalog.Schemas.FirstOrDefault(s => string.Equals(s.Alias, r.Alias, StringComparison.OrdinalIgnoreCase));
            var table = schema?.Tables.FirstOrDefault(t => string.Equals(t.LinkName, r.Table, StringComparison.Ordinal))
                        ?? schema?.Tables.FirstOrDefault(t => string.Equals(t.LinkName, r.Table, StringComparison.OrdinalIgnoreCase));
            if (table is null && index >= 0 && schema is { Error: null } && def.Members[index].IsWide)
                table = await FindWideTableAsync(linkId, ResolveMember(index, def.Members[index], limits, null), r.Table, ct).ConfigureAwait(false);
            if (table is null) missing.Add(r);
            else found.Add(new LinkResolvedTable(schema!.Alias, table));
        }
        return new LinkResolveResult(found, missing);
    }
}
