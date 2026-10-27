using System.Diagnostics;
using System.Net.Sockets;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Providers.Sqlite;
using Microsoft.Data.Sqlite;

namespace DbStudio.Core.Tests.Resources;

/// <summary>
/// A provider over SQLite whose catalog connections can be made to hang (a server behind a half-open socket: the driver
/// never answers and ignores its token) or to fail with an IO error, per call number.
/// </summary>
public sealed class DeadServerProvider : IDbProvider
{
    private readonly SqliteProvider _inner = new();
    private int _opened, _cleared, _sessionsOpened, _lateSessionsDisposed;

    /// <summary>Decides what the n-th (1-based) catalog reader does on its first query: null = answers.</summary>
    public Func<int, Exception?>? ReaderFault { get; set; }
    /// <summary>Readers whose faulty call hangs (never completes, ignores the token) instead of throwing.</summary>
    public Func<int, bool> Hangs { get; set; } = _ => false;
    /// <summary>The session open hangs (ignores its token) until released.</summary>
    public TaskCompletionSource? SessionGate { get; set; }

    public int ReadersOpened => Volatile.Read(ref _opened);
    public int PoolClears => Volatile.Read(ref _cleared);
    public int LateSessionsDisposed => Volatile.Read(ref _lateSessionsDisposed);

    public string Id => "dead";
    public string DisplayName => "Dead server";
    public Dialect Dialect => Dialect.Sqlite;
    public ConnectionFormSpec FormSpec => _inner.FormSpec;
    public IDdlGenerator DdlGenerator => _inner.DdlGenerator;
    public ISqlDiagnostics? Diagnostics => null;
    public IdentifierRules Identifiers => _inner.Identifiers;

    public string BuildConnectionString(ConnectionProfile profile, string? password) => _inner.BuildConnectionString(profile, password);
    public Task<TestConnectionResult> TestAsync(ConnectionProfile profile, string? password, CancellationToken ct) => _inner.TestAsync(profile, password, ct);

    public void ClearPooledConnections(ConnectionProfile profile, string? password, IReadOnlyList<string?> databases) => Interlocked.Increment(ref _cleared);

    public async Task<ICatalogReader> OpenCatalogReaderAsync(ConnectionProfile profile, string? password, CancellationToken ct)
    {
        var n = Interlocked.Increment(ref _opened);
        var inner = await _inner.OpenCatalogReaderAsync(profile, password, ct);
        return new DeadReader(inner, n, this);
    }

    public async Task<IDbSession> OpenSessionAsync(ConnectionProfile profile, string? password, SessionOptions options, CancellationToken ct)
    {
        Interlocked.Increment(ref _sessionsOpened);
        if (SessionGate is { } gate) await gate.Task; // ignores ct, like a driver stuck on a dead socket
        var session = await _inner.OpenSessionAsync(profile, password, options, CancellationToken.None); // a driver that finishes despite the cancel
        return new TrackedSession(session, this);
    }

    private sealed class TrackedSession(IDbSession inner, DeadServerProvider owner) : IDbSession
    {
        public ValueTask DisposeAsync()
        {
            Interlocked.Increment(ref owner._lateSessionsDisposed);
            return inner.DisposeAsync();
        }
        public string SessionId => inner.SessionId;
        public string ConnectionId => inner.ConnectionId;
        public Dialect Dialect => inner.Dialect;
        public SessionState State => inner.State;
        public TransactionMode TxMode => inner.TxMode;
        public bool TxOpen => inner.TxOpen;
        public string? CurrentDatabase => inner.CurrentDatabase;
        public ServerInfo Server => inner.Server;
        public Task SetTransactionModeAsync(TransactionMode mode, CancellationToken ct) => inner.SetTransactionModeAsync(mode, ct);
        public Task CommitAsync(CancellationToken ct) => inner.CommitAsync(ct);
        public Task RollbackAsync(CancellationToken ct) => inner.RollbackAsync(ct);
        public Task ChangeDatabaseAsync(string database, CancellationToken ct) => inner.ChangeDatabaseAsync(database, ct);
        public Task<ExecutionSummary> ExecuteAsync(ExecuteRequest request, IExecutionSink sink, CancellationToken ct) => inner.ExecuteAsync(request, sink, ct);
        public void Cancel() => inner.Cancel();
        public Task<bool> PingAsync(CancellationToken ct) => inner.PingAsync(ct);
    }

    private sealed class DeadReader(ICatalogReader inner, int number, DeadServerProvider owner) : ICatalogReader
    {
        private async Task FaultAsync()
        {
            if (owner.ReaderFault?.Invoke(number) is not { } fault) return;
            if (owner.Hangs(number)) await new TaskCompletionSource().Task; // never completes, ignores the token
            throw fault;
        }

        public ValueTask DisposeAsync() => inner.DisposeAsync();

        public async Task<string?> GetCurrentDatabaseAsync(CancellationToken ct)
        {
            await FaultAsync();
            return await inner.GetCurrentDatabaseAsync(ct);
        }

