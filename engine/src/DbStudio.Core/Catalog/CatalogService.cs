using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Sql;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.Catalog;

public sealed record CatalogDatabases(IReadOnlyList<string> Databases, string? Current);

/// <param name="SearchPathIndex">PostgreSQL: 0-based position on the session search_path; null when not on it (or no search path).</param>
public sealed record CatalogSchemaItem(string Name, bool Loaded, int? ObjectCount, int? SearchPathIndex = null);

public sealed record CatalogSchemas(string? Database, string DefaultSchema, IReadOnlyList<CatalogSchemaItem> Schemas);

/// <param name="Json">Snapshot JSON (null when <see cref="NotModified"/>).</param>
public sealed record CatalogSnapshotResult(byte[]? Json, string ETag, bool NotModified, int Version);

/// <summary>
/// Deadlines of the calls on catalog connections (a server that vanished behind a pooled connection never answers).
/// <paramref name="Probe"/>: the liveness check made when a catalog reader is opened. <paramref name="Quick"/>: database /
/// schema lists. <paramref name="Load"/>: schema snapshots, object details, DDL (a huge dictionary may legitimately take minutes).
/// A call that hits a deadline or fails on a broken connection clears the pooled connections and runs once more on fresh ones.
/// </summary>
public sealed record CatalogTimeouts(TimeSpan Probe, TimeSpan Quick, TimeSpan Load)
{
    public static CatalogTimeouts Default { get; } = new(TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(5));
}

/// <summary>
/// Metadata cache per connection / database / schema (docs/PLAN.md 2.7). Schemas are loaded lazily with one
/// <see cref="ICatalogReader.LoadSchemaAsync"/> call over a short-lived catalog connection, serialized once to the
/// compact wire format and ETag'd. DDL executed in sessions invalidates and reloads the affected schemas in the
/// background, then pushes <c>catalog.changed</c>.
/// <para>Cache keys: SQL Server and PostgreSQL use the database name (<see cref="DialectInfo.HasDatabases"/>); Oracle and SQLite have no database level (key "").</para>
/// </summary>
public sealed class CatalogService
{
    private readonly ProviderRegistry _providers;
    private readonly ConnectionStore _connections;
    private readonly IEventPublisher _events;
    private readonly ILogger _log;
    private readonly ConcurrentDictionary<string, ConnectionCatalog> _caches = new(StringComparer.Ordinal);
    private readonly string _epoch = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
    private readonly TimeProvider _time;
    private readonly CatalogTimeouts _limits;
    // Resources: the last version of every forgotten / evicted database cache, so a reload never reuses an ETag.
    private readonly ConcurrentDictionary<string, int> _retiredVersions = new(StringComparer.OrdinalIgnoreCase);

    public CatalogService(ProviderRegistry providers, ConnectionStore connections, IEventPublisher events, ILogger<CatalogService>? log = null,
        TimeProvider? time = null, CatalogTimeouts? limits = null)
    {
        _time = time ?? TimeProvider.System;
        _limits = limits ?? CatalogTimeouts.Default;
        _providers = providers;
        _connections = connections;
        _events = events;
        _log = log ?? (ILogger)NullLogger.Instance;
    }

    private sealed class ConnectionCatalog
    {
        public readonly SemaphoreSlim Gate = new(1, 1);
        public DateTimeOffset LastUsed;
        public string Id = "";
        public readonly Dictionary<string, DbCatalog> Databases = new(StringComparer.OrdinalIgnoreCase);
        public string? CurrentDatabase;
        public IReadOnlyList<string>? DatabaseList;
    }

    private sealed class DbCatalog(string? name, int version = 1)
    {
        public string? Name { get; } = name;
        public int Version = version;
        /// <summary>Schemas evicted to save memory: reloading one bumps <see cref="Version"/> so the UI gets the fresh copy.</summary>
        public readonly HashSet<string> Evicted = new(StringComparer.OrdinalIgnoreCase);
        public string? DefaultSchema;
        public IReadOnlyList<SchemaInfo>? SchemaList;
        public readonly Dictionary<string, SchemaEntry> Loaded = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed record SchemaEntry(string Name, int Version, byte[] Json, int ObjectCount)
    {
        /// <summary>Last snapshot that included the schema (LRU eviction, docs/resources.md).</summary>
        public DateTimeOffset LastUsed { get; set; }
    }

