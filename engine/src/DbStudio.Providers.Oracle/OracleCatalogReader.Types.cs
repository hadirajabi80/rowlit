using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Providers.Oracle;

// Types folder: object types (attributes and methods) and collection types (VARRAY, nested table).
public sealed partial class OracleCatalogReader
{
    /// <summary>Kind of a type from ALL_TYPES.TYPECODE and ALL_COLL_TYPES.COLL_TYPE.</summary>
    public static string TypeKindOf(string? typecode, string? collType) =>
        string.Equals(typecode, "COLLECTION", StringComparison.OrdinalIgnoreCase)
            ? string.Equals(collType, "TABLE", StringComparison.OrdinalIgnoreCase) ? TypeKinds.Nested : TypeKinds.Varray
            : TypeKinds.Object;

    /// <summary><c>VARRAY(5) OF VARCHAR2(30)</c> / <c>TABLE OF NUMBER(10)</c>.</summary>
    public static string CollectionText(string kind, int? upperBound, string elementType) =>
        kind == TypeKinds.Varray ? $"VARRAY({upperBound?.ToString(CultureInfo.InvariantCulture) ?? "?"}) OF {elementType}" : $"TABLE OF {elementType}";

    /// <summary>The TYPE BODY of an object type (empty when it has none or it is not readable): DBMS_METADATA returns the spec alone.</summary>
    private async Task<string> TypeBodyDdlAsync(string owner, string name, CancellationToken ct)
    {
        try
        {
            var ddl = await OracleDb.ScalarAsync(_conn, OracleCatalogQueries.GetDdl, ct,
                ("type", "TYPE_BODY"), ("name", name), ("owner", owner)).ConfigureAwait(false);
            var text = ddl switch { global::Oracle.ManagedDataAccess.Types.OracleClob clob => clob.Value, null => null, _ => Convert.ToString(ddl) };
            return string.IsNullOrWhiteSpace(text) ? "" : NormalizeDdl(text);
        }
        catch (global::Oracle.ManagedDataAccess.Client.OracleException)
        {
            return ""; // ORA-31608 / ORA-31603: no body
        }
    }

    private sealed record TypeSummary(string Kind, string BaseType, List<CatalogColumn> Attributes);

    /// <summary>Kind, summary and attributes of every type of <paramref name="schema"/>.</summary>
    private async Task<Dictionary<string, TypeSummary>> LoadTypesAsync(string schema, CancellationToken ct)
    {
        var owner = ("owner", (object?)schema);
        var rows = await OracleDb.QueryAsync(_conn, OracleCatalogQueries.Types, r => (
            Name: r.GetString(0), Code: OracleDb.Str(r, 1), Attributes: OracleDb.Int(r, 2) ?? 0, Methods: OracleDb.Int(r, 3) ?? 0, Coll: OracleDb.Str(r, 4),
            Upper: OracleDb.Int(r, 5), ElemOwner: OracleDb.Str(r, 6), ElemName: OracleDb.Str(r, 7), Length: OracleDb.Int(r, 8), Precision: OracleDb.Int(r, 9),
            Scale: OracleDb.Int(r, 10), CharUsed: OracleDb.Str(r, 11)), ct, owner).ConfigureAwait(false);
        var attrs = (await OracleDb.QueryAsync(_conn, OracleCatalogQueries.TypeAttributes, r => (
                Type: r.GetString(0), Column: new CatalogColumn(r.GetString(1),
                    OracleTypeText.Column(OracleDb.Str(r, 3) ?? "", OracleDb.Str(r, 2), OracleDb.Int(r, 4), OracleDb.Int(r, 4), OracleDb.Str(r, 7),
                        OracleDb.Int(r, 5), OracleDb.Int(r, 6), schema), true, false)), ct, owner).ConfigureAwait(false))
            .GroupBy(a => a.Type).ToDictionary(g => g.Key, g => g.Select(a => a.Column).ToList(), StringComparer.Ordinal);

        var map = new Dictionary<string, TypeSummary>(StringComparer.Ordinal);
        foreach (var t in rows)
        {
            var kind = TypeKindOf(t.Code, t.Coll);
            var cols = attrs.GetValueOrDefault(t.Name) ?? [];
            string text;
            if (kind == TypeKinds.Object)
                text = $"{cols.Count} attribute{(cols.Count == 1 ? "" : "s")}{(t.Methods > 0 ? $", {t.Methods} method{(t.Methods == 1 ? "" : "s")}" : "")}";
            else
                text = CollectionText(kind, t.Upper, OracleTypeText.Column(t.ElemName ?? "", t.ElemOwner, t.Length, t.Length, t.CharUsed, t.Precision, t.Scale, schema));
            map[t.Name] = new TypeSummary(kind, text, cols);
        }
        return map;
    }

