using System.Collections.Concurrent;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.Services;

/// <summary>Wire shape of a session (ui/src/api/types.ts SessionInfo).</summary>
public sealed record SessionInfo(
    string SessionId,
    string ConnectionId,
    ServerInfo ServerInfo,
    string? Database,
    TransactionMode TxMode,
    bool TxOpen,
    SessionState State,
    Dialect Dialect,
    string? ExecutingSince = null,
    string? TabId = null,
    string? Label = null,
    bool Orphan = false,
    string? Schema = null,
    IReadOnlyList<string>? SearchPath = null,
    SchemaMode SchemaMode = SchemaMode.None,
    bool Released = false,
    string? ReleasedReason = null,
    bool HasTempObjects = false);

/// <summary>A tab session: the provider session plus engine bookkeeping (busy flag, reopen data).</summary>
public sealed class SessionHandle
{
    private int _busy;

    internal SessionHandle(string id, ConnectionProfile profile, IDbProvider provider, IDbSession session, SessionOptions options,
        TimeProvider? time = null)
    {
        Id = id;
        Profile = profile;
        Provider = provider;
        Session = session;
        Options = options;
        Time = time ?? TimeProvider.System;
        LastActivity = Time.GetUtcNow();
    }

    internal TimeProvider Time { get; }

    public string Id { get; }
    public ConnectionProfile Profile { get; internal set; }
    public IDbProvider Provider { get; }
    public IDbSession Session { get; internal set; }
    public SessionOptions Options { get; internal set; }
    public Dialect Dialect => Provider.Dialect;
    /// <summary>End of the last execution/export (or creation). The idle ping does not count as activity.</summary>
    public DateTimeOffset LastActivity { get; internal set; }

    /// <summary>
    /// Resources (docs/resources.md): the physical connection was closed to free server resources (idle, closed from the
    /// explorer, memory pressure, connection limit) while the session id stays valid. The next execution reopens it
    /// transparently on the same database (<see cref="SessionManager.EnsureUsableAsync"/>).
    /// </summary>
    public bool Released { get; internal set; }

    /// <summary>"idle" | "closed" | "pressure" | "limit" while <see cref="Released"/>.</summary>
    public string? ReleasedReason { get; internal set; }

    /// <summary>
    /// A statement created a temporary object (#temp table, CREATE TEMP TABLE, ...) on this connection: the idle reaper
    /// keeps the session because reopening it would lose the object. Sticky until the session is closed or released.
    /// </summary>
    public bool HasTempObjects { get; internal set; }

    /// <summary>
    /// The default schema the session had when it was released (sessions with <see cref="SchemaMode.Session"/>): the
    /// reopen sets it again when the new connection starts on another one (the console's schema switcher choice).
    /// </summary>
    public string? RememberedSchema { get; internal set; }

    /// <summary>Id of the execution or export currently using the session, else null.</summary>
    public string? ActiveOperation { get; private set; }