        public async Task<IReadOnlyList<string>> ListDatabasesAsync(CancellationToken ct)
        {
            await FaultAsync();
            return await inner.ListDatabasesAsync(ct);
        }

        public Task<IReadOnlyList<SchemaInfo>> ListSchemasAsync(string? database, CancellationToken ct) => inner.ListSchemasAsync(database, ct);
        public Task<string> GetDefaultSchemaAsync(string? database, CancellationToken ct) => inner.GetDefaultSchemaAsync(database, ct);
        public Task<SchemaCatalog> LoadSchemaAsync(string? database, string schema, CancellationToken ct) => inner.LoadSchemaAsync(database, schema, ct);
        public Task<ObjectDetails> GetObjectDetailsAsync(ObjectRef obj, CancellationToken ct) => inner.GetObjectDetailsAsync(obj, ct);
        public Task<DdlResult> GetDdlAsync(ObjectRef obj, CancellationToken ct) => inner.GetDdlAsync(obj, ct);
        public Task<IReadOnlyList<ObjectError>> GetCompileErrorsAsync(ObjectRef obj, CancellationToken ct) => inner.GetCompileErrorsAsync(obj, ct);
        public Task<CatalogObject?> ResolvePublicSynonymAsync(string name, CancellationToken ct) => inner.ResolvePublicSynonymAsync(name, ct);
    }
}

public sealed class DeadEnv : IAsyncDisposable
{
    public string Dir { get; } = Path.Combine(Path.GetTempPath(), "dbstudio-core-tests", Guid.NewGuid().ToString("N"));
    public DeadServerProvider Provider { get; } = new();
    public ConnectionStore Connections { get; }
    public CatalogService Catalog { get; }
    public SessionManager Sessions { get; }
    public ConnectionProfile Profile { get; }

    public DeadEnv(TimeSpan? probe = null, TimeSpan? quick = null, TimeSpan? sessionOpen = null)
    {
        var paths = new AppPaths(Dir);
        var providers = new ProviderRegistry([Provider]);
        Connections = new ConnectionStore(paths, new InMemorySecretStore(), providers);
        var events = new RecordingPublisher();
        var results = new ResultStore();
        Catalog = new CatalogService(providers, Connections, events,
            limits: new CatalogTimeouts(probe ?? TimeSpan.FromMilliseconds(150), quick ?? TimeSpan.FromMilliseconds(300), TimeSpan.FromSeconds(30)));
        Sessions = new SessionManager(providers, Connections, events, results, pingInterval: TimeSpan.FromHours(1))
        {
            OpenTimeout = sessionOpen ?? TimeSpan.FromMilliseconds(300),
        };
        Profile = Connections.Create(new ConnectionProfile
        {
            Name = "dead", ProviderId = "dead",
            Props = new() { ["path"] = Path.Combine(Dir, "a.sqlite"), ["createIfMissing"] = true },
        }, null);
    }

