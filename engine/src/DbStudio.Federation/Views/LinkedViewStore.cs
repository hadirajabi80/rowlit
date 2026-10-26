using System.Globalization;
using System.Text.Json;
using DbStudio.Core.Queries;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Views;

/// <summary>
/// Linked views (plan-links 2): queries saved on a link. The SQL, name and description live in the
/// <see cref="SavedQueryStore"/> (connection = the link, schema = <see cref="LinkIds.ViewsSchema"/>, so the explorer's
/// Queries node and Ctrl+P list them like any saved query, and deleting the link deletes them with its other saved
/// queries); the builder model lives in <c>&lt;DataDir&gt;/linked-views.json</c> (atomic writes), keyed by the saved
/// query id. Metadata of a saved query that no longer exists is ignored and pruned on the next write.
/// </summary>
public sealed class LinkedViewStore
{
    public const string FileName = "linked-views.json";

    private sealed record Meta(string Id, string ConnectionId, BuilderModel? Builder);

    private readonly SavedQueryStore _queries;
    private readonly string _file;
    private readonly object _gate = new();
    private List<Meta>? _items;

    public LinkedViewStore(SavedQueryStore queries, AppPaths paths)
    {
        _queries = queries;
        _file = Path.Combine(paths.DataDir, FileName);
    }

    public string FilePath => _file;

    /// <summary>Views of a link, by name.</summary>
    public IReadOnlyList<LinkedView> List(string linkId)
    {
        var saved = _queries.List(linkId, schema: LinkIds.ViewsSchema);
        lock (_gate)
        {
            var meta = Load();
            return saved.Select(q => ToView(q, meta.FirstOrDefault(m => m.Id == q.Id && m.ConnectionId == linkId))).ToList();
        }
    }

    public LinkedView Get(string linkId, string id)
    {
        var q = Find(linkId, id) ?? throw EngineException.NotFound($"Linked view '{id}'");
        lock (_gate) return ToView(q, Load().FirstOrDefault(m => m.Id == q.Id && m.ConnectionId == linkId));
    }

    /// <summary>Creates (<paramref name="id"/> "new") or updates a view.</summary>
    public LinkedView Save(string linkId, string id, LinkedViewInput? input)
    {
        if (input is null) throw EngineException.Validation("A request body is required.");
        if (string.IsNullOrWhiteSpace(input.Sql)) throw EngineException.Validation("sql is required.", new { field = "sql" });
        SavedQuery q;
        if (id == "new")
        {
            q = _queries.Create(linkId, new SavedQueryInput(null, LinkIds.ViewsSchema, input.Name, input.Sql, input.Description));
        }
        else
        {
            if (Find(linkId, id) is null) throw EngineException.NotFound($"Linked view '{id}'");
            q = _queries.Update(linkId, id, new SavedQueryPatch(input.Name, input.Sql, input.Description ?? ""));
        }
        lock (_gate)
        {
            var items = Prune(Load());
            items.RemoveAll(m => m.Id == q.Id);
            items.Add(new Meta(q.Id, linkId, input.Builder));
            Save(items);
            return ToView(q, items[^1]);
        }
    }

    public void Delete(string linkId, string id)
    {
        if (Find(linkId, id) is null) throw EngineException.NotFound($"Linked view '{id}'");
        _queries.Delete(linkId, id);
        lock (_gate)
        {
            var items = Load();
            if (items.RemoveAll(m => m.Id == id) > 0) Save(Prune(items));
        }
    }

    /// <summary>Removes the views of a deleted link (saved queries and metadata).</summary>
    public int DeleteForLink(string linkId)
    {
        var n = 0;
        foreach (var q in _queries.List(linkId, schema: LinkIds.ViewsSchema))
            if (_queries.Delete(linkId, q.Id)) n++;
        lock (_gate)
        {
            var items = Load();
            if (items.RemoveAll(m => m.ConnectionId == linkId) > 0) Save(items);
        }
        return n;
    }

    private SavedQuery? Find(string linkId, string id) =>
        _queries.List(linkId, schema: LinkIds.ViewsSchema).FirstOrDefault(q => q.Id == id);

    private static LinkedView ToView(SavedQuery q, Meta? meta) =>
        new(q.Id, q.ConnectionId, q.Name, q.Description, q.Sql, meta?.Builder, Parse(q.CreatedAt), Parse(q.UpdatedAt));

    private static DateTimeOffset Parse(string s) =>
        DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : DateTimeOffset.UnixEpoch;

    /// <summary>Drops metadata whose saved query is gone (deleted from the Queries node, or with its link).</summary>
    private List<Meta> Prune(List<Meta> items)
    {
        var byLink = items.Select(m => m.ConnectionId).Distinct(StringComparer.Ordinal)
            .ToDictionary(c => c, c => _queries.List(c, schema: LinkIds.ViewsSchema).Select(q => q.Id).ToHashSet(StringComparer.Ordinal), StringComparer.Ordinal);
        items.RemoveAll(m => !byLink[m.ConnectionId].Contains(m.Id));
        return items;
    }

    private List<Meta> Load()
    {
        if (_items is not null) return _items;
        var list = new List<Meta>();
        if (File.Exists(_file))
        {
            try
            {
                list = JsonSerializer.Deserialize<List<Meta>>(File.ReadAllText(_file), CoreJson.Options) ?? [];
                list.RemoveAll(m => m is null || string.IsNullOrEmpty(m.Id) || string.IsNullOrEmpty(m.ConnectionId));
            }
            catch (JsonException)
            {
                try { File.Copy(_file, _file + ".corrupt", overwrite: true); } catch (IOException) { }
                list = [];
            }
        }
        _items = list;
        return list;
    }

    private void Save(List<Meta> items)
    {
        _items = items;
        AtomicFile.WriteAllText(_file, JsonSerializer.Serialize(items, CoreJson.Indented));
    }
}
