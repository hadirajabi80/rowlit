using System.Text.Json;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.Transfer;

/// <summary>The engine's connections, providers and designer features as the transfer sees them.</summary>
public sealed class EngineTransferEnvironment(ConnectionStore connections, ProviderRegistry providers, ProviderFeatures features) : ITransferEnvironment
{
    public ProviderFeatures Features { get; } = features;

    public TransferConnection Resolve(string connectionId)
    {
        var profile = connections.WithSecrets(connections.Get(connectionId));
        var provider = providers.Find(profile.ProviderId)
                       ?? throw EngineException.Validation($"The connection '{profile.Name}' ({profile.ProviderId}) is not a relational database.", new { field = "connectionId" });
        return new TransferConnection(profile, connections.GetPassword(connectionId), provider);
    }

    public IDbProvider? FindProvider(string providerId) => providers.Find(providerId);
}

/// <summary>Type list of a target provider for the type pickers of the wizard.</summary>
public sealed record TransferTypesInfo(string Provider, string Dialect, IReadOnlyList<DesignerType> Types);

/// <summary>
/// Data Transfer (Navicat's "Data Transfer"): copies tables with or without data between connections of any relational
/// provider, or writes them as a .sql script. <see cref="PlanAsync"/> previews the type mapping and the target DDL,
/// <see cref="RunAsync"/> executes it (run as a <see cref="JobManager"/> job by the module's endpoints).
/// </summary>
public sealed class TransferService(ITransferEnvironment env, ILogger<TransferService>? log = null)
{
    public async Task<TransferPlan> PlanAsync(TransferSpec spec, CancellationToken ct) =>
        (await new TransferPlanner(env).PlanAsync(spec, ct).ConfigureAwait(false)).Wire;

    /// <summary>
    /// Providers rows can be written into (live or as a .sql dump). Everything else that is relational (Snowflake,
    /// Cassandra/ScyllaDB ...) is a source only.
    /// </summary>
    public static readonly IReadOnlyList<string> TargetProviders = ["sqlserver", "postgresql", "mysql", "mariadb", "sqlite", "oracle", "clickhouse"];

    public static bool IsTargetProvider(string? providerId) =>
        providerId is not null && TargetProviders.Contains(providerId, StringComparer.OrdinalIgnoreCase);

    /// <summary>Checks everything that can be refused before a job starts (400 / 403 / 404).</summary>
    public void Check(TransferSpec spec)
    {
        if (spec?.Source is null || string.IsNullOrWhiteSpace(spec.Source.ConnectionId)) throw EngineException.Validation("source.connectionId is required.", new { field = "source.connectionId" });
        if (spec.Target is null) throw EngineException.Validation("target is required.", new { field = "target" });
        if (spec.Tables is null || spec.Tables.Count == 0) throw EngineException.Validation("Pick at least one table.", new { field = "tables" });
        env.Resolve(spec.Source.ConnectionId);
        if (spec.Target.IsFile)
        {
            if (string.IsNullOrWhiteSpace(spec.Target.DumpProvider) || env.FindProvider(spec.Target.DumpProvider) is null)
                throw EngineException.Validation("target.dumpProvider must name a relational provider.", new { field = "target.dumpProvider" });
            if (!IsTargetProvider(spec.Target.DumpProvider))
                throw EngineException.Validation($"A SQL file cannot be written for {env.FindProvider(spec.Target.DumpProvider)!.DisplayName}.", new { field = "target.dumpProvider" });
        }
        else
        {
            if (string.IsNullOrWhiteSpace(spec.Target.ConnectionId)) throw EngineException.Validation("target.connectionId is required.", new { field = "target.connectionId" });
            var t = env.Resolve(spec.Target.ConnectionId);
            if (t.Profile.ReadOnly) throw EngineException.ReadOnly(t.Profile.Name, "data transfer");
            if (!IsTargetProvider(t.Provider.Id))
                throw EngineException.Validation($"{t.Provider.DisplayName} can be a data transfer source only.", new { field = "target.connectionId" });
        }
    }

    /// <summary>What the connection can be in a transfer; never throws for an existing connection.</summary>
    public TransferSupport Support(string connectionId)
    {
        if (string.IsNullOrWhiteSpace(connectionId)) throw EngineException.Validation("connectionId is required.", new { field = "connectionId" });
        TransferConnection c;
        try
        {
            c = env.Resolve(connectionId);
        }
        catch (EngineException ex) when (ex.Status == 400)
        {
            return new TransferSupport(connectionId, "", null, false, false, ex.Message);
        }
        var dialect = CoreJson.ToWire(c.Provider.Dialect);
        string? reason = null;
        var asTarget = true;
        if (!IsTargetProvider(c.Provider.Id))
        {
            asTarget = false;
            reason = $"{c.Provider.DisplayName} can be a source only: rows cannot be written into it.";
        }
        else if (c.Profile.ReadOnly)
        {
            asTarget = false;
            reason = "The connection is read-only.";
        }
        else
        {
            try { env.Features.Scripter(c.Provider.Id); }
            catch (EngineException)
            {
                asTarget = false;
                reason = $"{c.Provider.DisplayName} has no DDL support here.";
            }
        }
        return new TransferSupport(connectionId, c.Provider.Id, dialect, true, asTarget, reason);
    }

    /// <summary>Dialects a .sql dump can be written in.</summary>
    public IReadOnlyList<DumpDialect> DumpDialects() =>
        TargetProviders.Select(env.FindProvider).OfType<IDbProvider>()
            .Select(p => new DumpDialect(p.Id, p.DisplayName, CoreJson.ToWire(p.Dialect))).ToList();

    public async Task<TransferResult> RunAsync(TransferSpec spec, Action<TransferProgress, long, long?>? progress, CancellationToken ct)
    {
        var plan = await new TransferPlanner(env).PlanAsync(spec, ct).ConfigureAwait(false);
        if (!plan.Options.ContinueOnError)
        {
            var bad = plan.Tables.FirstOrDefault(t => t.Planned.Error is not null);
            if (bad is not null)
                throw EngineException.Validation($"{bad.Planned.SourceName}: {bad.Planned.Error}", new { field = "tables", table = bad.Planned.SourceName });
        }
        return await new TransferRunner(env, log).RunAsync(plan, spec, progress, ct).ConfigureAwait(false);
    }

    /// <summary>Types the target provider accepts (for the type pickers).</summary>
    public async Task<TransferTypesInfo> TargetTypesAsync(string providerId, string? connectionId, CancellationToken ct)
    {
        var provider = env.FindProvider(providerId) ?? throw EngineException.Validation($"Unknown provider '{providerId}'.", new { field = "provider" });
        var scripter = env.Features.Scripter(provider.Id);
        var ctx = DdlScriptContext.Default;
        if (!string.IsNullOrWhiteSpace(connectionId))
        {
            try
            {
                var c = env.Resolve(connectionId);
                ctx = await env.Features.Database(c.Provider.Id).GetScriptContextAsync(c.Profile, c.Password, null, null, null, ct).ConfigureAwait(false);
            }
            catch (EngineException) { /* defaults */ }
        }
        return new TransferTypesInfo(provider.Id, CoreJson.ToWire(provider.Dialect), scripter.GetTypes(ctx).Types);
    }

    /// <summary>Progress as the JSON the job.progress message carries.</summary>
    public static string ProgressJson(TransferProgress p) => JsonSerializer.Serialize(p, CoreJson.Options);
}