    /// <summary>
    /// Lazily opened catalog reader shared by one attempt of an operation. Opening it also checks that the (possibly pooled)
    /// connection answers: a stale one is found within <c>probe</c> instead of blocking the real query.
    /// </summary>
    private sealed class ReaderLease(IDbProvider provider, ConnectionProfile profile, string? password, TimeSpan probe, CancellationToken ct) : IAsyncDisposable
    {
        private ICatalogReader? _reader;
        private volatile bool _disposed;

        public async ValueTask<ICatalogReader> GetAsync()
        {
            if (_reader is not null) return _reader;
            var reader = await provider.OpenCatalogReaderAsync(profile, password, ct).ConfigureAwait(false);
            try
            {
                // the attempt was abandoned while this reader was still opening: give the connection back, do not use it
                if (_disposed) throw new OperationCanceledException(ct);
                await ConnectionGuard.BoundedAsync(t => reader.GetCurrentDatabaseAsync(t), probe, ct, "The server").ConfigureAwait(false);
            }
            catch
            {
                await DisposeQuietly(reader).ConfigureAwait(false);
                throw;
            }
            return _reader = reader;
        }

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return _reader is { } r ? DisposeQuietly(r) : ValueTask.CompletedTask;
        }

        private static async ValueTask DisposeQuietly(ICatalogReader reader)
        {
            try { await reader.DisposeAsync().ConfigureAwait(false); }
            catch (Exception) { /* a broken connection: nothing left to give back */ }
        }
    }

