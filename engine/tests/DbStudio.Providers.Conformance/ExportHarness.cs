using System.Collections.Concurrent;
using DbStudio.Core.Export;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Services;

namespace DbStudio.Providers.Conformance;

/// <summary>
/// The engine's export job over a real provider: the service graph the host builds (connection store, sessions, result
/// store, export service) around one provider and the fixture's profile, in a temp data directory.
/// </summary>
public sealed class ExportHarness : IAsyncDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-export-it", Guid.NewGuid().ToString("N"));
    private readonly Recorder _events = new();
    private readonly ProviderFixture _fixture;
    private readonly HistoryService _history;
    private readonly SessionManager _sessions;
    private readonly ExportService _exports;
    private readonly ConnectionProfile _profile;

    public ExportHarness(ProviderFixture fixture)
    {
        _fixture = fixture;
        Directory.CreateDirectory(_dir);
        var providers = new ProviderRegistry([fixture.Provider]);
        var paths = new AppPaths(_dir);
        var connections = new ConnectionStore(paths, new InMemorySecretStore(), providers);
        _profile = connections.Create(fixture.Profile, fixture.Password);
        var results = new ResultStore();
        _history = new HistoryService(paths);
        _sessions = new SessionManager(providers, connections, _events, results);
        _exports = new ExportService(_sessions, results, _events, history: _history);
    }

    public string PathFor(string name) => Path.Combine(_dir, name);

    /// <summary>Starts the export on a fresh session of the profile and waits for export.done.</summary>
    public async Task<(ExportDoneEvent Done, string Path, SessionHandle Session)> ExportAsync(
        string sql, string format, IReadOnlyList<QueryParam>? parameters = null, ExportOptions? options = null, TimeSpan? timeout = null)
    {
        var h = await _sessions.CreateAsync(_profile.Id, _fixture.Database, TransactionMode.Auto, false, CancellationToken.None);
        var path = PathFor("out" + ExportFormats.Extension(format));
        var id = _exports.StartQueryExport(h.Id, sql, format, path, options ?? new ExportOptions(), parameters);
        var done = await _events.WaitAsync<ExportDoneEvent>(e => e.ExportId == id, timeout ?? TimeSpan.FromSeconds(60));
        return (done, path, h);
    }

    /// <summary>Starts an export without waiting (cancel tests).</summary>
    public async Task<(string ExportId, string Path, SessionHandle Session)> StartAsync(string sql, string format)
    {
        var h = await _sessions.CreateAsync(_profile.Id, _fixture.Database, TransactionMode.Auto, false, CancellationToken.None);
        var path = PathFor("cancel" + ExportFormats.Extension(format));
        return (_exports.StartQueryExport(h.Id, sql, format, path, new ExportOptions()), path, h);
    }

    public Task<T> WaitAsync<T>(Func<T, bool> predicate, TimeSpan timeout) where T : EngineEvent => _events.WaitAsync(predicate, timeout);

    public bool Cancel(SessionHandle h)
    {
        h.Session.Cancel();
        return h.IsReserved;
    }

    public async ValueTask DisposeAsync()
    {
        await _sessions.DisposeAsync();
        _history.Dispose();
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private sealed class Recorder : IEventPublisher
    {
        private readonly ConcurrentQueue<EngineEvent> _all = new();
        private readonly object _gate = new();
        private readonly List<(Func<EngineEvent, bool> Pred, TaskCompletionSource<EngineEvent> Tcs)> _waiters = [];

        public void Publish(EngineEvent ev)
        {
            _all.Enqueue(ev);
            lock (_gate)
                foreach (var w in _waiters.Where(w => w.Pred(ev)).ToList())
                {
                    w.Tcs.TrySetResult(ev);
                    _waiters.Remove(w);
                }
        }

        public async Task<T> WaitAsync<T>(Func<T, bool> predicate, TimeSpan timeout) where T : EngineEvent
        {
            TaskCompletionSource<EngineEvent> tcs;
            lock (_gate)
            {
                var hit = _all.OfType<T>().FirstOrDefault(predicate);
                if (hit is not null) return hit;
                tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
                _waiters.Add((e => e is T t && predicate(t), tcs));
            }
            return (T)await tcs.Task.WaitAsync(timeout);
        }
    }
}
