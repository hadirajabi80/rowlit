using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Import.Parsing;

namespace DbStudio.Federation.Fetchers;

/// <summary>
/// P3 fetcher <see cref="FetcherKeys.Files"/>: local files as link tables (members of kind "files";
/// <see cref="MountedTable.Name"/> = absolute path). Reads through Import's row sources — CSV/TSV, XLSX, JSON/NDJSON with
/// the wizard's type inference over the first <see cref="ImportServiceSample"/> rows — because the federation DuckDB runs
/// with <c>enable_external_access = false</c> (wp0.md, deviation 3). Options: <c>format</c> (csv | tsv | json | ndjson |
/// xlsx; default from the extension), <c>sheet</c>, <c>delimiter</c>, <c>header</c>, <c>encoding</c>, <c>jsonPath</c>,
/// <c>skipRows</c>. Parquet is not supported yet. Files have no server: nothing is pushed except the projection.
/// </summary>
public sealed class FileFetcher : ISourceFetcher
{
    public const int ImportServiceSample = 2000;

    internal static SourceOptions Options(MountedTable table) => Options(table.Name, table.Options);

    internal static SourceOptions Options(string path, JsonObject? o)
    {
        var format = MemberClients.OptionString(o, "format")?.ToLowerInvariant()
            ?? (string.Equals(Path.GetExtension(path), ".parquet", StringComparison.OrdinalIgnoreCase) ? "parquet" : SourceOptions.FormatOf(path) ?? "csv");
        if (format == "parquet") throw new NotSupportedException("Parquet files cannot be linked yet (convert the file to CSV or JSON).");
        if (format is not ("csv" or "tsv" or "json" or "ndjson" or "xlsx")) throw new NotSupportedException($"Unsupported file format '{format}'.");
        var opts = new SourceOptions
        {
            Format = format,
            Sheet = MemberClients.OptionString(o, "sheet"),
            Delimiter = o?["delimiter"] is JsonValue dv && dv.TryGetValue<string>(out var delim) && delim.Length > 0 ? delim : null,
            Encoding = MemberClients.OptionString(o, "encoding"),
            JsonPath = MemberClients.OptionString(o, "jsonPath"),
            SkipRows = MemberClients.OptionInt(o, "skipRows", 0, 0, 1_000_000),
        };
        if (o?["header"] is JsonValue hv && hv.TryGetValue<bool>(out var header)) opts.HasHeader = header;
        var resolved = RowSources.Resolve(path, opts);
        if (resolved.Format == "xlsx" && string.IsNullOrWhiteSpace(resolved.Sheet))
        {
            var sheets = XlsxRowSource.SheetNames(path);
            if (sheets.Count > 0) resolved.Sheet = sheets[0];
        }
        resolved.HasHeader ??= true;
        if (resolved.Format is "csv" or "tsv") resolved.Quote ??= "\"";
        return resolved;
    }

    public Task<SourceCatalog> LoadCatalogAsync(SourceContext context, CancellationToken ct) => Task.Run(() =>
    {
        var tables = new List<SourceTable>();
        var warnings = new List<string>();
        foreach (var mt in context.Member.Tables)
        {
            ct.ThrowIfCancellationRequested();
            if (!Path.IsPathFullyQualified(mt.Name)) { warnings.Add($"{mt.Name}: the path must be absolute."); continue; }
            if (!File.Exists(mt.Name)) { warnings.Add($"File not found: {mt.Name}"); continue; }
            try
            {
                var opts = Options(mt);
                using var source = RowSources.Open(mt.Name, opts);
                var parser = new ValueParser(opts);
                var profilers = source.Columns.Select(_ => new ColumnProfiler(parser)).ToArray();
                var n = 0;
                var more = false;
                while (source.Read())
                {
                    if (n >= ImportServiceSample) { more = true; break; }
                    var cur = source.Current;
                    for (var i = 0; i < profilers.Length && i < cur.Length; i++) profilers[i].Add(cur[i]);
                    n++;
                }
                var columns = source.Columns.Select((name, i) =>
                {
                    var t = profilers[i].Infer(more);
                    return new SourceColumn(name, TypeText(t), KindOf(t.Kind), t.Nullable, Precision: t.Precision, Scale: t.Scale, Size: t.Length);
                }).ToList();
                warnings.AddRange(source.Warnings.Select(w => $"{Path.GetFileName(mt.Name)}: {w}"));
                tables.Add(new SourceTable(mt.Name, mt.LinkName, null, null, "file", columns, [], [], more ? null : n, mt.Options));
            }
            catch (Exception e) when (e is NotSupportedException or InvalidDataException or IOException or JsonException or ArgumentException or System.Xml.XmlException)
            {
                warnings.Add($"{Path.GetFileName(mt.Name)}: {e.Message}");
            }
        }
        return new SourceCatalog(tables, warnings);
    }, ct);