    /// <summary>Reserves the session for one execution/export. Returns false when already reserved.</summary>
    public bool TryReserve(string operationId)
    {
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0) return false;
        if (Session.State == SessionState.Executing)
        {
            Interlocked.Exchange(ref _busy, 0);
            return false;
        }
        ActiveOperation = operationId;
        return true;
    }

    public void Release()
    {
        // The idle ping and the resource manager's own release do not make the session "used".
        if (ActiveOperation is not ("ping" or "release")) LastActivity = Time.GetUtcNow();
        ActiveOperation = null;
        ExecutingSince = null;
        Interlocked.Exchange(ref _busy, 0);
    }

    public bool IsReserved => Volatile.Read(ref _busy) != 0;

    /// <summary>M1.5: start of the running execution (set by ExecutionService), null when idle.</summary>
    public DateTimeOffset? ExecutingSince { get; internal set; }

    /// <summary>M1.5: tab id and title from the last ExecuteRequest.source.</summary>
    public string? TabId { get; internal set; }
    public string? Label { get; internal set; }

    /// <summary>B1 (logic-08): the UI client that created the session or touched it last; null for API callers without one.</summary>
    public string? OwnerClientId { get; internal set; }

    internal ClientPresence? Presence { get; set; }

    /// <summary>True when the session has an owner client and that client has no live WebSocket.</summary>
    public bool Orphan => OwnerClientId is { } owner && Presence is { } presence && !presence.IsLive(owner);

    /// <summary>Running an execution or export (not the idle ping or a resource release).</summary>
    public bool IsRunning => IsReserved && ActiveOperation is not ("ping" or "release");

    /// <summary>Holds a physical connection (not <see cref="Released"/>, not closed).</summary>
    public bool HoldsConnection => !Released && Session.State != SessionState.Closed;

    /// <summary>"Console 1" (the tab title of the last execution), else the session id.</summary>
    public string DisplayName => string.IsNullOrWhiteSpace(Label) ? $"Session {Id}" : Label!;

    public SessionInfo ToInfo()
    {
        var executing = IsRunning;
        return new SessionInfo(
            Id, Profile.Id, Session.Server, Session.CurrentDatabase, Session.TxMode, Session.TxOpen && !Released, WireState(), Dialect,
            executing ? ExecutingSince?.ToString("O") : null, TabId, Label, Orphan,
            // a released session reports the schema it will be reopened on (the closed session keeps its last values)
            Released ? RememberedSchema ?? Session.CurrentSchema : Session.CurrentSchema, Session.SearchPath, Session.SchemaMode,
            Released, Released ? ReleasedReason : null, HasTempObjects);
    }

    /// <summary>A released session reads idle (its id stays usable); a reserved idle one reads executing.</summary>
    internal SessionState WireState()
    {
        if (Released) return IsRunning ? SessionState.Executing : SessionState.Idle;
        return IsReserved && Session.State == SessionState.Idle && ActiveOperation is not "release" ? SessionState.Executing : Session.State;
    }
}

/// <summary>
/// Owns all tab sessions (docs/PLAN.md 2.3): one physical connection each, idle ping every 60 s, transparent reopen
/// of broken sessions when no transaction was open, rollback on close.
/// </summary>
public sealed class SessionManager : IAsyncDisposable
{
    private readonly ProviderRegistry _providers;
    private readonly ConnectionStore _connections;
    private readonly IEventPublisher _events;
    private readonly ResultStore _results;
    private readonly ILogger _log;
    private readonly ConcurrentDictionary<string, SessionHandle> _sessions = new(StringComparer.Ordinal);
    private readonly Timer _pingTimer;
    private readonly SettingsService? _settings;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _createGates = new(StringComparer.Ordinal);
    private readonly ClientPresence? _presence;
    private readonly TimeSpan? _orphanGraceOverride;
    private readonly CancellationTokenSource _disposing = new();
    private int _pinging;

    /// <summary>Default of settings connections.maxSessionsPerProfile.</summary>
    public const int DefaultMaxSessionsPerProfile = 8;

    /// <summary>Default of settings connections.orphanGraceSeconds.</summary>
    public const int DefaultOrphanGraceSeconds = 90;

    private readonly TimeProvider _time;

    /// <summary>
    /// Resources (docs/resources.md): called before a session opens a physical connection for a connection that holds
    /// none yet (new session, reopening a released one). <see cref="ResourceManager"/> uses it to enforce the open
    /// connections limit by releasing the least recently used idle connection.
    /// </summary>
    public Func<string, CancellationToken, Task>? BeforeConnect { get; set; }

    /// <param name="presence">Live UI clients (WebSocket hub); without it sessions are never treated as orphaned.</param>
    /// <param name="orphanGrace">Tests: overrides settings connections.orphanGraceSeconds.</param>
    /// <param name="time">Clock of the idle bookkeeping (tests use a manual clock).</param>
    public SessionManager(ProviderRegistry providers, ConnectionStore connections, IEventPublisher events, ResultStore results,
        ILogger<SessionManager>? log = null, TimeSpan? pingInterval = null, SettingsService? settings = null,
        ClientPresence? presence = null, TimeSpan? orphanGrace = null, TimeProvider? time = null)
    {
        _time = time ?? TimeProvider.System;
        _settings = settings;
        _providers = providers;
        _connections = connections;
        _events = events;
        _results = results;
        _log = log ?? (ILogger)NullLogger.Instance;
        _presence = presence;
        _orphanGraceOverride = orphanGrace;
        if (_presence is not null) _presence.ClientGone += OnClientGone;
        var interval = pingInterval ?? TimeSpan.FromSeconds(60);
        _pingTimer = new Timer(_ => _ = PingIdleAsync(), null, interval, interval);
    }

