using DbStudio.Logs.Sql;

namespace DbStudio.Logs.Monitor;

/// <summary>
/// Reads the server metrics of one provider family (keyed singleton by provider id, like <see cref="ILogSource"/>). One instance
/// serves every connection; it runs a handful of small independent queries on the connection's log session so that one denied
/// view degrades only its own tiles (<see cref="MetricsQueries.TryAsync"/>).
/// </summary>
public interface IMetricsReader
{
    string ProviderId { get; }

    Task<MonitorSnapshot> SnapshotAsync(LogTarget target, CancellationToken ct);
}

/// <summary>Collects the metrics, database sizes and notes of one snapshot.</summary>
public sealed class MetricBag
{
    private readonly List<MonitorMetric> _metrics = [];

    public List<MonitorDatabase> Databases { get; } = [];
    public List<string> Notes { get; } = [];
    public string? Version { get; set; }
    public IReadOnlyList<MonitorMetric> Metrics => _metrics;

    private void Add(MonitorMetric m)
    {
        _metrics.RemoveAll(x => x.Id == m.Id); // a later reading (or its hint) replaces the earlier one
        _metrics.Add(m);
    }

    public void Gauge(string id, string label, double? value, string unit, string group) =>
        Add(new MonitorMetric(id, label, Clean(value), unit, MetricKinds.Gauge, group));

    public void Counter(string id, string label, double? value, string unit, string group) =>
        Add(new MonitorMetric(id, label, Clean(value), unit, MetricKinds.Counter, group));

    /// <summary>A tile the server would not answer: stays on the board with the reason.</summary>
    public void Unavailable(TileDef t, string hint, string? needs) =>
        Add(new MonitorMetric(t.Id, t.Label, null, t.Unit, t.Kind, t.Group, hint, needs));

    public double? ValueOf(string id) => _metrics.FirstOrDefault(m => m.Id == id)?.Value;

    private static double? Clean(double? v) => v is { } d && double.IsFinite(d) ? d : null;

    /// <summary>Percentage of <paramref name="hit"/> in <paramref name="hit"/> + <paramref name="miss"/> (null when nothing was read yet).</summary>
    public static double? Ratio(double? hit, double? miss)
    {
        if (hit is null || miss is null) return null;
        var total = hit.Value + miss.Value;
        return total <= 0 ? null : Math.Round(hit.Value / total * 100, 2);
    }
}

/// <summary>A tile a reader shows; used to keep the board stable when the query that feeds it fails.</summary>
public sealed record TileDef(string Id, string Label, string Unit, string Kind, string Group)
{
    public static TileDef G(string id, string label, string unit, string group) => new(id, label, unit, MetricKinds.Gauge, group);
    public static TileDef C(string id, string label, string unit, string group) => new(id, label, unit, MetricKinds.Counter, group);
}

/// <summary>Shared plumbing of the readers.</summary>
public static class MetricsQueries
{
    /// <summary>
    /// Runs one query; a server error (permission, missing view, unsupported version) turns the <paramref name="tiles"/> it feeds
    /// into hint tiles (or, without tiles, a note naming <paramref name="section"/>) and returns null. Cancellation, a timeout and
    /// connection failures are not swallowed: the whole snapshot fails and the UI shows the connection problem.
    /// </summary>
    public static async Task<SqlRowSet?> TryAsync(ISqlRunner runner, string sql, MetricBag bag, string section, string? needs, CancellationToken ct, params TileDef[] tiles)
    {
        try
        {
            var sets = await runner.QueryAsync(sql, ct).ConfigureAwait(false);
            return sets.Count > 0 ? sets[^1] : SqlRowSet.Of([]);
        }
        catch (SqlQueryException ex)
        {
            Degrade(bag, section, ex, needs, tiles);
            return null;
        }
    }

    public static void Degrade(MetricBag bag, string section, SqlQueryException ex, string? needs, params TileDef[] tiles)
    {
        var hint = Hint(ex);
        if (tiles.Length == 0) bag.Notes.Add($"{section} could not be read: {hint}");
        var denied = LooksDenied(ex);
        foreach (var t in tiles) bag.Unavailable(t, hint, denied ? needs : null);
    }

    public static string Hint(SqlQueryException ex)
    {
        var m = ex.Message.Trim().ReplaceLineEndings(" ");
        return m.Length > 240 ? m[..240] + "…" : m;
    }

    /// <summary>Server errors that read as "permission denied" (the codes differ per provider; the wording does not).</summary>
    public static bool LooksDenied(SqlQueryException ex)
    {
        var m = ex.Message;
        return ex.Code is "42501" or "229" or "230" or "297" or "300" or "1142" or "1227" or "1044" or "497" or "ORA-00942" or "ORA-01031"
            || m.Contains("permission", StringComparison.OrdinalIgnoreCase) || m.Contains("denied", StringComparison.OrdinalIgnoreCase)
            || m.Contains("privilege", StringComparison.OrdinalIgnoreCase) || m.Contains("not authorized", StringComparison.OrdinalIgnoreCase)
            || m.Contains("insufficient", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>First row's value of a column as double, or null.</summary>
    public static double? First(SqlRowSet? rs, string column) => rs is { Rows.Count: > 0 } ? rs.Double(rs.Rows[0], column) : null;

    public static string? FirstText(SqlRowSet? rs, string column) => rs is { Rows.Count: > 0 } ? rs.Str(rs.Rows[0], column) : null;

    /// <summary>A two-column name/value result (SHOW GLOBAL STATUS, v$sysstat, system.metrics) as a case-insensitive map.</summary>
    public static Dictionary<string, double> NameValue(SqlRowSet? rs, string nameColumn, string valueColumn)
    {
        var map = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        if (rs is null) return map;
        foreach (var r in rs.Rows)
            if (rs.Str(r, nameColumn) is { } n && rs.Double(r, valueColumn) is { } v) map[n] = v;
        return map;
    }

    public static double? Get(Dictionary<string, double> map, string name) => map.TryGetValue(name, out var v) ? v : null;

    public static double? Sum(Dictionary<string, double> map, params string[] names)
    {
        double total = 0;
        var any = false;
        foreach (var n in names)
            if (map.TryGetValue(n, out var v)) { total += v; any = true; }
        return any ? total : null;
    }

    /// <summary>Database (or tablespace) sizes, largest first, at most 20.</summary>
    public static void AddSizes(MetricBag bag, SqlRowSet? rs, string nameColumn = "name", string sizeColumn = "size_bytes")
    {
        if (rs is null) return;
        foreach (var r in rs.Rows)
            if (rs.Str(r, nameColumn) is { Length: > 0 } n && rs.Long(r, sizeColumn) is { } s)
                bag.Databases.Add(new MonitorDatabase(n, s));
        bag.Databases.Sort((a, b) => b.SizeBytes.CompareTo(a.SizeBytes));
        if (bag.Databases.Count > 20) bag.Databases.RemoveRange(20, bag.Databases.Count - 20);
    }

    public static MonitorSnapshot Build(string providerId, MetricBag bag) =>
        new(TimeSeq.Iso(DateTimeOffset.UtcNow), providerId, bag.Metrics, bag.Databases, [], bag.Notes) { Version = bag.Version };
}