    internal static string KindOf(string importKind) => importKind switch
    {
        Kinds.Int or Kinds.BigInt => ColumnKinds.Int,
        Kinds.Decimal => ColumnKinds.Decimal,
        Kinds.Float => ColumnKinds.Float,
        Kinds.Bool => ColumnKinds.Bool,
        Kinds.Date => ColumnKinds.Date,
        Kinds.DateTime => ColumnKinds.DateTime,
        Kinds.Time => ColumnKinds.Time,
        Kinds.Guid => ColumnKinds.Guid,
        Kinds.Json => ColumnKinds.Json,
        _ => ColumnKinds.String,
    };

    private static string TypeText(InferredType t) => t.Kind switch
    {
        Kinds.Decimal => string.Create(CultureInfo.InvariantCulture, $"decimal({t.Precision ?? 18},{t.Scale ?? 2})"),
        Kinds.Text => t.Length is { } l ? string.Create(CultureInfo.InvariantCulture, $"text({l})") : "text",
        _ => t.Kind,
    };

    public FetchRequest Accept(SourceContext context, FetchRequest proposed) => MemberClients.Keep(proposed, []);

    public string Describe(SourceContext context, FetchRequest request)
    {
        var format = request.Table.Options is { } o ? MemberClients.OptionString(o, "format") : null;
        format ??= SourceOptions.FormatOf(request.Table.Name) ?? "csv";
        var limit = request.Limit is { } l ? string.Create(CultureInfo.InvariantCulture, $", first {l} rows") : "";
        return $"read {format} {request.Table.Name} (columns {string.Join(", ", request.Columns)}{limit})";
    }

    public Task<FetchResult> FetchAsync(SourceContext context, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct) => Task.Run(() =>
    {
        var sw = Stopwatch.StartNew();
        var path = request.Table.Name;
        try
        {
            var opts = Options(path, request.Table.Options);
            using var source = RowSources.Open(path, opts);
            var parser = new ValueParser(opts);
            var converter = new CellConverter(parser);
            var index = request.Columns.Select(c => IndexOf(source.Columns, c)).ToArray();
            var kinds = request.Columns.Select(c => ImportKind(request.Table.Columns.FirstOrDefault(x => x.Name == c)?.Kind)).ToArray();
            var row = new object?[request.Columns.Count];
            var cap = Math.Min(request.Limit ?? long.MaxValue, request.MaxRows);
            long rows = 0, failures = 0;
            var truncated = false;
            while (source.Read())
            {
                ct.ThrowIfCancellationRequested();
                if (rows >= cap)
                {
                    truncated = rows >= request.MaxRows;
                    break;
                }
                var cur = source.Current;
                for (var i = 0; i < row.Length; i++)
                {
                    var raw = index[i] >= 0 && index[i] < cur.Length ? cur[index[i]] : null;
                    try { row[i] = raw is null ? null : converter.Convert(raw, kinds[i]); }
                    catch (ValueConversionException) { row[i] = null; failures++; }
                }
                target.AppendRow(row);
                rows++;
                if (rows % 5000 == 0) progress?.Report(rows);
            }
            progress?.Report(rows);
            return new FetchResult(rows, truncated, Describe(context, request), sw.ElapsedMilliseconds, failures + target.ConversionFailures,
                source.Warnings.Count > 0 ? source.Warnings.ToList() : null);
        }
        catch (Exception e) when (e is NotSupportedException or InvalidDataException or IOException or JsonException or ArgumentException or System.Xml.XmlException)
        {
            throw new FetchException(context.Member.Alias, request.Table.LinkName, e.Message, e);
        }
    }, ct);

    private static int IndexOf(IReadOnlyList<string> columns, string name)
    {
        for (var i = 0; i < columns.Count; i++) if (columns[i] == name) return i;
        for (var i = 0; i < columns.Count; i++) if (string.Equals(columns[i], name, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    private static string ImportKind(string? columnKind) => columnKind switch
    {
        ColumnKinds.Int => Kinds.BigInt,
        ColumnKinds.Decimal => Kinds.Decimal,
        ColumnKinds.Float => Kinds.Float,
        ColumnKinds.Bool => Kinds.Bool,
        ColumnKinds.Date => Kinds.Date,
        ColumnKinds.DateTime => Kinds.DateTime,
        ColumnKinds.Time => Kinds.Time,
        ColumnKinds.Guid => Kinds.Guid,
        ColumnKinds.Json => Kinds.Json,
        _ => Kinds.Text,
    };
}