    public async Task<SessionHandle> CreateAsync(string connectionId, string? database, TransactionMode txMode, bool captureServerOutput, CancellationToken ct) =>
        await CreateAsync(connectionId, database, txMode, captureServerOutput, null, ct).ConfigureAwait(false);

    /// <param name="clientId">The UI client creating the session (its owner, see <see cref="SessionHandle.OwnerClientId"/>).</param>
    public async Task<SessionHandle> CreateAsync(string connectionId, string? database, TransactionMode txMode, bool captureServerOutput,
        string? clientId, CancellationToken ct)
    {
        var profile = await _connections.ResolveForOpenAsync(_connections.Get(connectionId), ct).ConfigureAwait(false); // WP-SSH
        var provider = _providers.Get(profile.ProviderId);
        var id = Ids.New("s");
        var options = new SessionOptions(id, string.IsNullOrWhiteSpace(database) ? null : database, txMode, captureServerOutput);

        await NotifyBeforeConnectAsync(connectionId, ct).ConfigureAwait(false);

        // M1.5: per-profile session limit (429 SESSION_LIMIT). A per-profile gate makes count + add atomic.
        var gate = _createGates.GetOrAdd(connectionId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct).ConfigureAwait(false);
        SessionHandle handle;
        try
        {
            var limit = MaxSessionsPerProfile();
            var open = _sessions.Values.Count(s => s.Profile.Id == connectionId);
            if (limit > 0 && open >= limit)
                throw new EngineException(429, "SESSION_LIMIT",
                    $"The connection '{profile.Name}' already has {open} open sessions (limit {limit}). Close idle tabs or raise the limit in Settings.",
                    new { connectionId, limit, open });
            var session = await OpenBoundedAsync(provider, profile, _connections.GetPassword(connectionId), options, ct).ConfigureAwait(false);
            handle = new SessionHandle(id, profile, provider, session, options, _time)
            {
                Presence = _presence,
                OwnerClientId = ClientPresence.Normalize(clientId),
            };
            _sessions[id] = handle;
        }
        finally
        {
            gate.Release();
        }
        _connections.Touch(connectionId);
        _log.LogInformation("Session {SessionId} opened on {ConnectionId} ({Provider})", id, connectionId, provider.Id);
        return handle;
    }

    /// <summary>How long opening a session (connect + server info) may take before the server counts as not reachable.</summary>
    public TimeSpan OpenTimeout { get; init; } = TimeSpan.FromSeconds(45);

    /// <summary>
    /// <see cref="IDbProvider.OpenSessionAsync"/> with a deadline: a server that accepts the socket but never answers (a restarted
    /// Docker port proxy) must not leave the tab on "Loading…". A connection that opens after the deadline is disposed.
    /// </summary>
    private Task<IDbSession> OpenBoundedAsync(IDbProvider provider, ConnectionProfile profile, string? password, SessionOptions options, CancellationToken ct) =>
        ConnectionGuard.BoundedAsync(t => provider.OpenSessionAsync(profile, password, options, t), OpenTimeout, ct, "The server",
            late => late.DisposeAsync());

    /// <summary>settings connections.maxSessionsPerProfile (0 = unlimited).</summary>
    public int MaxSessionsPerProfile()
    {
        if (_settings is null) return DefaultMaxSessionsPerProfile;
        var node = _settings.Get()["connections"]?["maxSessionsPerProfile"];
        return node is null ? DefaultMaxSessionsPerProfile : (int)Math.Clamp(SettingsService.Number(node), 0, 10_000);
    }

    /// <summary>settings connections.orphanGraceSeconds: how long a session survives its owner client's disconnect (0 = forever).</summary>
    public TimeSpan OrphanGrace()
    {
        if (_orphanGraceOverride is { } fixedGrace) return fixedGrace;
        var node = _settings?.Get()["connections"]?["orphanGraceSeconds"];
        var seconds = node is null ? DefaultOrphanGraceSeconds : Math.Clamp(SettingsService.Number(node), 0, 86_400);
        return TimeSpan.FromSeconds(seconds);
    }

    /// <summary>Makes <paramref name="clientId"/> the owner of the session (the UI client that touched it last).</summary>
    public void Claim(SessionHandle h, string? clientId)
    {
        if (ClientPresence.Normalize(clientId) is { } id) h.OwnerClientId = id;
    }

