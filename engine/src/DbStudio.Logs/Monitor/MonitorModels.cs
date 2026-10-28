using System.Text.Json.Serialization;

namespace DbStudio.Logs.Monitor;

// Wire model of the server monitor (WP-12; mirrors ui/src/api/types.monitor.ts). Optional members are omitted when null.

/// <summary>Metric kinds: a gauge is a level (sessions, bytes); a counter only ever grows, the UI turns two snapshots into a rate.</summary>
public static class MetricKinds
{
    public const string Gauge = "gauge", Counter = "counter";
}

/// <summary>Display units. A counter's rate is shown as "unit per second" by the UI.</summary>
public static class MetricUnits
{
    public const string Count = "count", Bytes = "bytes", Percent = "percent", Seconds = "seconds", Millis = "ms";
}

/// <summary>Tile groups, in display order.</summary>
public static class MetricGroups
{
    public const string Sessions = "sessions", Throughput = "throughput", Memory = "memory", Io = "io", Server = "server";
}

/// <summary>
/// One tile. <see cref="Value"/> is null when the server denied the reading (or does not have it): <see cref="Hint"/> says why
/// and <see cref="Needs"/> carries the statement to ask a DBA for, so the tile degrades on its own and the others still work.
/// </summary>
public sealed record MonitorMetric(
    string Id,
    string Label,
    double? Value,
    string Unit,
    string Kind,
    string Group,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Hint = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Needs = null);

public sealed record MonitorDatabase(string Name, long SizeBytes);

/// <param name="TopQueries">The longest running statements (Activity rows, so Kill works on them), longest first.</param>
/// <param name="Notes">Whole-snapshot remarks (a section that could not be read, a server flavour).</param>
public sealed record MonitorSnapshot(
    string At,
    string ProviderId,
    IReadOnlyList<MonitorMetric> Metrics,
    IReadOnlyList<MonitorDatabase> Databases,
    IReadOnlyList<ActivityRow> TopQueries,
    IReadOnlyList<string> Notes)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Version { get; init; }
}
