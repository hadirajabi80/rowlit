using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Import.Run;

/// <summary>Reads the columns and unique keys of an import target from the catalog.</summary>
internal static class TargetInfoReader
{
    public static async Task<(TargetTableInfo Info, List<TargetCol> Cols)> ReadAsync(CatalogService catalog, string connectionId, ImportDialect dialect,
        string? database, string? schema, string table, CancellationToken ct)
    {
        ObjectDetails details;
        try
        {
            details = await catalog.GetObjectDetailsAsync(connectionId, new ObjectRef(Blank(database), Blank(schema), table, ObjectTypes.Table), ct).ConfigureAwait(false);
        }
        catch (EngineException ex) when (ex.Status == 404)
        {
            return (new TargetTableInfo(false, [], [], []), []);
        }
        if (details.Columns.Count == 0) return (new TargetTableInfo(false, [], [], []), []);

        var cols = new List<TargetCol>();
        var dtos = new List<TargetColumnDto>();
        foreach (var c in details.Columns.OrderBy(c => c.Ordinal))
        {
            var kind = dialect.Classify(c.Type, out var max);
            cols.Add(new TargetCol(c.Name, kind, c.Type, max, c.Nullable, c.Default is not null, c.IsIdentity));
            dtos.Add(new TargetColumnDto(c.Name, c.Type, kind, c.Nullable, c.IsPk, c.IsIdentity, c.IsComputed, c.Default is not null, c.Ordinal));
        }
        var pk = details.Columns.Where(c => c.IsPk).OrderBy(c => c.Ordinal).Select(c => c.Name).ToList();
        var unique = new List<IReadOnlyList<string>>();
        if (pk.Count > 0) unique.Add(pk);
        foreach (var ix in details.Indexes.Where(i => i.Unique || i.IsPrimaryKey))
        {
            if (ix.Columns.Count == 0) continue;
            if (unique.Any(u => u.SequenceEqual(ix.Columns, StringComparer.OrdinalIgnoreCase))) continue;
            unique.Add(ix.Columns.ToList());
        }
        return (new TargetTableInfo(true, dtos, pk, unique), cols);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
