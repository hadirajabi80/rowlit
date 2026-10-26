using System.Diagnostics;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Runtime;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Federation.Provider;

/// <summary>
/// The <c>linked</c> provider (plan-links 2): a link is a connection (dialect DuckDB) whose session federates its
/// member connections. No connection form (the UI has its own link editor), no connection string; Test validates the
/// definition and reaches every member. The runtime is resolved lazily (the provider registry, which the runtime uses,
/// is built from the providers).
/// </summary>
public sealed class LinkedProvider(IServiceProvider services) : IDbProvider, IObjectBrowserProvider
{
    private LinkRuntime Runtime => services.GetRequiredService<ILinkRuntime>() as LinkRuntime
                                   ?? throw new EngineException(501, ErrorCodes.NotSupported, "Linked databases are not available in this build.");

    public string Id => LinkIds.ProviderId;
    public string DisplayName => "Linked databases";
    public Dialect Dialect => Dialect.DuckDb;
    public ConnectionFormSpec FormSpec { get; } = new([]);
    public IDdlGenerator DdlGenerator => LinkDdlGenerator.Instance;
    public ISqlDiagnostics? Diagnostics => null;
    public IdentifierRules Identifiers { get; } = new('"', '"', "preserve", LinkSql.Reserved);

    public string BuildConnectionString(ConnectionProfile profile, string? password) => "";

    public async Task<TestConnectionResult> TestAsync(ConnectionProfile profile, string? password, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var def = LinkDefinition.FromProfile(profile);
            var result = await Runtime.ValidateAsync(def, string.IsNullOrEmpty(profile.Id) ? null : profile.Id, probe: true, ct).ConfigureAwait(false);
            var unreachable = result.Members.FirstOrDefault(m => m.Reachable == false);
            var problem = result.Problems.FirstOrDefault(p => p.Severity == "error")
                          ?? (unreachable is null ? null : result.Problems.FirstOrDefault(p => p.Code == LinkProblemCodes.MemberUnreachable));
            var info = Runtime.EngineInfo();
            var server = new ServerInfo($"Linked databases ({info.Engine} {info.Version})", info.Version,
                $"{def.Members.Count} member{(def.Members.Count == 1 ? "" : "s")}", null, null);
            if (problem is not null)
            {
                var code = problem.Code == LinkProblemCodes.MemberUnreachable ? ErrorCodes.SourceUnavailable : ErrorCodes.Validation;
                return new TestConnectionResult(false, server, sw.ElapsedMilliseconds, new ErrorInfo(code, problem.Message));
            }
            return new TestConnectionResult(true, server, sw.ElapsedMilliseconds, null);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            var code = e is EngineException ee ? ee.Code : ErrorCodes.EngineError;
            return new TestConnectionResult(false, null, sw.ElapsedMilliseconds, new ErrorInfo(code, e.Message));
        }
    }

    public async Task<IDbSession> OpenSessionAsync(ConnectionProfile profile, string? password, SessionOptions options, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(profile);
        var runtime = Runtime;
        var def = LinkDefinition.FromProfile(profile);
        var context = await runtime.OpenContextAsync(profile.Id, def, options.SessionId, register: true, null, ct).ConfigureAwait(false);
        try
        {
            var engine = context.Engine;
            var label = engine.Name == "duckdb" ? $"DuckDB {engine.Version}" : $"SQLite {engine.Version} (fallback)";
            var server = new ServerInfo(label, engine.Version, "Linked databases", null, null);
            return new FederatedSession(context, profile, options, server);
        }
        catch
        {
            await context.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    public Task<ICatalogReader> OpenCatalogReaderAsync(ConnectionProfile profile, string? password, CancellationToken ct) =>
        Task.FromResult<ICatalogReader>(new LinkCatalogReader(Runtime, profile.Id));

    public Task<IDependencyReader> OpenDependencyReaderAsync(ConnectionProfile profile, string? password, CancellationToken ct) =>
        Task.FromResult<IDependencyReader>(new LinkCatalogReader(Runtime, profile.Id));

    public Task<IObjectListReader> OpenObjectListReaderAsync(ConnectionProfile profile, string? password, CancellationToken ct) =>
        Task.FromResult<IObjectListReader>(new LinkCatalogReader(Runtime, profile.Id));
}