    /// <summary>
    /// Sessions that may hold the lock another statement gave up waiting for: other sessions of the same connection (or of
    /// another profile on the same database file) with an open transaction or a running statement, as
    /// "Console 1 (open transaction)".
    /// <para>
    /// Tab titles repeat across windows ("Console 1" in each), so a holder that is not one of the requesting client's own
    /// sessions is qualified (design-r1-06): "Console 1 from an earlier window" when its owner client is gone (an
    /// orphan kept for the grace period), "Console 1 in another window" when another live client owns it. The plain
    /// name is kept for the requester's own sessions, and for every live holder when the requester is unknown.
    /// </para>
    /// </summary>
    /// <param name="requestingClientId">The UI client whose statement waited (the running session's owner).</param>
    public IReadOnlyList<string> DescribeLockHolders(ConnectionProfile profile, string? exceptSessionId, string? requestingClientId = null)
    {
        var requester = ClientPresence.Normalize(requestingClientId);
        var result = new List<string>();
        foreach (var s in List())
        {
            if (s.Id == exceptSessionId || !SameTarget(s.Profile, profile)) continue;
            var state = s.Session.TxOpen ? "open transaction" : s.IsRunning ? "running" : null;
            if (state is null) continue;
            var own = requester is not null && string.Equals(s.OwnerClientId, requester, StringComparison.Ordinal);
            var window = own ? ""
                : s.Orphan ? " from an earlier window"
                : requester is not null && s.OwnerClientId is not null ? " in another window"
                : "";
            var where = s.Profile.Id == profile.Id ? "" : $" on {s.Profile.Name}";
            result.Add($"{s.DisplayName}{window}{where} ({state})");
        }
        return result;
    }

    /// <summary>Same connection, or another profile of the same provider pointing at the same database file.</summary>
    private static bool SameTarget(ConnectionProfile a, ConnectionProfile b)
    {
        if (a.Id == b.Id) return true;
        if (!a.ProviderId.Equals(b.ProviderId, StringComparison.OrdinalIgnoreCase)) return false;
        var pa = a.GetString("path")?.Trim().Trim('"');
        var pb = b.GetString("path")?.Trim().Trim('"');
        if (string.IsNullOrEmpty(pa) || string.IsNullOrEmpty(pb)) return false;
        try { return string.Equals(Path.GetFullPath(pa), Path.GetFullPath(pb), StringComparison.OrdinalIgnoreCase); }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
    }

    /// <summary>
    /// logic-21: deleting a connection closes its sessions; with open transactions that requires
    /// <paramref name="force"/>, else 409 TX_OPEN listing them.
    /// </summary>
    public void EnsureNoOpenTransactions(string connectionId, bool force)
    {
        if (force) return;
        var open = List().Where(s => s.Profile.Id == connectionId && s.Session.TxOpen).ToList();
        if (open.Count == 0) return;
        var names = string.Join(", ", open.Select(s => s.DisplayName));
        throw new EngineException(409, ErrorCodes.TxOpen,
            $"{open.Count} session(s) of this connection have an open transaction ({names}). Commit or roll back first, or delete with force=true to roll them back.",
            new { sessions = open.Select(s => new { sessionId = s.Id, label = s.Label, tabId = s.TabId }).ToList() });
    }

