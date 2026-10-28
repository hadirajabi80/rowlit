using System.Text.RegularExpressions;
using DbStudio.Core.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DbStudio.Logs.Monitor;

/// <summary>
/// Entry point of the server monitor: dispatches to the provider's keyed <see cref="IMetricsReader"/> and adds the longest
/// running statements from the provider's Activity source (so the monitor shows exactly the rows, and the Kill, of Activity).
/// </summary>
public sealed class MonitorService(Func<string, IMetricsReader?> readers, LogService logs)
{
    public const int TopCount = 10;

    private static readonly Regex Idle = new(@"^(idle|sleeping|inactive|dormant|background)\b|idle in transaction \(aborted\)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static MonitorService FromServices(IServiceProvider sp) => new(id => sp.GetKeyedService<IMetricsReader>(id), sp.GetRequiredService<LogService>());

    /// <summary>The providers a monitor exists for (the UI hides the command for the others).</summary>
    public bool Supports(string providerId) => readers(providerId) is not null;

    public async Task<MonitorSnapshot> SnapshotAsync(string cid, bool includeQueries, CancellationToken ct)
    {
        var target = logs.Target(cid);
        if (target.Profile is null) throw EngineException.Validation("The server monitor needs a database connection.", new { field = "connectionId" });
        var reader = readers(target.ProviderId)
            ?? throw EngineException.Validation($"The server monitor is not available for '{target.Name}'.", new { field = "connectionId" });
        var snap = await LogService.Guard(() => reader.SnapshotAsync(target, ct)).ConfigureAwait(false);
        if (!includeQueries) return snap;

        var notes = snap.Notes.ToList();
        IReadOnlyList<ActivityRow> top = [];
        try
        {
            top = PickTop((await logs.SnapshotAsync(cid, ct).ConfigureAwait(false)).Sessions, TopCount);
        }
        catch (EngineException ex) when (ex.Code is ErrorCodes.Privilege or ErrorCodes.Validation or ErrorCodes.SourceUnavailable or ErrorCodes.ProviderError)
        {
            notes.Add($"Long-running queries are not available: {ex.Message}");
        }
        return snap with { TopQueries = top, Notes = notes };
    }

    /// <summary>Running (not idle) sessions and operations, longest first.</summary>
    public static IReadOnlyList<ActivityRow> PickTop(IEnumerable<ActivityRow> rows, int count) =>
        rows.Where(r => r.Kind is "session" or "op" && r.DurationMs is not null && !Idle.IsMatch(r.State.Trim()) && r.State.Trim().Length > 0)
            .OrderByDescending(r => r.DurationMs)
            .Take(count)
            .ToList();
}

/// <summary>
/// <c>/api/v1/monitor/…</c>:
/// <list type="bullet">
/// <item><c>GET {cid}/snapshot[?queries=false]</c> → <see cref="MonitorSnapshot"/> (counters are cumulative; the UI turns two snapshots into rates).</item>
/// <item><c>GET {cid}/support</c> → <c>{ supported }</c>.</item>
/// </list>
/// </summary>
public static class MonitorEndpoints
{
    public static RouteGroupBuilder MapMonitor(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/monitor/{cid}");
        g.MapGet("/snapshot", async (string cid, bool? queries, MonitorService monitor, CancellationToken ct) =>
            Results.Json(await monitor.SnapshotAsync(cid, queries != false, ct), CoreJson.Options));
        g.MapGet("/support", (string cid, MonitorService monitor, LogService logs) =>
            Results.Json(new MonitorSupport(logs.Target(cid).Profile is { } p && monitor.Supports(p.ProviderId)), CoreJson.Options));
        return api;
    }
}

public sealed record MonitorSupport(bool Supported);