    public async ValueTask DisposeAsync()
    {
        await Sessions.DisposeAsync();
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(Dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public class DeadConnectionTests
{
    [Fact]
    public async Task HangingProbe_TimesOut_ClearsThePool_AndRetriesOnceOnAFreshConnection()
    {
        await using var env = new DeadEnv();
        env.Provider.ReaderFault = n => n == 1 ? new IOException("stale") : null;
        env.Provider.Hangs = n => n == 1;

        var sw = Stopwatch.StartNew();
        var r = await env.Catalog.GetDatabasesAsync(env.Profile.Id, CancellationToken.None);

        Assert.NotEmpty(r.Databases);
        Assert.Equal(2, env.Provider.ReadersOpened);
        Assert.Equal(1, env.Provider.PoolClears);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task SocketError_ClearsThePool_AndRetriesOnce()
    {
        await using var env = new DeadEnv();
        env.Provider.ReaderFault = n => n == 1 ? new IOException("Unable to read data from the transport connection", new SocketException(10054)) : null;

        var r = await env.Catalog.GetSchemasAsync(env.Profile.Id, null, CancellationToken.None);

        Assert.NotEmpty(r.Schemas);
        Assert.Equal(1, env.Provider.PoolClears);
        Assert.Equal(2, env.Provider.ReadersOpened);
    }

    [Fact]
    public async Task ServerThatNeverAnswers_Fails_With503ServerNotReachable_InBoundedTime_AfterOneRetry()
    {
        await using var env = new DeadEnv();
        env.Provider.ReaderFault = _ => new IOException("never thrown");
        env.Provider.Hangs = _ => true;

        var sw = Stopwatch.StartNew();
        var ex = await Assert.ThrowsAsync<EngineException>(() => env.Catalog.GetDatabasesAsync(env.Profile.Id, CancellationToken.None));

        Assert.Equal(503, ex.Status);
        Assert.Equal(ErrorCodes.Unreachable, ex.Code);
        Assert.StartsWith("Server not reachable:", ex.Message);
        Assert.Equal(2, env.Provider.ReadersOpened); // one retry, not a loop
        Assert.Equal(1, env.Provider.PoolClears);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"took {sw.Elapsed}");
    }

    [Fact]
    public async Task RequestAbort_StopsAHangingCall_WithoutRetryOrPoolClear()
    {
        await using var env = new DeadEnv(probe: TimeSpan.FromSeconds(30), quick: TimeSpan.FromSeconds(30));
        env.Provider.ReaderFault = _ => new IOException("x");
        env.Provider.Hangs = _ => true;
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        var sw = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => env.Catalog.GetDatabasesAsync(env.Profile.Id, cts.Token));

        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"took {sw.Elapsed}");
        Assert.Equal(0, env.Provider.PoolClears);
        Assert.Equal(1, env.Provider.ReadersOpened);
        // the connection's cache gate was released: the next call runs
        env.Provider.ReaderFault = null;
        Assert.NotEmpty((await env.Catalog.GetDatabasesAsync(env.Profile.Id, CancellationToken.None)).Databases);
    }

    [Fact]
    public async Task OrdinaryErrors_AreNotRetried()
    {
        await using var env = new DeadEnv();
        env.Provider.ReaderFault = _ => new InvalidOperationException("permission denied");

        await Assert.ThrowsAsync<InvalidOperationException>(() => env.Catalog.GetDatabasesAsync(env.Profile.Id, CancellationToken.None));

        Assert.Equal(1, env.Provider.ReadersOpened);
        Assert.Equal(0, env.Provider.PoolClears);
    }

    [Fact]
    public async Task SessionOpenOnADeadServer_TimesOut_AndALateConnectionIsDisposed()
    {
        await using var env = new DeadEnv();
        env.Provider.SessionGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var ex = await Assert.ThrowsAsync<OperationTimeoutException>(() =>
            env.Sessions.CreateAsync(env.Profile.Id, null, TransactionMode.Auto, false, CancellationToken.None));
        Assert.Contains("did not answer", ex.Message);
        Assert.Empty(env.Sessions.List());

        env.Provider.SessionGate.SetResult(); // the stuck open finishes after all: nobody owns that connection any more
        var until = DateTime.UtcNow.AddSeconds(5);
        while (env.Provider.LateSessionsDisposed == 0 && DateTime.UtcNow < until) await Task.Delay(20);
        Assert.Equal(1, env.Provider.LateSessionsDisposed);
    }
}

public class ConnectionGuardTests
{
    [Fact]
    public async Task Bounded_ReturnsTheResult_OfAFastCall()
    {
        Assert.Equal(7, await ConnectionGuard.BoundedAsync(_ => Task.FromResult(7), TimeSpan.FromSeconds(5), CancellationToken.None));
    }

    [Fact]
    public async Task Bounded_GivesUp_WhenTheDriverIgnoresItsToken_AndCancelsTheToken()
    {
        CancellationToken seen = default;
        var never = new TaskCompletionSource<int>();
        var ex = await Assert.ThrowsAsync<OperationTimeoutException>(() =>
            ConnectionGuard.BoundedAsync(t => { seen = t; return never.Task; }, TimeSpan.FromMilliseconds(50), CancellationToken.None));
        Assert.True(seen.IsCancellationRequested);
        Assert.IsAssignableFrom<TimeoutException>(ex);
        never.SetException(new IOException("late failure is observed, not unobserved"));
    }

    [Fact]
    public async Task Bounded_PropagatesTheCallersCancellation_NotATimeout()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(30));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            ConnectionGuard.BoundedAsync(_ => new TaskCompletionSource<int>().Task, TimeSpan.FromSeconds(30), cts.Token));
    }

    [Fact]
    public void IsBrokenConnection_RecognisesTransportFailures_ButNotOrdinaryOnes()
    {
        Assert.True(ConnectionGuard.IsBrokenConnection(new SocketException(10054)));
        Assert.True(ConnectionGuard.IsBrokenConnection(new InvalidOperationException("wrapped", new IOException("x", new SocketException(10054)))));
        Assert.True(ConnectionGuard.IsBrokenConnection(new TimeoutException()));
        Assert.True(ConnectionGuard.IsBrokenConnection(new IOException("bare"), includeBareIo: true));
        Assert.False(ConnectionGuard.IsBrokenConnection(new IOException("The process cannot access the file")));
        Assert.False(ConnectionGuard.IsBrokenConnection(new FileNotFoundException("x"), includeBareIo: true));
        Assert.False(ConnectionGuard.IsBrokenConnection(new InvalidOperationException("syntax error")));
        Assert.False(ConnectionGuard.IsBrokenConnection(new OperationCanceledException()));
    }

    [Fact]
    public void Unreachable_ReportsTheRootCause()
    {
        var ex = ConnectionGuard.Unreachable(new InvalidOperationException("outer", new IOException("mid", new SocketException(10061))), "pg");
        Assert.Equal(503, ex.Status);
        Assert.Equal(ErrorCodes.Unreachable, ex.Code);
        Assert.StartsWith("Server not reachable: ", ex.Message);
        Assert.DoesNotContain("outer", ex.Message);
    }
}
