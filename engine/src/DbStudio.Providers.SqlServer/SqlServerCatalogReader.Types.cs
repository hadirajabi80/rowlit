using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Providers.SqlServer.TSql;

namespace DbStudio.Providers.SqlServer;

// User-defined types (SSMS: Programmability › Types): alias types, table types, CLR types and XML schema collections,
// plus the built-in "System Data Types". Kept in its own file so the schema loader stays small.
public sealed partial class SqlServerCatalogReader
{
    /// <summary>One user-defined type or XML schema collection looked up by name.</summary>
    private sealed record FoundType(
        string Kind, int Id, string BaseTypeText, bool Nullable, int? TableObjectId, string? Collation, int MaxLength, int Precision, int Scale,
        string? DefaultName, string? RuleName, DateTime? Created = null, DateTime? Modified = null);

    /// <summary>Alias base type text: <c>nvarchar(20)</c>; a missing base (should not happen for alias types) reads as sql_variant.</summary>
    public static string AliasBaseText(string? baseName, int maxLength, int precision, int scale) =>
        baseName is null ? "sql_variant" : SqlServerNames.TypeText(baseName, maxLength, precision, scale);

    private async Task<FoundType?> FindTypeAsync(string schema, string name, CancellationToken ct)
    {
        var hasTableTypes = !IsSqlServer2005OrOlder(_conn.ServerVersion);
        var rows = await SqlDb.QueryAsync(_conn, hasTableTypes ? SqlServerCatalogQueries.UserTypeByName : SqlServerCatalogQueries.UserTypeByName2005, r =>
        {
            var isTable = SqlDb.Bool(r, 6);
            var isClr = SqlDb.Bool(r, 8);
            var kind = isTable ? TypeKinds.Table : isClr ? TypeKinds.Clr : TypeKinds.Alias;
            return new FoundType(kind, r.GetInt32(0), AliasBaseText(SqlDb.Str(r, 1), r.GetInt16(2), r.GetByte(3), r.GetByte(4)), SqlDb.Bool(r, 5),
                r.IsDBNull(7) ? null : r.GetInt32(7), SqlDb.Str(r, 9), r.GetInt16(2), r.GetByte(3), r.GetByte(4), SqlDb.Str(r, 10), SqlDb.Str(r, 11));
        }, ct, ("@schema", schema), ("@name", name)).ConfigureAwait(false);
        if (rows.Count > 0) return rows[0];

        var xml = await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.XmlSchemaCollectionByName,
            r => new FoundType(TypeKinds.XmlSchema, r.GetInt32(0), "xml", true, null, null, -1, 0, 0, null, null,
                r.IsDBNull(1) ? null : r.GetDateTime(1), r.IsDBNull(2) ? null : r.GetDateTime(2)), ct, ("@schema", schema), ("@name", name)).ConfigureAwait(false);
        return xml.FirstOrDefault();
    }

    private static string Yes(bool v) => v ? "yes" : "no";

    private static string LengthText(int maxLength) => maxLength == -1 ? "max" : maxLength.ToString(CultureInfo.InvariantCulture);

    private async Task<ObjectDetails> GetTypeDetailsAsync(ObjectRef obj, CancellationToken ct)
    {
        var schema = obj.Schema!;
        var t = await FindTypeAsync(schema, obj.Name, ct).ConfigureAwait(false) ?? throw EngineException.NotFound($"Type {schema}.{obj.Name}");
        var usedBy = await ReadTypeUsageAsync(t, ct).ConfigureAwait(false);
        var columns = new List<ColumnDetail>();
        var indexes = new List<IndexDetail>();
        var properties = new List<TypeProperty>();
        string? itemsTitle = null;
        var items = new List<TypeItem>();

        switch (t.Kind)
        {
            case TypeKinds.Alias:
                properties.Add(new("Base type", t.BaseTypeText));
                properties.Add(new("Nullable", Yes(t.Nullable)));
                properties.Add(new("Max length (bytes)", LengthText(t.MaxLength)));
                properties.Add(new("Precision", t.Precision.ToString(CultureInfo.InvariantCulture)));
                properties.Add(new("Scale", t.Scale.ToString(CultureInfo.InvariantCulture)));
                if (!string.IsNullOrEmpty(t.Collation)) properties.Add(new("Collation", t.Collation));
                properties.Add(new("Bound default", t.DefaultName ?? "none"));
                properties.Add(new("Bound rule", t.RuleName ?? "none"));
                break;
            case TypeKinds.Table when t.TableObjectId is int ttId:
            {
                var cols = await ReadDetailColumnsAsync(ttId, ct).ConfigureAwait(false);
                var ix = await ReadIndexesAsync(ttId, ct).ConfigureAwait(false);
                var pk = ix.FirstOrDefault(i => i.IsPrimaryKey)?.KeyColumns.Select(k => k.Name).ToHashSet(StringComparer.OrdinalIgnoreCase)
                         ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                columns.AddRange(cols.Select(c => c.Detail with { IsPk = pk.Contains(c.Detail.Name) }));
                indexes.AddRange(ix.Select(i => new IndexDetail(i.Name, i.IsUnique, i.KeyColumns.Select(k => k.Name).ToList(), i.TypeDesc, i.IsPrimaryKey)));
                var checks = await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.DetailCheckConstraints,
                    r => new TypeItem(r.GetString(0), r.GetString(1)), ct, ("@id", ttId)).ConfigureAwait(false);
                properties.Add(new("Columns", columns.Count.ToString(CultureInfo.InvariantCulture)));
                properties.Add(new("Primary key", pk.Count > 0 ? string.Join(", ", pk) : "none"));
                properties.Add(new("Indexes", ix.Count.ToString(CultureInfo.InvariantCulture)));
                properties.Add(new("Used as", "table-valued parameter (READONLY)"));
                if (checks.Count > 0)
                {
                    itemsTitle = "Check constraints";
                    items.AddRange(checks);
                }
                break;
            }
            case TypeKinds.Clr:
            {
                var clr = (await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.ClrTypeByName, r => (
                    Assembly: r.GetString(0), Class: SqlDb.Str(r, 1) ?? "", Ordered: SqlDb.Bool(r, 2), Fixed: SqlDb.Bool(r, 3)), ct,
                    ("@schema", schema), ("@name", obj.Name)).ConfigureAwait(false)).FirstOrDefault();
                properties.Add(new("Assembly", clr.Assembly ?? ""));
                properties.Add(new("Class", clr.Class ?? ""));
                properties.Add(new("Binary ordered", Yes(clr.Ordered)));
                properties.Add(new("Fixed length", Yes(clr.Fixed)));
                properties.Add(new("Max length (bytes)", LengthText(t.MaxLength)));
                properties.Add(new("Nullable", Yes(t.Nullable)));
                break;
            }
            case TypeKinds.XmlSchema:
            {
                var docs = await ReadXmlSchemasAsync(t.Id, ct).ConfigureAwait(false);
                properties.Add(new("Target namespaces", docs.Count.ToString(CultureInfo.InvariantCulture)));
                if (t.Created is DateTime c) properties.Add(new("Created", c.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)));
                if (t.Modified is DateTime m) properties.Add(new("Modified", m.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)));
                itemsTitle = "Target namespaces";
                items.AddRange(docs.Select(d => new TypeItem(d.Namespace.Length == 0 ? "(no namespace)" : d.Namespace,
                    $"{d.Definition.Length.ToString("N0", CultureInfo.InvariantCulture)} characters")));
                break;
            }
        }

        var info = new TypeDetails(t.Kind) { Properties = properties, ItemsTitle = itemsTitle, Items = items, UsedBy = usedBy };
        return new ObjectDetails(obj, columns, indexes, [], [], [], [], null, null, null) { TypeInfo = info };
    }

    private async Task<string> GetTypeDdlAsync(string schema, string name, string full, CancellationToken ct)
    {
        var t = await FindTypeAsync(schema, name, ct).ConfigureAwait(false) ?? throw EngineException.NotFound($"Type {schema}.{name}");
        switch (t.Kind)
        {
            case TypeKinds.Table when t.TableObjectId is int ttId:
            {
                var cols = await ReadDetailColumnsAsync(ttId, ct).ConfigureAwait(false);
                var ix = await ReadIndexesAsync(ttId, ct).ConfigureAwait(false);
                var checks = await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.DetailCheckConstraints,
                    r => new SqlServerCheckDefinition(r.GetString(0), r.GetString(1)), ct, ("@id", ttId)).ConfigureAwait(false);
                return TSqlTypeDdl.TableType(full, cols.Select(c => c.Def).ToList(), ix, checks);
            }
            case TypeKinds.Clr:
            {
                var clr = (await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.ClrTypeByName, r => (Assembly: r.GetString(0), Class: SqlDb.Str(r, 1) ?? ""), ct,
                    ("@schema", schema), ("@name", name)).ConfigureAwait(false)).FirstOrDefault();
                return TSqlTypeDdl.ClrType(full, clr.Assembly ?? "", clr.Class ?? "");
            }
            case TypeKinds.XmlSchema:
            {
                var docs = await ReadXmlSchemasAsync(t.Id, ct).ConfigureAwait(false);
                return TSqlTypeDdl.XmlSchemaCollection(full, docs.Select(d => d.Definition));
            }
            default:
                return TSqlTypeDdl.AliasType(full, t.BaseTypeText, t.Nullable);
        }
    }

    private async Task<List<(string Namespace, string Definition)>> ReadXmlSchemasAsync(int collectionId, CancellationToken ct) =>
        await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.XmlSchemaNamespaces,
            r => (Namespace: SqlDb.Str(r, 0) ?? "", Definition: SqlDb.Str(r, 1) ?? ""), ct, ("@xid", collectionId)).ConfigureAwait(false);

    // ---------------------------------------------------------------- usage

    /// <summary>A row of <see cref="SqlServerCatalogQueries.TypeUsage"/>.</summary>
    public sealed record TypeUsageRow(string Schema, string Name, string ObjectType, string? OwnerSchema, string? OwnerName, string? Member, int? ParameterId);

    public static TypeUsageRow ReadTypeUsageRow(System.Data.IDataRecord r) => new(
        r.GetString(0), r.GetString(1), r.GetString(2).Trim(), SqlDb.Str(r, 3), SqlDb.Str(r, 4), SqlDb.Str(r, 5),
        r.IsDBNull(6) ? null : Convert.ToInt32(r.GetValue(6), CultureInfo.InvariantCulture));

    /// <summary>
    /// Groups usage rows by the object that uses the type: "column Phone", "parameter @p", "return value" and "referenced in body"
    /// are merged per object. The internal table-type object (TT) of a column holder is reported as the table type itself.
    /// </summary>
    public static List<TypeUsage> MapTypeUsage(IEnumerable<TypeUsageRow> rows)
    {
        var order = new List<(string? Schema, string Name, string Type)>();
        var usages = new Dictionary<(string?, string, string), List<string>>();
        foreach (var row in rows)
        {
            string? schema = row.Schema, name = row.Name;
            string? type;
            if (row.ObjectType == "TT")
            {
                if (row.OwnerName is null) continue;
                schema = row.OwnerSchema;
                name = row.OwnerName;
                type = ObjectTypes.Type;
            }
            else type = MapType(row.ObjectType);
            if (type is null) continue;
            var text = row.ParameterId switch
            {
                0 => "return value",
                > 0 => $"parameter {row.Member}",
                _ => row.Member is null ? "referenced in body" : $"column {row.Member}",
            };
            var key = (schema, name, type);
            if (!usages.TryGetValue(key, out var list))
            {
                usages[key] = list = [];
                order.Add((schema, name, type));
            }
            if (!list.Contains(text)) list.Add(text);
        }
        // "referenced in body" only adds information when nothing more specific was found for the object.
        return order.OrderBy(o => o.Schema, StringComparer.OrdinalIgnoreCase).ThenBy(o => o.Name, StringComparer.OrdinalIgnoreCase)
            .Select(o =>
            {
                var list = usages[(o.Schema, o.Name, o.Type)];
                if (list.Count > 1) list.Remove("referenced in body");
                return new TypeUsage(o.Schema, o.Name, o.Type, string.Join("; ", list));
            }).ToList();
    }

    private async Task<List<TypeUsage>> ReadTypeUsageAsync(FoundType t, CancellationToken ct)
    {
        List<TypeUsageRow> rows;
        if (t.Kind == TypeKinds.XmlSchema)
            rows = await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.XmlSchemaUsage, ReadTypeUsageRow, ct, ("@xid", t.Id)).ConfigureAwait(false);
        else
            rows = await SqlDb.QueryAsync(_conn, IsSqlServer2005OrOlder(_conn.ServerVersion) ? SqlServerCatalogQueries.TypeUsage2005 : SqlServerCatalogQueries.TypeUsage,
                ReadTypeUsageRow, ct, ("@tid", t.Id)).ConfigureAwait(false);
        return MapTypeUsage(rows);
    }

    // ---------------------------------------------------------------- system data types

    public async Task<IReadOnlyList<SystemTypeInfo>> ListSystemTypesAsync(string? database, CancellationToken ct)
    {
        await UseAsync(database, ct).ConfigureAwait(false);
        return await SqlDb.QueryAsync(_conn, SqlServerCatalogQueries.SystemTypes, r => new SystemTypeInfo(
            r.GetString(0), SystemTypeCategory(r.GetString(0)), r.GetInt16(1), r.GetByte(2), r.GetByte(3), SqlDb.Str(r, 4), SqlDb.Bool(r, 5)), ct).ConfigureAwait(false);
    }

    /// <summary>SSMS groups of the built-in types.</summary>
    public static string SystemTypeCategory(string name) => name.ToLowerInvariant() switch
    {
        "bigint" or "int" or "smallint" or "tinyint" or "bit" or "decimal" or "numeric" or "money" or "smallmoney" => "Exact numerics",
        "float" or "real" => "Approximate numerics",
        "date" or "datetime" or "datetime2" or "datetimeoffset" or "smalldatetime" or "time" => "Date and time",
        "char" or "varchar" or "text" => "Character strings",
        "nchar" or "nvarchar" or "ntext" or "sysname" => "Unicode character strings",
        "binary" or "varbinary" or "image" => "Binary strings",
        "geometry" => "Spatial geometry types",
        "geography" => "Spatial geography types",
        "hierarchyid" => "CLR data types",
        _ => "Other data types",
    };
}