    /// <summary>
    /// Runs <paramref name="body"/> on a fresh reader lease with a deadline. When the attempt times out or fails on a broken
    /// connection (socket / IO error, no answer) the provider's pooled connections are cleared and the whole operation runs
    /// once more on new ones; a second failure is reported as 503 "Server not reachable: …". The request's cancellation
    /// token reaches every driver call (a cancelled request ends the attempt at once).
    /// </summary>
    private async Task<T> WithReaderAsync<T>(string connectionId, IDbProvider provider, ConnectionProfile profile, string? password,
        TimeSpan timeout, CancellationToken ct, Func<ReaderLease, CancellationToken, Task<T>> body)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await ConnectionGuard.BoundedAsync(async token =>
                {
                    await using var lease = new ReaderLease(provider, profile, password, _limits.Probe, token);
                    return await body(lease, token).ConfigureAwait(false);
                }, timeout, ct, "The server").ConfigureAwait(false);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested && ConnectionGuard.IsBrokenConnection(ex, includeBareIo: true))
            {
                if (attempt >= 2) throw ConnectionGuard.Unreachable(ex, profile.Name);
                _log.LogWarning("Catalog call on {ConnectionId} failed on a broken connection ({Message}); clearing the pooled connections and retrying once",
                    connectionId, ConnectionGuard.RootMessage(ex));
                ClearPools(connectionId, provider, profile, password);
            }
        }
    }

    private void ClearPools(string connectionId, IDbProvider provider, ConnectionProfile profile, string? password)
    {
        try
        {
            provider.ClearPooledConnections(profile, password, CachedDatabases(connectionId));
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "Clearing the pooled connections of {ConnectionId} failed", connectionId);
        }
    }

    private (IDbProvider Provider, ConnectionProfile Profile, string? Password) Resolve(string connectionId)
    {
        var profile = _connections.WithSecrets(_connections.Get(connectionId));
        if (_caches.TryGetValue(connectionId, out var cc)) cc.LastUsed = _time.GetUtcNow(); // pooled catalog connections in use
        return (_providers.Get(profile.ProviderId), profile, _connections.GetPassword(connectionId));
    }

    private ConnectionCatalog Cache(string connectionId)
    {
        var cc = _caches.GetOrAdd(connectionId, id => new ConnectionCatalog { Id = id });
        cc.LastUsed = _time.GetUtcNow();
        return cc;
    }

    private static string RetiredKey(string connectionId, string dbKey) => connectionId + "|" + dbKey;

    private async Task<DbCatalog> DbAsync(ConnectionCatalog cc, Dialect dialect, string? database, ReaderLease lease, CancellationToken ct)
    {
        string? name = null;
        if (DialectInfo.HasDatabases(dialect))
        {
            name = string.IsNullOrWhiteSpace(database) ? null : database;
            if (name is null)
            {
                cc.CurrentDatabase ??= await (await lease.GetAsync().ConfigureAwait(false)).GetCurrentDatabaseAsync(ct).ConfigureAwait(false);
                name = cc.CurrentDatabase;
            }
        }
        var key = name ?? "";
        if (!cc.Databases.TryGetValue(key, out var db))
        {
            db = new DbCatalog(name, _retiredVersions.TryRemove(RetiredKey(cc.Id, key), out var last) ? last + 1 : 1);
            cc.Databases[key] = db;
        }
        return db;
    }

    private static async Task EnsureDefaultsAsync(DbCatalog db, ConnectionCatalog cc, ReaderLease lease, CancellationToken ct)
    {
        if (db.DefaultSchema is null)
            db.DefaultSchema = await (await lease.GetAsync().ConfigureAwait(false)).GetDefaultSchemaAsync(db.Name, ct).ConfigureAwait(false);
        if (cc.DatabaseList is null)
            cc.DatabaseList = await (await lease.GetAsync().ConfigureAwait(false)).ListDatabasesAsync(ct).ConfigureAwait(false);
    }

    // ------------------------------------------------------------------ queries

    public async Task<CatalogDatabases> GetDatabasesAsync(string connectionId, CancellationToken ct)
    {
        var (provider, profile, password) = Resolve(connectionId);
        var cc = Cache(connectionId);
        await cc.Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await WithReaderAsync(connectionId, provider, profile, password, _limits.Quick, ct, async (lease, token) =>
            {
                var reader = await lease.GetAsync().ConfigureAwait(false);
                cc.DatabaseList = await reader.ListDatabasesAsync(token).ConfigureAwait(false);
                var current = await reader.GetCurrentDatabaseAsync(token).ConfigureAwait(false);
                if (DialectInfo.HasDatabases(provider.Dialect)) cc.CurrentDatabase = current;
                return new CatalogDatabases(cc.DatabaseList, current);
            }).ConfigureAwait(false);
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    public async Task<CatalogSchemas> GetSchemasAsync(string connectionId, string? database, CancellationToken ct)
    {
        var (provider, profile, password) = Resolve(connectionId);
        var cc = Cache(connectionId);
        await cc.Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await WithReaderAsync(connectionId, provider, profile, password, _limits.Quick, ct, async (lease, token) =>
            {
                var db = await DbAsync(cc, provider.Dialect, database, lease, token).ConfigureAwait(false);
                await EnsureDefaultsAsync(db, cc, lease, token).ConfigureAwait(false);
                db.SchemaList = await (await lease.GetAsync().ConfigureAwait(false)).ListSchemasAsync(db.Name, token).ConfigureAwait(false);
                var items = db.SchemaList
                    .Select(s => db.Loaded.TryGetValue(s.Name, out var e)
                        ? new CatalogSchemaItem(s.Name, true, e.ObjectCount, s.SearchPathIndex)
                        : new CatalogSchemaItem(s.Name, false, s.ObjectCount, s.SearchPathIndex))
                    .ToList();
                return new CatalogSchemas(db.Name, db.DefaultSchema!, items);
            }).ConfigureAwait(false);
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    /// <param name="schemas">Schemas to include; null/empty = the default schema.</param>
    /// <param name="ifNoneMatch">Value of the If-None-Match header.</param>
    public async Task<CatalogSnapshotResult> GetSnapshotAsync(string connectionId, string? database, IReadOnlyList<string>? schemas,
        string? ifNoneMatch, CancellationToken ct)
    {
        var (provider, profile, password) = Resolve(connectionId);
        var cc = Cache(connectionId);
        await cc.Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await WithReaderAsync(connectionId, provider, profile, password, _limits.Load, ct, async (lease, token) =>
            {
                var db = await DbAsync(cc, provider.Dialect, database, lease, token).ConfigureAwait(false);
                await EnsureDefaultsAsync(db, cc, lease, token).ConfigureAwait(false);

                var requested = schemas is { Count: > 0 } ? schemas.Distinct(StringComparer.OrdinalIgnoreCase).ToList() : [db.DefaultSchema!];
                var entries = new List<SchemaEntry>(requested.Count);
                foreach (var name in requested)
                {
                    if (!db.Loaded.TryGetValue(name, out var entry))
                    {
                        // Evicted to save memory: the reload may differ from what the client kept, so it gets a new ETag.
                        if (db.Evicted.Remove(name)) db.Version++;
                        entry = await LoadSchemaAsync(db, name, db.Version, lease, token).ConfigureAwait(false);
                    }
                    entry.LastUsed = _time.GetUtcNow();
                    entries.Add(entry);
                }

                var etag = ETag(connectionId, db, entries);
                if (ifNoneMatch is not null && ETagMatches(ifNoneMatch, etag))
                    return new CatalogSnapshotResult(null, etag, true, db.Version);

                if (provider.Dialect == Dialect.PgSql && db.SchemaList is null)
                    db.SchemaList = await (await lease.GetAsync().ConfigureAwait(false)).ListSchemasAsync(db.Name, token).ConfigureAwait(false);
                var searchPath = db.SchemaList?.Where(s => s.SearchPathIndex is not null).OrderBy(s => s.SearchPathIndex).Select(s => s.Name).ToList();
                var json = CatalogWire.ComposeSnapshot(connectionId, provider.Dialect, db.Name, db.DefaultSchema!, db.Version,
                    cc.DatabaseList ?? [], entries.Select(e => e.Json), searchPath);
                return new CatalogSnapshotResult(json, etag, false, db.Version);
            }).ConfigureAwait(false);
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    private async Task<SchemaEntry> LoadSchemaAsync(DbCatalog db, string name, int version, ReaderLease lease, CancellationToken ct)
    {
        // exact name first: a case-sensitive database may have both "Sales" and "sales"
        var canonical = (db.SchemaList?.FirstOrDefault(s => s.Name.Equals(name, StringComparison.Ordinal))
                         ?? db.SchemaList?.FirstOrDefault(s => s.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))?.Name ?? name;
        var model = await (await lease.GetAsync().ConfigureAwait(false)).LoadSchemaAsync(db.Name, canonical, ct).ConfigureAwait(false);
        var fkCount = model.Objects.Sum(o => o.ForeignKeys.Count);
        _log.LogDebug("Catalog {Database}.{Schema}: {Objects} objects, {ForeignKeys} foreign keys, referenced from [{ReferencingSchemas}]",
            db.Name, model.Name, model.Objects.Count, fkCount, string.Join(", ", model.ReferencingSchemas));
        if (model.HiddenForeignKeys > 0)
            _log.LogWarning("Catalog {Database}.{Schema}: {Hidden} foreign key(s) left out: the referenced table or columns are not visible to this login (VIEW DEFINITION)",
                db.Name, model.Name, model.HiddenForeignKeys);
        var entry = new SchemaEntry(model.Name, version, CatalogWire.SerializeSchema(model, version), model.Objects.Count) { LastUsed = _time.GetUtcNow() };
        db.Loaded[model.Name] = entry;
        return entry;
    }

    private string ETag(string connectionId, DbCatalog db, IEnumerable<SchemaEntry> entries)
    {
        var key = new StringBuilder(connectionId).Append('|').Append(db.Name).Append('|').Append(db.Version);
        foreach (var e in entries) key.Append('|').Append(e.Name).Append(':').Append(e.Version);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key.ToString()));
        return $"\"{_epoch}-{Convert.ToHexString(hash, 0, 8).ToLowerInvariant()}\"";
    }

    private static bool ETagMatches(string header, string etag)
    {
        if (header.Trim() == "*") return true;
        foreach (var part in header.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var p = part.StartsWith("W/", StringComparison.Ordinal) ? part[2..] : part;
            if (p == etag) return true;
        }
        return false;
    }

    /// <summary>One metadata read on its own reader (no cache): bounded, a broken pooled connection cleared and retried once.</summary>
    private Task<T> ReadAsync<T>(string connectionId, CancellationToken ct, Func<ICatalogReader, CancellationToken, Task<T>> read)
    {
        var (provider, profile, password) = Resolve(connectionId);
        return WithReaderAsync(connectionId, provider, profile, password, _limits.Load, ct, async (lease, token) =>
            await read(await lease.GetAsync().ConfigureAwait(false), token).ConfigureAwait(false));
    }

    public Task<ObjectDetails> GetObjectDetailsAsync(string connectionId, ObjectRef obj, CancellationToken ct) =>
        ReadAsync(connectionId, ct, (reader, t) => reader.GetObjectDetailsAsync(obj, t));

    public Task<DdlResult> GetDdlAsync(string connectionId, ObjectRef obj, CancellationToken ct) =>
        ReadAsync(connectionId, ct, (reader, t) => reader.GetDdlAsync(obj, t));

    public Task<IReadOnlyList<ObjectError>> GetCompileErrorsAsync(string connectionId, ObjectRef obj, CancellationToken ct) =>
        ReadAsync(connectionId, ct, (reader, t) => reader.GetCompileErrorsAsync(obj, t));

    public Task<IReadOnlyList<SystemTypeInfo>> ListSystemTypesAsync(string connectionId, string? database, CancellationToken ct) =>
        ReadAsync(connectionId, ct, (reader, t) => reader.ListSystemTypesAsync(database, t));

    public Task<CatalogObject?> ResolvePublicSynonymAsync(string connectionId, string name, CancellationToken ct) =>
        ReadAsync(connectionId, ct, (reader, t) => reader.ResolvePublicSynonymAsync(name, t));

    // ------------------------------------------------------------------ refresh / invalidation

    /// <summary>Reloads the given schemas (or every loaded one), resets list caches, bumps the version and pushes catalog.changed.</summary>
    public async Task<int> RefreshAsync(string connectionId, string? database, IReadOnlyList<string>? schemas, CancellationToken ct)
    {
        var (provider, profile, password) = Resolve(connectionId);
        var cc = Cache(connectionId);
        await cc.Gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            List<string>? targets = null; // decided once: a retry must reload the same schemas (the failed attempt removed them from the cache)
            return await WithReaderAsync(connectionId, provider, profile, password, _limits.Load, ct, async (lease, token) =>
            {
                cc.DatabaseList = null;
                var db = await DbAsync(cc, provider.Dialect, database, lease, token).ConfigureAwait(false);
                db.DefaultSchema = null;
                db.SchemaList = null;
                targets ??= schemas is { Count: > 0 } ? schemas.ToList() : db.Loaded.Keys.ToList();
                var reloaded = await ReloadAsync(db, targets, lease, token).ConfigureAwait(false);
                await EnsureDefaultsAsync(db, cc, lease, token).ConfigureAwait(false);
                _events.Publish(new CatalogChangedEvent(connectionId, db.Name, reloaded, db.Version));
                return db.Version;
            }).ConfigureAwait(false);
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    private async Task<List<string>> ReloadAsync(DbCatalog db, List<string> names, ReaderLease lease, CancellationToken ct)
    {
        db.Version++;
        var reloaded = new List<string>();
        foreach (var name in names)
        {
            db.Loaded.Remove(name);
            try
            {
                var entry = await LoadSchemaAsync(db, name, db.Version, lease, ct).ConfigureAwait(false);
                reloaded.Add(entry.Name);
            }
            catch (EngineException ex) when (ex.Status == 404)
            {
                reloaded.Add(name); // schema dropped: report it so the UI discards it
            }
        }
        return reloaded;
    }

    /// <summary>
    /// Called after a batch containing DDL succeeded. Marks the affected schemas stale, reloads the loaded ones in the
    /// background and publishes catalog.changed. <paramref name="sessionDatabase"/> is the session's current database
    /// (SQL Server) or current schema (Oracle).
    /// </summary>
    public void InvalidateAfterDdl(string connectionId, Dialect dialect, string? sessionDatabase, IEnumerable<DdlTarget> targets)
    {
        var list = targets.Where(t => t.Scope != DdlScope.Temporary).ToList();
        if (list.Count == 0 || !_caches.TryGetValue(connectionId, out var cc)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await InvalidateCoreAsync(connectionId, cc, dialect, sessionDatabase, list).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Catalog reload after DDL failed for {ConnectionId}", connectionId);
            }
        });
    }

    private async Task InvalidateCoreAsync(string connectionId, ConnectionCatalog cc, Dialect dialect, string? sessionDatabase, List<DdlTarget> targets)
    {
        var profile = _connections.Find(connectionId);
        if (profile is null) return;
        var provider = _providers.Get(profile.ProviderId);
        await cc.Gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var password = _connections.GetPassword(connectionId);
            var work = new Dictionary<string, (DbCatalog Db, HashSet<string> Schemas, bool Whole)>(StringComparer.OrdinalIgnoreCase);
            foreach (var t in targets)
            {
                if (t.Action is "ATTACH" or "DETACH") cc.DatabaseList = null;
                var dbName = DialectInfo.HasDatabases(dialect) ? t.Database ?? sessionDatabase ?? cc.CurrentDatabase : null;
                var key = dbName ?? "";
                if (!cc.Databases.TryGetValue(key, out var db)) continue; // nothing cached for that database
                if (!work.TryGetValue(key, out var w)) w = (db, new HashSet<string>(StringComparer.OrdinalIgnoreCase), false);
                if (t.Scope == DdlScope.Database)
                {
                    w.Whole = true;
                }
                else
                {
                    var schema = t.Schema ?? dialect switch
                    {
                        _ when DialectInfo.SchemaIsDatabase(dialect) => sessionDatabase ?? db.DefaultSchema, // Oracle, MySQL, ClickHouse, Cassandra
                        Dialect.Sqlite => "main",
                        _ => db.DefaultSchema ?? DialectInfo.DefaultSchemaFallback(dialect),
                    };
                    if (schema is not null) w.Schemas.Add(schema);
                }
                work[key] = w;
            }

            // what to reload is decided before the (retryable) reads: a failed attempt removes schemas from the cache
            var plan = new List<(DbCatalog Db, List<string> Names)>();
            foreach (var (_, (db, schemas, whole)) in work)
            {
                db.SchemaList = null;
                var toReload = whole ? db.Loaded.Keys.ToList() : schemas.Where(db.Loaded.ContainsKey).ToList();
                if (toReload.Count == 0 && !whole) continue;
                plan.Add((db, toReload));
            }
            if (plan.Count == 0) return;
            await WithReaderAsync(connectionId, provider, profile, password, _limits.Load, CancellationToken.None, async (lease, token) =>
            {
                foreach (var (db, names) in plan)
                {
                    var reloaded = await ReloadAsync(db, names, lease, token).ConfigureAwait(false);
                    _events.Publish(new CatalogChangedEvent(connectionId, db.Name, reloaded, db.Version));
                }
                return true;
            }).ConfigureAwait(false);
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    /// <summary>Drops all cached metadata of a connection (profile edited or deleted, connection closed).</summary>
    public void Forget(string connectionId)
    {
        if (!_caches.TryRemove(connectionId, out var cc)) return;
        foreach (var (key, db) in cc.Databases.ToArray()) Retire(connectionId, key, db);
    }

    // ------------------------------------------------------------------ resources (docs/resources.md)

    private void Retire(string connectionId, string key, DbCatalog db) =>
        _retiredVersions.AddOrUpdate(RetiredKey(connectionId, key), db.Version, (_, v) => Math.Max(v, db.Version));

    /// <summary>
    /// Explorer "Close database": drops the cached metadata of one database of the connection (SQLite / Oracle and the
    /// other single-database engines: the whole connection's cache). Returns the bytes freed.
    /// </summary>
    public long ForgetDatabase(string connectionId, string? database)
    {
        if (!_caches.TryGetValue(connectionId, out var cc)) return 0;
        if (!cc.Gate.Wait(TimeSpan.FromSeconds(5))) return 0;
        try
        {
            var key = database?.Trim() ?? "";
            if (!cc.Databases.TryGetValue(key, out var db))
            {
                // the connection's default database is cached under its name, or under "" (no database level)
                if (key.Length == 0 && cc.CurrentDatabase is { } current && cc.Databases.TryGetValue(current, out var byCurrent)) { db = byCurrent; key = current; }
                else if (cc.Databases.TryGetValue("", out var single)) { db = single; key = ""; }
                else return 0;
            }
            var bytes = db.Loaded.Values.Sum(e => (long)e.Json.Length);
            cc.Databases.Remove(key);
            Retire(connectionId, key, db);
            return bytes;
        }
        finally
        {
            cc.Gate.Release();
        }
    }

    /// <summary>Bytes of serialized schema snapshots cached for the connection, and how many schemas.</summary>
    public (long Bytes, int Schemas, int Databases) Stats(string connectionId)
    {
        if (!_caches.TryGetValue(connectionId, out var cc)) return (0, 0, 0);
        try
        {
            var dbs = cc.Databases.Values.ToList();
            return (dbs.Sum(d => d.Loaded.Values.Sum(e => (long)e.Json.Length)), dbs.Sum(d => d.Loaded.Count), dbs.Count);
        }
        catch (InvalidOperationException)
        {
            return (0, 0, 0); // modified concurrently: the next sample counts it
        }
    }

    /// <summary>Last catalog request of the connection (any database), null when nothing is cached.</summary>
    public DateTimeOffset? LastUsed(string connectionId) => _caches.TryGetValue(connectionId, out var cc) ? cc.LastUsed : null;

    /// <summary>Connections with cached metadata.</summary>
    public IReadOnlyList<string> CachedConnections() => _caches.Keys.ToList();

    /// <summary>Names of the databases cached for a connection (null = the connection's default / no database level).</summary>
    public IReadOnlyList<string?> CachedDatabases(string connectionId) =>
        _caches.TryGetValue(connectionId, out var cc) ? cc.Databases.Values.Select(d => d.Name).ToList() : [];

    /// <summary>Total bytes of every cached schema snapshot.</summary>
    public long TotalBytes() => _caches.Keys.Sum(cid => Stats(cid).Bytes);

    /// <summary>
    /// LRU eviction (docs/resources.md): drops the least recently used schema snapshots that were not used for
    /// <paramref name="minIdle"/> until the cache fits <paramref name="budgetBytes"/>. Connections whose cache is busy
    /// (a load in progress) are skipped. An evicted schema reloads lazily with a new ETag. Returns the bytes freed.
    /// </summary>
    public long Trim(long budgetBytes, TimeSpan minIdle)
    {
        var now = _time.GetUtcNow();
        var candidates = new List<(ConnectionCatalog Cc, DbCatalog Db, SchemaEntry Entry)>();
        long total = 0;
        foreach (var cc in _caches.Values)
        {
            if (!cc.Gate.Wait(0)) continue;
            try
            {
                foreach (var db in cc.Databases.Values)
                    foreach (var e in db.Loaded.Values)
                    {
                        total += e.Json.Length;
                        if (now - e.LastUsed >= minIdle) candidates.Add((cc, db, e));
                    }
            }
            finally
            {
                cc.Gate.Release();
            }
        }
        if (total <= budgetBytes) return 0;
        long freed = 0;
        foreach (var (cc, db, e) in candidates.OrderBy(c => c.Entry.LastUsed))
        {
            if (total - freed <= budgetBytes) break;
            if (!cc.Gate.Wait(0)) continue;
            try
            {
                if (!db.Loaded.TryGetValue(e.Name, out var current) || !ReferenceEquals(current, e)) continue;
                db.Loaded.Remove(e.Name);
                db.Evicted.Add(e.Name);
                freed += e.Json.Length;
            }
            finally
            {
                cc.Gate.Release();
            }
        }
        if (freed > 0) _log.LogInformation("Catalog cache: evicted {Bytes:N0} bytes of schema snapshots (budget {Budget:N0})", freed, budgetBytes);
        return freed;
    }
}