    private async Task<ObjectDetails> GetTypeDetailsAsync(ObjectRef obj, string owner, DateTimeOffset? created, DateTimeOffset? modified, CancellationToken ct)
    {
        var o = ("owner", (object?)owner);
        var n = ("name", (object?)obj.Name);
        var d = (await OracleDb.QueryAsync(_conn, OracleCatalogQueries.TypeDetail, r => (
            Code: OracleDb.Str(r, 0), Final: OracleDb.Str(r, 1), Instantiable: OracleDb.Str(r, 2), SuperOwner: OracleDb.Str(r, 3), SuperName: OracleDb.Str(r, 4),
            Incomplete: OracleDb.Str(r, 5), Coll: OracleDb.Str(r, 6), Upper: OracleDb.Int(r, 7), ElemOwner: OracleDb.Str(r, 8), ElemName: OracleDb.Str(r, 9),
            Length: OracleDb.Int(r, 10), Precision: OracleDb.Int(r, 11), Scale: OracleDb.Int(r, 12), CharUsed: OracleDb.Str(r, 13)), ct, o, n).ConfigureAwait(false)).FirstOrDefault();
        if (d.Code is null) throw EngineException.NotFound($"Type {owner}.{obj.Name}");
        var kind = TypeKindOf(d.Code, d.Coll);

        var columns = new List<ColumnDetail>();
        var properties = new List<TypeProperty>();
        string? itemsTitle = null;
        var items = new List<TypeItem>();
        if (kind == TypeKinds.Object)
        {
            columns.AddRange((await OracleDb.QueryAsync(_conn, OracleCatalogQueries.TypeAttributesOf, r => new ColumnDetail(r.GetString(0),
                OracleTypeText.Column(OracleDb.Str(r, 2) ?? "", OracleDb.Str(r, 1), OracleDb.Int(r, 3), OracleDb.Int(r, 3), OracleDb.Str(r, 6),
                    OracleDb.Int(r, 4), OracleDb.Int(r, 5), owner), true, null, false, false, false, null, OracleDb.Int(r, 7) ?? 0), ct, o, n).ConfigureAwait(false)));
            var methods = await OracleDb.QueryAsync(_conn, OracleCatalogQueries.TypeMethods, r => (
                Name: r.GetString(0), Kind: OracleDb.Str(r, 1), Params: OracleDb.Int(r, 2) ?? 0, Results: OracleDb.Int(r, 3) ?? 0,
                Final: OracleDb.Str(r, 4) == "YES", Instantiable: OracleDb.Str(r, 5) == "YES", Overriding: OracleDb.Str(r, 6) == "YES"), ct, o, n).ConfigureAwait(false);
            properties.Add(new("Attributes", columns.Count.ToString(CultureInfo.InvariantCulture)));
            properties.Add(new("Methods", methods.Count.ToString(CultureInfo.InvariantCulture)));
            properties.Add(new("Final", d.Final == "YES" ? "yes" : "no"));
            properties.Add(new("Instantiable", d.Instantiable == "YES" ? "yes" : "no"));
            if (!string.IsNullOrEmpty(d.SuperName))
                properties.Add(new("Supertype", string.IsNullOrEmpty(d.SuperOwner) || d.SuperOwner == owner ? d.SuperName : $"{d.SuperOwner}.{d.SuperName}"));
            if (d.Incomplete == "YES") properties.Add(new("Incomplete", "yes"));
            if (methods.Count > 0)
            {
                itemsTitle = "Methods";
                items.AddRange(methods.Select(m => new TypeItem(m.Name,
                    // PARAMETERS counts the implicit SELF of a member method, so it is not shown.
                    $"{(m.Kind ?? "PUBLIC").ToLowerInvariant()} {(m.Results > 0 ? "function" : "procedure")}" +
                    $"{(m.Overriding ? ", overriding" : "")}{(m.Final ? ", final" : "")}{(m.Instantiable ? "" : ", not instantiable")}")));
            }
        }
        else
        {
            var elem = OracleTypeText.Column(d.ElemName ?? "", d.ElemOwner, d.Length, d.Length, d.CharUsed, d.Precision, d.Scale, owner);
            properties.Add(new("Element type", elem));
            if (kind == TypeKinds.Varray) properties.Add(new("Maximum elements", d.Upper?.ToString(CultureInfo.InvariantCulture) ?? ""));
            properties.Add(new("Definition", CollectionText(kind, d.Upper, elem)));
        }

        var usageRows = new List<TypeUsageRow>();
        foreach (var c in await OracleDb.QueryAsync(_conn, OracleDependencyQueries.TypeUsageColumns, r => new TypeUsageRow(
                     r.GetString(0), r.GetString(1), OracleDb.Str(r, 3), $"column {r.GetString(2)}"), ct, o, n).ConfigureAwait(false))
            usageRows.Add(c);
        foreach (var a in await OracleDb.QueryAsync(_conn, OracleDependencyQueries.TypeUsageArguments, r => (
                     Owner: r.GetString(0), Package: OracleDb.Str(r, 1), Object: r.GetString(2), Argument: OracleDb.Str(r, 3), Position: OracleDb.Int(r, 4) ?? 0,
                     Type: OracleDb.Str(r, 5)), ct, o, n).ConfigureAwait(false))
        {
            var unit = a.Package ?? a.Object;
            var what = a.Position == 0 && a.Argument is null ? "return value" : $"parameter {a.Argument}";
            usageRows.Add(new TypeUsageRow(a.Owner, unit, a.Type, a.Package is null ? what : $"{a.Object}: {what}"));
        }
        foreach (var t in await OracleDb.QueryAsync(_conn, OracleDependencyQueries.TypeUsageAttributes, r => new TypeUsageRow(
                     r.GetString(0), r.GetString(1), "TYPE", $"attribute {r.GetString(2)}"), ct, o, n).ConfigureAwait(false))
            usageRows.Add(t);
        foreach (var t in await OracleDb.QueryAsync(_conn, OracleDependencyQueries.TypeUsageCollections, r => new TypeUsageRow(
                     r.GetString(0), r.GetString(1), "TYPE", "element type"), ct, o, n).ConfigureAwait(false))
            usageRows.Add(t);

        var info = new TypeDetails(kind) { Properties = properties, ItemsTitle = itemsTitle, Items = items, UsedBy = MapTypeUsage(usageRows, owner) };
        return new ObjectDetails(obj with { Schema = owner }, columns, [], [], [], [], [], null, created, modified) { TypeInfo = info };
    }

    /// <summary>One user of a type; <paramref name="OracleType"/> is an ALL_OBJECTS.OBJECT_TYPE value.</summary>
    public sealed record TypeUsageRow(string Owner, string Name, string? OracleType, string Usage);

    /// <summary>Merges the usages of one object, ordered by owner and name; objects of other schemas keep their owner.</summary>
    public static List<TypeUsage> MapTypeUsage(IEnumerable<TypeUsageRow> rows, string currentOwner)
    {
        var map = new Dictionary<(string Owner, string Name, string Type), List<string>>();
        foreach (var r in rows)
        {
            var type = OracleTypeText.ObjectType(r.OracleType);
            if (type is null) continue;
            var key = (r.Owner, r.Name, type);
            if (!map.TryGetValue(key, out var list)) map[key] = list = [];
            if (!list.Contains(r.Usage)) list.Add(r.Usage);
        }
        return map.OrderBy(k => k.Key.Owner == currentOwner ? 0 : 1).ThenBy(k => k.Key.Owner, StringComparer.Ordinal).ThenBy(k => k.Key.Name, StringComparer.Ordinal)
            .Select(k => new TypeUsage(k.Key.Owner, k.Key.Name, k.Key.Type, string.Join("; ", k.Value))).ToList();
    }
}
