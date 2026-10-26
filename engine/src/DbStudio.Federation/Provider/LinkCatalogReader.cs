using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Pushdown;
using DbStudio.Federation.Runtime;

namespace DbStudio.Federation.Provider;

/// <summary>
/// The catalog of a link as a SQL catalog (plan-links 2): no database level; schemas = member aliases (default: the
/// first); objects = mounted tables (views stay views) named as the link names them, with their columns typed as the
/// engine stores them (TypeText = DuckDB type, the source type in the column comment), primary keys, same-source
/// foreign keys (renamed to link names) and the link's virtual relations as foreign keys. Reads
/// <see cref="ILinkRuntime.CatalogAsync"/> (cached), so the explorer, Ctrl+P, the Objects tab and IntelliSense see
/// the link like any database. Also the object list and dependency readers of the Objects tab.
/// </summary>
internal sealed class LinkCatalogReader(LinkRuntime runtime, string linkId) : ICatalogReader, IObjectListReader, IDependencyReader
{
    private LinkCatalog? _catalog;

    private async Task<LinkCatalog> CatalogAsync(CancellationToken ct) => _catalog ??= await runtime.CatalogAsync(linkId, false, ct).ConfigureAwait(false);

    public Task<IReadOnlyList<string>> ListDatabasesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);

    public Task<string?> GetCurrentDatabaseAsync(CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task<IReadOnlyList<SchemaInfo>> ListSchemasAsync(string? database, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        return catalog.Schemas.Select(s => new SchemaInfo(s.Alias, s.Tables.Count)).ToList();
    }

    public async Task<string> GetDefaultSchemaAsync(string? database, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        return catalog.Schemas.FirstOrDefault()?.Alias ?? DialectInfo.DefaultSchemaFallback(Dialect.DuckDb);
    }

    private async Task<LinkCatalogSchema> SchemaAsync(string schema, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        var s = catalog.Schemas.FirstOrDefault(x => string.Equals(x.Alias, schema, StringComparison.OrdinalIgnoreCase))
                ?? throw EngineException.NotFound($"Schema '{schema}' of the linked database");
        if (s.Error is not null) throw EngineException.SourceUnavailable($"{s.Alias}: {s.Error}", new { alias = s.Alias });
        return s;
    }

    public async Task<SchemaCatalog> LoadSchemaAsync(string? database, string schema, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        var s = await SchemaAsync(schema, ct).ConfigureAwait(false);
        var objects = s.Tables.Select(t => ToObject(catalog, s, t)).ToList();
        var referencing = catalog.Relations.Where(r => string.Equals(r.To.Alias, s.Alias, StringComparison.OrdinalIgnoreCase)
                                                       && !string.Equals(r.From.Alias, s.Alias, StringComparison.OrdinalIgnoreCase))
            .Select(r => r.From.Alias).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return new SchemaCatalog(null, s.Alias, objects) { ReferencingSchemas = referencing };
    }

    internal static CatalogObject ToObject(LinkCatalog catalog, LinkCatalogSchema schema, SourceTable t)
    {
        var columns = t.Columns.Select(c => new CatalogColumn(c.Name, TypeMap.EngineType(c, out _), c.Nullable,
            c.IsPk || t.PrimaryKey.Contains(c.Name, StringComparer.OrdinalIgnoreCase), Comment: c.SourceType)).ToList();
        return new CatalogObject
        {
            Type = t.Type is ObjectTypes.View or ObjectTypes.MView ? t.Type : ObjectTypes.Table,
            Name = t.LinkName,
            Schema = schema.Alias,
            Comment = Describe(schema, t),
            Columns = columns,
            PrimaryKey = t.PrimaryKey.ToList(),
            ForeignKeys = ForeignKeys(catalog, schema, t),
        };
    }

    private static string Describe(LinkCatalogSchema schema, SourceTable t)
    {
        var where = string.Join(".", new[] { t.Database, t.Schema, t.Name }.Where(p => !string.IsNullOrEmpty(p)));
        var source = $"{schema.ProviderId ?? schema.Kind}: {where}";
        return string.IsNullOrWhiteSpace(t.Comment) ? source : $"{t.Comment} ({source})";
    }

    /// <summary>Same-source foreign keys (renamed to link names) plus the virtual relations whose many side is this table.</summary>
    internal static List<ForeignKeyRef> ForeignKeys(LinkCatalog catalog, LinkCatalogSchema schema, SourceTable t)
    {
        var list = new List<ForeignKeyRef>();
        foreach (var fk in t.ForeignKeys)
        {
            var target = schema.Tables.FirstOrDefault(x => string.Equals(x.Name, fk.RefTable, StringComparison.OrdinalIgnoreCase));
            if (target is null) continue;
            list.Add(new ForeignKeyRef(fk.Name, fk.Columns, schema.Alias, target.LinkName, fk.RefColumns, fk.IsDisabled, fk.IsNotTrusted));
        }
        foreach (var r in catalog.Relations)
        {
            if (!string.Equals(r.From.Alias, schema.Alias, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(r.From.Table, t.LinkName, StringComparison.OrdinalIgnoreCase)) continue;
            list.Add(new ForeignKeyRef(string.IsNullOrWhiteSpace(r.Name) ? "vr_" + r.Id : r.Name!, r.FromColumns, r.To.Alias, r.To.Table, r.ToColumns));
        }
        return list;
    }

    private async Task<(LinkCatalog Catalog, LinkCatalogSchema Schema, SourceTable Table)> FindAsync(ObjectRef obj, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        var schema = await SchemaAsync(obj.Schema ?? catalog.Schemas.FirstOrDefault()?.Alias ?? "", ct).ConfigureAwait(false);
        var table = schema.Tables.FirstOrDefault(t => string.Equals(t.LinkName, obj.Name, StringComparison.OrdinalIgnoreCase))
                    ?? throw EngineException.NotFound($"Table '{schema.Alias}.{obj.Name}'");
        return (catalog, schema, table);
    }

    public async Task<ObjectDetails> GetObjectDetailsAsync(ObjectRef obj, CancellationToken ct)
    {
        var (catalog, schema, t) = await FindAsync(obj, ct).ConfigureAwait(false);
        var columns = t.Columns.Select((c, i) => new ColumnDetail(c.Name, TypeMap.EngineType(c, out _), c.Nullable, null,
            c.IsPk || t.PrimaryKey.Contains(c.Name, StringComparer.OrdinalIgnoreCase), false, false, c.SourceType, i + 1)).ToList();
        var referencedBy = new List<ReferencedBy>();
        foreach (var s in catalog.Schemas.Where(s => s.Error is null))
        {
            foreach (var other in s.Tables)
            {
                foreach (var fk in ForeignKeys(catalog, s, other))
                {
                    if (string.Equals(fk.RefSchema, schema.Alias, StringComparison.OrdinalIgnoreCase)
                        && string.Equals(fk.RefTable, t.LinkName, StringComparison.OrdinalIgnoreCase))
                        referencedBy.Add(new ReferencedBy(s.Alias, other.LinkName, fk.Name, fk.Columns));
                }
            }
        }
        var indexes = t.PrimaryKey.Count > 0 ? new List<IndexDetail> { new("PRIMARY KEY", true, t.PrimaryKey, null, true) } : [];
        return new ObjectDetails(new ObjectRef(null, schema.Alias, t.LinkName, obj.Type), columns, indexes, ForeignKeys(catalog, schema, t), referencedBy,
            [], [], t.RowEstimate, null, null);
    }

    public async Task<DdlResult> GetDdlAsync(ObjectRef obj, CancellationToken ct)
    {
        var details = await GetObjectDetailsAsync(obj, ct).ConfigureAwait(false);
        var (_, schema, t) = await FindAsync(obj, ct).ConfigureAwait(false);
        return new DdlResult($"-- {schema.Alias}.{t.LinkName} = {Describe(schema, t)}\n" + LinkDdlGenerator.Instance.GenerateTableDdl(details.Ref, details), "generated");
    }

    public Task<IReadOnlyList<ObjectError>> GetCompileErrorsAsync(ObjectRef obj, CancellationToken ct) => Task.FromResult<IReadOnlyList<ObjectError>>([]);

    public Task<CatalogObject?> ResolvePublicSynonymAsync(string name, CancellationToken ct) => Task.FromResult<CatalogObject?>(null);

    // ---- Objects tab

    public async Task<IReadOnlyList<ObjectListItem>> ListAsync(string? database, string? schema, string? type, CancellationToken ct)
    {
        var catalog = await CatalogAsync(ct).ConfigureAwait(false);
        var items = new List<ObjectListItem>();
        foreach (var s in catalog.Schemas.Where(s => s.Error is null && (schema is null || string.Equals(s.Alias, schema, StringComparison.OrdinalIgnoreCase))))
        {
            foreach (var t in s.Tables)
            {
                var objType = t.Type is ObjectTypes.View or ObjectTypes.MView ? t.Type : ObjectTypes.Table;
                if (type is not null && !string.Equals(type, objType, StringComparison.OrdinalIgnoreCase)) continue;
                items.Add(new ObjectListItem(objType, s.Alias, t.LinkName, t.RowEstimate, null, null, null, Describe(s, t)));
            }
        }
        return items;
    }

    public async Task<DependencyGraph> GetDependenciesAsync(ObjectRef obj, CancellationToken ct)
    {
        var details = await GetObjectDetailsAsync(obj, ct).ConfigureAwait(false);
        var uses = details.ForeignKeys.Select(fk => new ObjectDependency(DependencyKinds.Fk, new ObjectRef(null, fk.RefSchema, fk.RefTable, ObjectTypes.Table),
            $"{fk.Name}: {string.Join(", ", fk.Columns)} → {string.Join(", ", fk.RefColumns)}", null));
        var usedBy = details.ReferencedBy.Select(r => new ObjectDependency(DependencyKinds.Fk, new ObjectRef(null, r.Schema, r.Table, ObjectTypes.Table),
            $"{r.Constraint}: {string.Join(", ", r.Columns)}", null));
        return DependencyGraphs.Build(details.Ref, uses, usedBy);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>CREATE TABLE text of a mounted table as the engine holds it (DuckDB types).</summary>
internal sealed class LinkDdlGenerator : IDdlGenerator
{
    public static readonly LinkDdlGenerator Instance = new();

    public string GenerateTableDdl(ObjectRef table, ObjectDetails details)
    {
        var sb = new StringBuilder();
        sb.Append("CREATE TABLE ").Append(LinkSql.Qualified(table.Schema ?? "main", table.Name)).Append(" (\n");
        var lines = details.Columns.Select(c => $"    {LinkSql.QuoteIdent(c.Name)} {c.Type}{(c.Nullable ? "" : " NOT NULL")}").ToList();
        var pk = details.Columns.Where(c => c.IsPk).Select(c => LinkSql.QuoteIdent(c.Name)).ToList();
        if (pk.Count > 0) lines.Add($"    PRIMARY KEY ({string.Join(", ", pk)})");
        sb.Append(string.Join(",\n", lines)).Append("\n);");
        return sb.ToString();
    }
}