    private void OnClientGone(string clientId)
    {
        var grace = OrphanGrace();
        if (grace <= TimeSpan.Zero || _disposing.IsCancellationRequested) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(grace + TimeSpan.FromMilliseconds(50), _disposing.Token).ConfigureAwait(false);
                await CloseOrphansAsync().ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // shutting down
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Closing orphaned sessions of client {ClientId} failed", clientId);
            }
        });
    }

    /// <summary>
    /// logic-08: closes (rolling back) every session whose owner client has been disconnected for longer than
    /// <see cref="OrphanGrace"/>. Runs after each client disconnect (delayed by the grace period) and with the idle ping.
    /// Returns the number of sessions closed.
    /// </summary>
    public async Task<int> CloseOrphansAsync()
    {
        var grace = OrphanGrace();
        if (_presence is null || grace <= TimeSpan.Zero) return 0;
        var closed = 0;
        foreach (var h in List())
        {
            if (h.OwnerClientId is not { } owner || _presence.IsLive(owner)) continue;
            if (_presence.GoneSince(owner) is not { } gone || _presence.Now - gone < grace) continue;
            if (h.Session.TxOpen)
                _log.LogWarning("Closing session {SessionId} ({Label}): its client {ClientId} disconnected {Seconds:0} s ago; rolling back its open transaction",
                    h.Id, h.DisplayName, owner, (_presence.Now - gone).TotalSeconds);
            else
                _log.LogInformation("Closing session {SessionId}: its client {ClientId} disconnected", h.Id, owner);
            try
            {
                await CloseAsync(h.Id, force: true).ConfigureAwait(false);
                closed++;
            }
            catch (EngineException)
            {
                // already closed
            }
        }
        return closed;
    }

    public SessionHandle Get(string sessionId) =>
        _sessions.TryGetValue(sessionId, out var h) ? h : throw EngineException.NotFound($"Session '{sessionId}'");

    public IReadOnlyList<SessionHandle> List() => _sessions.Values.OrderBy(s => s.Id, StringComparer.Ordinal).ToList();

    public void PublishChanged(SessionHandle h)
    {
        var info = h.ToInfo();
        _events.Publish(new SessionChangedEvent(info.SessionId, info.State, info.TxOpen, info.Database, info.TxMode, info.Schema, info.SearchPath)
        {
            Released = info.Released,
            ReleasedReason = info.ReleasedReason,
            HasTempObjects = info.HasTempObjects,
        });
    }

    // ------------------------------------------------------------------ resources (docs/resources.md)

    /// <summary>True when a session of the connection holds a physical connection.</summary>
    public bool HoldsConnection(string connectionId) => _sessions.Values.Any(s => s.Profile.Id == connectionId && s.HoldsConnection);

    /// <summary>
    /// Closes the session's physical connection but keeps the session (same id, database, transaction mode): the next
    /// execution reopens it (<see cref="EnsureUsableAsync"/>). Returns false, doing nothing, when the session is running,
    /// already released, or has an open transaction without <paramref name="force"/> (force rolls it back).
    /// </summary>
    /// <param name="reason">"idle" | "closed" | "pressure" | "limit" (reported to the UI).</param>
    public async Task<bool> ReleaseAsync(SessionHandle h, string reason, bool force = false)
    {
        ArgumentNullException.ThrowIfNull(h);
        if (h.Released || !_sessions.ContainsKey(h.Id)) return false;
        if (h.Session.TxOpen && !force) return false;
        if (!h.TryReserve("release")) return false;
        var rolledBack = false;
        try
        {
            if (h.Released) return false;
            rolledBack = h.Session.TxOpen;
            // Remember where the session was: the reopen re-applies the database (USE / reconnect) and transaction mode.
            h.Options = h.Options with { Database = h.Session.CurrentDatabase ?? h.Options.Database, TxMode = h.Session.TxMode };
            // ... and the default schema where the session can set its own (schema switcher, SET search_path, USE SCHEMA).
            h.RememberedSchema = h.Session.SchemaMode == SchemaMode.Session ? h.Session.CurrentSchema : null;
            try
            {
                await h.Session.DisposeAsync().ConfigureAwait(false); // rolls back an open transaction
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "Closing the connection of session {SessionId} failed", h.Id);
            }
            h.Released = true;
            h.ReleasedReason = reason;
            h.HasTempObjects = false;
        }
        finally
        {
            h.Release();
        }
        _log.LogInformation("Session {SessionId} ({Label}) released its connection ({Reason}{RolledBack})", h.Id, h.DisplayName, reason,
            rolledBack ? ", transaction rolled back" : "");
        PublishChanged(h);
        return true;
    }

    /// <summary>
    /// Reopens a released session before a non-execution action that needs its connection (switch database, change the
    /// transaction mode). No-op when the session holds its connection. 409 SESSION_BUSY while it is reserved.
    /// </summary>
    public async Task ReopenIfReleasedAsync(SessionHandle h, CancellationToken ct)
    {
        if (!h.Released) return;
        if (!h.TryReserve("reopen")) throw new EngineException(409, ErrorCodes.SessionBusy, "The session is already executing a statement.");
        try
        {
            if (h.Released) await ReopenReleasedAsync(h, ct).ConfigureAwait(false);
        }
        finally
        {
            h.Release();
        }
    }

    /// <summary>Info message of the execution that reopened a released session.</summary>
    public static string ReopenedMessage(string? reason) => reason switch
    {
        "idle" => "Reconnected: the session had been closed after being idle.",
        "pressure" => "Reconnected: the session had been closed to free memory.",
        "limit" => "Reconnected: the session had been closed to stay under the open connections limit.",
        _ => "Reconnected: the connection had been closed.",
    };

    private async Task NotifyBeforeConnectAsync(string connectionId, CancellationToken ct)
    {
        if (BeforeConnect is not { } hook || HoldsConnection(connectionId)) return;
        try
        {
            await hook(connectionId, ct).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "Freeing resources before connecting {ConnectionId} failed", connectionId);
        }
    }

    /// <summary>Reopens a released session in place (the database and transaction mode it had). Throws 503-ish SESSION_BROKEN when that fails.</summary>
    private async Task ReopenReleasedAsync(SessionHandle h, CancellationToken ct)
    {
        await NotifyBeforeConnectAsync(h.Profile.Id, ct).ConfigureAwait(false);
        IDbSession fresh;
        try
        {
            var profile = _connections.Find(h.Profile.Id) is { } p ? await _connections.ResolveForOpenAsync(p, ct).ConfigureAwait(false) : h.Profile; // WP-SSH
            fresh = await OpenBoundedAsync(h.Provider, profile, _connections.GetPassword(profile.Id), h.Options, ct).ConfigureAwait(false);
            h.Profile = profile;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new EngineException(409, ErrorCodes.SessionBroken, $"The session was closed to free resources and could not be reopened: {ex.Message}");
        }
        // Back to the transaction mode it had (a provider may ignore SessionOptions.TxMode on open).
        if (fresh.TxMode != h.Options.TxMode)
        {
            try { await fresh.SetTransactionModeAsync(h.Options.TxMode, ct).ConfigureAwait(false); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogDebug(ex, "Restoring the transaction mode of {SessionId} failed", h.Id); }
        }
        // Back to the default schema it had (only when the new connection starts on another one: no extra round trip otherwise).
        if (h.RememberedSchema is { Length: > 0 } schema && fresh.SchemaMode == SchemaMode.Session
            && !string.Equals(fresh.CurrentSchema, schema, StringComparison.Ordinal))
        {
            try { await fresh.ChangeSchemaAsync(schema, ct).ConfigureAwait(false); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogInformation("Restoring schema {Schema} of {SessionId} failed: {Message}", schema, h.Id, ex.Message); }
        }
        h.Session = fresh;
        h.Released = false;
        h.ReleasedReason = null;
        h.RememberedSchema = null;
        _connections.Touch(h.Profile.Id);
        _log.LogInformation("Session {SessionId} reopened its connection", h.Id);
        PublishChanged(h);
    }

    /// <summary>Closes a session. With an open transaction requires <paramref name="force"/> (rolls back).</summary>
    public async Task CloseAsync(string sessionId, bool force)
    {
        var h = Get(sessionId);
        if (h.Session.TxOpen && !force)
            throw new EngineException(409, ErrorCodes.TxOpen, "The session has an open transaction. Commit, roll back or close with force=true.");
        if (!_sessions.TryRemove(sessionId, out _)) return;
        h.Session.Cancel();
        try
        {
            await h.Session.DisposeAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Error closing session {SessionId}", sessionId);
        }
        _results.ReleaseSession(sessionId);
        _events.Publish(new SessionChangedEvent(sessionId, SessionState.Closed, false, h.Session.CurrentDatabase, h.Session.TxMode, h.Session.CurrentSchema, h.Session.SearchPath));
    }

    /// <summary>Closes every session of a connection (profile deleted).</summary>
    public async Task CloseAllForConnectionAsync(string connectionId)
    {
        foreach (var h in _sessions.Values.Where(s => s.Profile.Id == connectionId).ToList())
            await CloseAsync(h.Id, force: true).ConfigureAwait(false);
    }

    /// <summary>
    /// Reopens a broken session in place when no transaction was open. Returns a message for the user when it did,
    /// throws SESSION_BROKEN when the transaction was lost or reconnecting failed.
    /// </summary>
    public async Task<string?> EnsureUsableAsync(SessionHandle h, CancellationToken ct)
    {
        if (h.Released)
        {
            var reason = h.ReleasedReason;
            await ReopenReleasedAsync(h, ct).ConfigureAwait(false);
            return ReopenedMessage(reason);
        }
        if (h.Session.State != SessionState.Broken) return null;
        // TxOpen is already false when the break was detected mid-execution: LostTransaction remembers it.
        var hadTx = h.Session.TxOpen || h.Session.LostTransaction;
        var old = h.Session;
        try { await old.DisposeAsync().ConfigureAwait(false); } catch { /* already broken */ }
        IDbSession fresh;
        try
        {
            var profile = _connections.Find(h.Profile.Id) is { } p ? await _connections.ResolveForOpenAsync(p, ct).ConfigureAwait(false) : h.Profile; // WP-SSH
            var options = h.Options with { Database = old.CurrentDatabase ?? h.Options.Database, TxMode = old.TxMode };
            fresh = await OpenBoundedAsync(h.Provider, profile, _connections.GetPassword(profile.Id), options, ct).ConfigureAwait(false);
            h.Profile = profile;
            h.Options = options;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new EngineException(409, ErrorCodes.SessionBroken, $"The connection was lost and could not be reopened: {ex.Message}");
        }
        h.Session = fresh;
        PublishChanged(h);
        if (hadTx)
            throw new EngineException(409, ErrorCodes.SessionBroken, "The connection was lost; the open transaction was rolled back by the server. The session has been reconnected.");
        return "The connection was lost and has been reopened.";
    }

    /// <summary>
    /// docs/PLAN-PG.md D-PG6: switches the database of a session whose connection is bound to one database (PostgreSQL)
    /// by opening a new connection on <paramref name="database"/> and swapping it in under the same session id. 409 TX_OPEN
    /// with an open transaction, 409 SESSION_BUSY while executing; a failed open leaves the current connection in place.
    /// </summary>
    public async Task ReopenWithDatabaseAsync(SessionHandle h, string database, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(h);
        ArgumentException.ThrowIfNullOrWhiteSpace(database);
        if (h.Session.TxOpen) throw new EngineException(409, ErrorCodes.TxOpen, "A transaction is open. Commit or roll back before switching the database.");
        if (!h.TryReserve("reopen")) throw new EngineException(409, ErrorCodes.SessionBusy, "The session is already executing a statement.");
        try
        {
            var old = h.Session;
            var profile = _connections.Find(h.Profile.Id) is { } p ? await _connections.ResolveForOpenAsync(p, ct).ConfigureAwait(false) : h.Profile; // WP-SSH
            var options = h.Options with { Database = database.Trim(), TxMode = old.TxMode };
            var fresh = await OpenBoundedAsync(h.Provider, profile, _connections.GetPassword(profile.Id), options, ct).ConfigureAwait(false);
            h.Session = fresh;
            h.Released = false;
            h.ReleasedReason = null;
            h.Profile = profile;
            h.Options = options;
            try { await old.DisposeAsync().ConfigureAwait(false); } catch { /* the old connection is discarded either way */ }
        }
        finally
        {
            h.Release();
        }
    }

    private async Task PingIdleAsync()
    {
        if (Interlocked.Exchange(ref _pinging, 1) == 1) return;
        try
        {
            try { await CloseOrphansAsync().ConfigureAwait(false); }
            catch (Exception ex) { _log.LogWarning(ex, "Closing orphaned sessions failed"); }
            foreach (var h in _sessions.Values)
            {
                if (h.Released || h.IsReserved || h.Session.State != SessionState.Idle) continue;
                if (_time.GetUtcNow() - h.LastActivity < TimeSpan.FromSeconds(30)) continue;
                if (!h.TryReserve("ping")) continue;
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                bool ok;
                try { ok = await h.Session.PingAsync(cts.Token).ConfigureAwait(false); }
                catch { ok = false; }
                finally { h.Release(); }
                if (!ok && h.Session.State == SessionState.Broken)
                {
                    _log.LogWarning("Session {SessionId} is broken", h.Id);
                    PublishChanged(h);
                }
            }
        }
        finally
        {
            Interlocked.Exchange(ref _pinging, 0);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_presence is not null) _presence.ClientGone -= OnClientGone;
        try { await _disposing.CancelAsync().ConfigureAwait(false); } catch (ObjectDisposedException) { /* disposed twice */ }
        await _pingTimer.DisposeAsync().ConfigureAwait(false);
        foreach (var h in _sessions.Values.ToList())
        {
            _sessions.TryRemove(h.Id, out _);
            try { await h.Session.DisposeAsync().ConfigureAwait(false); } catch { /* shutting down */ }
        }
    }
}
