using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using Npgsql;

namespace DbStudio.Providers.PostgreSql;

// Types folder (enums, domains, composite and range types): kind, overview and "Used by" of the object tab.
public sealed partial class PgCatalogReader
{
    /// <summary><c>pg_type.typtype</c> → <see cref="TypeKinds"/>.</summary>
    public static string TypeKind(string typtype) => typtype switch
    {
        "e" => TypeKinds.Enum,
        "d" => TypeKinds.Domain,
        "r" => TypeKinds.Range,
        _ => TypeKinds.Composite,
    };

    private async Task<ObjectDetails> GetTypeDetailsAsync(NpgsqlConnection conn, ObjectRef obj, string schema, CancellationToken ct)
    {
        var found = (await PgDb.QueryAsync(conn, PgCatalogQueries.FindType, r => (Oid: PgDb.Oid(r, 0), Kind: r.GetString(1)), ct, schema, obj.Name).ConfigureAwait(false)).FirstOrDefault();
        if (found.Oid == 0) throw EngineException.NotFound($"Type {schema}.{obj.Name}");
        var d = (await PgDb.QueryAsync(conn, PgCatalogQueries.TypeDetail, r => (
            Comment: PgDb.Str(r, 2), Labels: PgDb.Strings(r, 3), Base: PgDb.Str(r, 4), NotNull: PgDb.Bool(r, 5), Default: PgDb.Str(r, 6),
            Rel: PgDb.Oid(r, 7), Subtype: PgDb.Str(r, 8)), ct, found.Oid).ConfigureAwait(false)).First();

        var columns = new List<ColumnDetail>();
        var properties = new List<TypeProperty>();
        string? itemsTitle = null;
        var items = new List<TypeItem>();
        var kind = TypeKind(found.Kind);
        switch (kind)
        {
            case TypeKinds.Enum:
                columns.AddRange(d.Labels.Select((l, i) => new ColumnDetail(l, "enum label", false, null, false, false, false, null, i + 1)));
                properties.Add(new("Labels", d.Labels.Length.ToString(CultureInfo.InvariantCulture)));
                break;
            case TypeKinds.Domain:
                properties.Add(new("Base type", PgTypes.ShortTypeName(d.Base ?? "")));
                properties.Add(new("Nullable", d.NotNull ? "no" : "yes"));
                properties.Add(new("Default", d.Default ?? "none"));
                items.AddRange((await PgDb.QueryAsync(conn, PgCatalogQueries.DomainConstraints, r => new TypeItem(r.GetString(0), r.GetString(1)), ct, found.Oid).ConfigureAwait(false)));
                if (items.Count > 0) itemsTitle = "Constraints";
                break;
            case TypeKinds.Range:
                properties.Add(new("Subtype", PgTypes.ShortTypeName(d.Subtype ?? "")));
                break;
            default:
                if (d.Rel != 0)
                    columns.AddRange((await PgDb.QueryAsync(conn, PgCatalogQueries.CompositeAttributes, r => (Name: r.GetString(0), Type: PgTypes.ShortTypeName(r.GetString(1))), ct, d.Rel).ConfigureAwait(false))
                        .Select((c, i) => new ColumnDetail(c.Name, c.Type, true, null, false, false, false, null, i + 1)));
                properties.Add(new("Attributes", columns.Count.ToString(CultureInfo.InvariantCulture)));
                break;
        }
        if (!string.IsNullOrWhiteSpace(d.Comment)) properties.Add(new("Comment", d.Comment));

        var usageRows = new List<TypeUsageRow>();
        foreach (var c in await PgDb.QueryAsync(conn, PgDependencyQueries.TypeUsedBy, r => new TypeUsageRow(PgDb.Char(r, 0), r.GetString(1), r.GetString(2), $"column {r.GetString(3)}"), ct, found.Oid).ConfigureAwait(false))
            usageRows.Add(c);
        foreach (var f in await PgDb.QueryAsync(conn, PgDependencyQueries.TypeUsedByRoutines, PgDependencyReader.ReadTypeRoutine, ct, found.Oid).ConfigureAwait(false))
            usageRows.Add(new TypeUsageRow(f.RetSet ? "T" : f.Kind == "p" ? "P" : "F", f.Schema, f.Name, f.IsResult ? "return type" : "parameter"));

        var info = new TypeDetails(kind) { Properties = properties, ItemsTitle = itemsTitle, Items = items, UsedBy = MapTypeUsage(usageRows) };
        return new ObjectDetails(obj with { Schema = schema }, columns, [], [], [], [], [], null, null, null) { TypeInfo = info };
    }

    /// <summary>One user of a type. <paramref name="Kind"/> is a pg_class.relkind, or P / F / T for a procedure, function or set-returning function.</summary>
    public sealed record TypeUsageRow(string Kind, string Schema, string Name, string Usage);

    private static string UsageObjectType(string kind) => kind switch
    {
        "P" => ObjectTypes.Proc,
        "F" => ObjectTypes.Func,
        "T" => ObjectTypes.TableFunc,
        _ => PgDependencyReader.RelationType(kind),
    };

    /// <summary>Merges the usages of one object ("column a; column b"), ordered by schema and name.</summary>
    public static List<TypeUsage> MapTypeUsage(IEnumerable<TypeUsageRow> rows)
    {
        var map = new Dictionary<(string Schema, string Name, string Type), List<string>>();
        foreach (var r in rows)
        {
            var key = (r.Schema, r.Name, UsageObjectType(r.Kind));
            if (!map.TryGetValue(key, out var list)) map[key] = list = [];
            if (!list.Contains(r.Usage)) list.Add(r.Usage);
        }
        return map.OrderBy(k => k.Key.Schema, StringComparer.OrdinalIgnoreCase).ThenBy(k => k.Key.Name, StringComparer.OrdinalIgnoreCase)
            .Select(k => new TypeUsage(k.Key.Schema, k.Key.Name, k.Key.Type, string.Join("; ", k.Value))).ToList();
    }
}
