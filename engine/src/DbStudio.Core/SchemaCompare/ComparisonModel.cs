using System.Collections.Concurrent;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;

namespace DbStudio.Core.SchemaCompare;

/// <summary>A finished comparison, kept in memory so items, scripts and the apply work on the same snapshot.</summary>
internal sealed class ComparisonModel
{
    public required string Id { get; init; }
    public required ProviderContext Source { get; init; }
    public required ProviderContext Target { get; init; }
    public required CompareEndpoint SourceEndpoint { get; init; }
    public required CompareEndpoint TargetEndpoint { get; init; }
    public required SchemaSnapshot SourceSnapshot { get; init; }
    public required SchemaSnapshot TargetSnapshot { get; init; }
    public required CompareOptions Options { get; init; }
    public required List<ItemRec> Items { get; init; }
    public required string ClientId { get; init; }
    public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;

    public string TargetSchema => TargetSnapshot.Schema;
    public string? TargetDatabase => TargetSnapshot.Database;
    public Dialect Dialect => Target.Dialect;

    private readonly ConcurrentDictionary<string, Task<DdlScriptContext>> _contexts = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The scripting context of the target (server version, default schema and — for the dialects that rebuild tables (SQL Server
    /// identity changes, SQLite) — the dependents of <paramref name="table"/>). Cached per table.
    /// </summary>
    public Task<DdlScriptContext> ContextAsync(string? table, CancellationToken ct)
    {
        var needsTable = Target.ProviderId is "sqlserver" or "sqlite";
        var key = needsTable ? table ?? "" : "";
        return _contexts.GetOrAdd(key, _ => Target.Db.GetScriptContextAsync(Target.Profile, Target.Password, TargetDatabase, TargetSchema,
            needsTable ? table : null, ct));
    }

    public ItemRec? Find(string id) => Items.FirstOrDefault(i => i.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
}

/// <summary>The last few comparisons (a comparison holds both schemas' definitions in memory).</summary>
internal sealed class CompareStore
{
    private const int Capacity = 6;
    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(3);
    private readonly ConcurrentDictionary<string, ComparisonModel> _items = new(StringComparer.Ordinal);

    public void Add(ComparisonModel model)
    {
        _items[model.Id] = model;
        var expired = _items.Values.Where(m => DateTimeOffset.UtcNow - m.CreatedAt > MaxAge).Select(m => m.Id).ToList();
        foreach (var id in expired) _items.TryRemove(id, out _);
        foreach (var old in _items.Values.OrderByDescending(m => m.CreatedAt).Skip(Capacity).ToList()) _items.TryRemove(old.Id, out _);
    }

    public ComparisonModel Get(string id) =>
        _items.TryGetValue(id, out var m) ? m : throw EngineExceptionFactory.Gone();

    public void Remove(string id) => _items.TryRemove(id, out _);
}

internal static class EngineExceptionFactory
{
    public static Services.EngineException Gone() =>
        new(404, Services.ErrorCodes.NotFound, "This comparison is no longer available (the engine keeps the last few). Run the comparison again.");
}
