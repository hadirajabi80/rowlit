using System.Text.RegularExpressions;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import;

/// <summary>Import Wizard backend: file preview with type inference, target capabilities, table info, CREATE TABLE preview and the import job.</summary>
public sealed class ImportService(ConnectionStore connections, ProviderRegistry providers, CatalogService catalog, JobManager jobs, AppPaths paths,
    IServiceProvider services, ILogger<ImportService> log)
{
    public const int InferenceSampleRows = 2000;
    public const string JobKind = "import.run";

    public string ReportDirectory => Path.Combine(paths.DataDir, "import-reports");

    private static readonly Regex JalaliLike = new(@"^\s*1[234]\d\d[/\-.]\d{1,2}[/\-.]\d{1,2}", RegexOptions.Compiled);

    // ------------------------------------------------------------------ preview

    public Task<PreviewResult> PreviewAsync(PreviewRequest request, CancellationToken ct) =>
        Task.Run(() => Preview(request, ct), ct);

    private static PreviewResult Preview(PreviewRequest request, CancellationToken ct)
    {
        var path = request.Path?.Trim().Trim('"') ?? "";
        if (path.Length == 0) throw EngineException.Validation("path is required.", new { field = "path" });
        if (!File.Exists(path)) throw EngineException.Validation($"File not found: {path}", new { field = "path" });
        var info = new FileInfo(path);
        var opts = request.Options?.Clone() ?? new SourceOptions();
        if (string.IsNullOrWhiteSpace(opts.Format)) opts.Format = SourceOptions.FormatOf(path) ?? "csv";
        opts.Format = opts.Format.ToLowerInvariant();
        var maxRows = Math.Clamp(request.MaxRows ?? 100, 1, 1000);
        var offset = Math.Max(0, request.Offset ?? 0);

        IReadOnlyList<string>? sheets = null, jsonPaths = null;
        var warnings = new List<string>();
        try
        {
            if (opts.Format == "xlsx") sheets = XlsxRowSource.SheetNames(path);
            if (opts.Format == "json") jsonPaths = JsonRowSource.FindArrayPaths(path, RowSources.Resolve(path, opts));
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException)
        {
            throw EngineException.Validation(ex.Message, new { field = "path" });
        }

        SourceOptions effective;
        try { effective = RowSources.Resolve(path, opts); }
        catch (ArgumentException ex) { throw EngineException.Validation(ex.Message, new { field = "options" }); }
        if (effective.Format == "xlsx" && string.IsNullOrWhiteSpace(effective.Sheet) && sheets is { Count: > 0 }) effective.Sheet = sheets[0];
        effective.HasHeader ??= true;
        effective.SkipRows ??= 0;
        effective.Trim ??= false;
        effective.NullTokens ??= [.. SourceOptions.DefaultNullTokens];
        effective.DecimalSeparator ??= ".";
        effective.ThousandsSeparator ??= "";
        effective.NormalizeDigits ??= true;
        if (effective.Format is "csv" or "tsv") { effective.Quote ??= "\""; }

        IRowSource source;
        try { source = RowSources.Open(path, effective); }
        catch (Exception ex) when (ex is InvalidDataException or System.Text.Json.JsonException or ArgumentException or System.Xml.XmlException)
        {
            throw EngineException.Validation(ex.Message, new { field = "options" });
        }
        using (source)
        {
            var parser = new ValueParser(effective);
            var profilers = source.Columns.Select(_ => new ColumnProfiler(parser)).ToArray();
            var rows = new List<IReadOnlyList<string?>>();
            var firstTexts = new string?[source.Columns.Count];
            long sampled = 0;
            var more = false;
            var hasNext = false;
            try
            {
                long index = 0;
                while (source.Read())
                {
                    ct.ThrowIfCancellationRequested();
                    if (index >= InferenceSampleRows && rows.Count >= maxRows) { more = true; hasNext = true; break; }
                    var cur = source.Current;
                    if (index < InferenceSampleRows)
                    {
                        sampled++;
                        for (var i = 0; i < profilers.Length && i < cur.Length; i++)
                        {
                            profilers[i].Add(cur[i]);
                            if (cur[i] is string s && firstTexts[i] is null && s.Length > 0) firstTexts[i] = s;
                        }
                    }
                    else more = true;
                    if (index >= offset)
                    {
                        if (rows.Count < maxRows) rows.Add(cur.Select(Display).ToList());
                        else hasNext = true;
                    }
                    index++;
                }
            }
            catch (Exception ex) when (ex is System.Text.Json.JsonException or InvalidDataException or System.Xml.XmlException)
            {
                throw EngineException.Validation("The file could not be read: " + ex.Message, new { field = "path" });
            }
            var columns = source.Columns.Select((name, i) => new PreviewColumn(i, name, profilers[i].Infer(more))).ToList();
            foreach (var c in columns)
                if (c.Inferred.Kind is Kinds.Date or Kinds.DateTime && firstTexts[c.Index] is { } txt && JalaliLike.IsMatch(txt))
                    warnings.Add($"Column '{c.Name}' looks like Persian (Jalali) dates ({txt}); they would be read as Gregorian years. Import the column as text or convert it first.");
            warnings.AddRange(source.Warnings);
            if (columns.Count == 0) warnings.Add("No columns were found. Check the delimiter, header row and skipped rows.");
            return new PreviewResult(path, info.Name, info.Length, effective, sheets, jsonPaths, columns, rows, sampled, more, warnings, offset, hasNext);
        }
    }

    private static string? Display(object? v)
    {
        if (v is null) return null;
        var s = v is string str ? str : CellConverter.Text(v);
        return s.Length > 500 ? s[..500] + "..." : s;
    }

    // ------------------------------------------------------------------ target

    private (ConnectionProfile Profile, IDbProvider Provider, ImportDialect Dialect, string? Password) Resolve(string connectionId)
    {
        var profile = connections.WithSecrets(connections.Get(connectionId));
        var provider = providers.Find(profile.ProviderId)
                       ?? throw EngineException.Validation($"'{profile.Name}' is not a relational connection; import needs a table to write to.", new { field = "cid" });
        if (provider.Dialect == Dialect.Cql)
            throw EngineException.Validation("Importing files into Cassandra is not supported yet.", new { field = "cid" });
        return (profile, provider, ImportDialect.For(provider.Dialect, provider.Id), connections.GetPassword(connectionId));
    }

    public ImportCapabilitiesDto Capabilities(string connectionId)
    {
        var profile = connections.WithSecrets(connections.Get(connectionId));
        var provider = providers.Find(profile.ProviderId);
        if (provider is null || provider.Dialect == Dialect.Cql)
            return new ImportCapabilitiesDto(profile.ProviderId, provider is null ? "none" : CoreJson.ToWire(provider.Dialect), false,
                provider is null ? "Only relational connections can be imported into." : "Importing files into Cassandra is not supported yet.",
                profile.ReadOnly, [], false, false, "", 0, 0, []);
        var d = ImportDialect.For(provider.Dialect, provider.Id);
        var canImport = !profile.ReadOnly;
        return new ImportCapabilitiesDto(provider.Id, CoreJson.ToWire(provider.Dialect), canImport,
            canImport ? null : $"The connection '{profile.Name}' is read-only: importing data is not allowed.", profile.ReadOnly,
            d.Modes, true, d.Transactional, d.BulkMethod, d.DefaultBatchSize, d.MaxIdentifierLength, d.SqlTypes);
    }

    public async Task<TargetTableInfo> TableInfoAsync(string connectionId, TableRefDto table, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(table.Table)) throw EngineException.Validation("table is required.", new { field = "table" });
        var (_, _, dialect, _) = Resolve(connectionId);
        var (info, _) = await TargetInfoReader.ReadAsync(catalog, connectionId, dialect, table.Database, table.Schema, table.Table, ct).ConfigureAwait(false);
        return info;
    }

    public DdlPreview Ddl(string connectionId, DdlRequest request)
    {
        var (_, _, d, _) = Resolve(connectionId);
        if (string.IsNullOrWhiteSpace(request.Table)) throw EngineException.Validation("table is required.", new { field = "table" });
        if (request.Columns.Count == 0) throw EngineException.Validation("At least one column is required.", new { field = "columns" });
        var warnings = new List<string>();
        var pkSet = new HashSet<string>((request.PrimaryKey ?? []).Select(d.Fold), StringComparer.OrdinalIgnoreCase);
        var specs = new List<NewColumnSpec>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in request.Columns)
        {
            if (string.IsNullOrWhiteSpace(c.Name)) throw EngineException.Validation("Column names cannot be empty.", new { field = "columns" });
            var name = d.Fold(c.Name);
            if (!seen.Add(name)) throw EngineException.Validation($"Column '{name}' appears twice.", new { field = "columns", column = name });
            var type = string.IsNullOrWhiteSpace(c.SqlType) ? d.SqlType(c.Inferred) : c.SqlType!.Trim();
            var nullable = (c.Nullable ?? true) && !pkSet.Contains(name);
            if (name.Length > d.MaxIdentifierLength) warnings.Add($"Column name '{name}' is longer than {d.MaxIdentifierLength} characters.");
            if (pkSet.Contains(name) && Regex.IsMatch(type, @"\b(max|text|clob|blob|json|jsonb|xml)\b", RegexOptions.IgnoreCase))
                warnings.Add($"Primary key column '{name}' has the type {type}, which most databases cannot index.");
            specs.Add(new NewColumnSpec(name, type, nullable));
        }
        var table = d.Fold(request.Table);
        if (table.Length > d.MaxIdentifierLength) warnings.Add($"Table name '{table}' is longer than {d.MaxIdentifierLength} characters.");
        var pk = specs.Where(s => pkSet.Contains(s.Name)).Select(s => s.Name).ToList();
        if (d.Dialect == Dialect.ClickHouse && pk.Count == 0) warnings.Add("No sort key chosen: the MergeTree table is created with ORDER BY tuple().");
        var ddl = d.CreateTable(d.Qualify(request.Database, request.Schema, table), specs, pk);
        return new DdlPreview(ddl, specs.Select(s => new DdlColumn(s.Name, s.SqlType)).ToList(), warnings);
    }

    // ------------------------------------------------------------------ run

    public string Start(string connectionId, ImportRequest request, string? ownerClientId)
    {
        var (profile, provider, dialect, password) = Resolve(connectionId);
        if (profile.ReadOnly) throw EngineException.ReadOnly(profile.Name, "import");
        if (string.IsNullOrWhiteSpace(request.Path) || !File.Exists(request.Path.Trim().Trim('"')))
            throw EngineException.Validation($"File not found: {request.Path}", new { field = "path" });
        request.Path = request.Path.Trim().Trim('"');
        if (string.IsNullOrWhiteSpace(request.Source.Format)) request.Source.Format = SourceOptions.FormatOf(request.Path) ?? "csv";
        if (!dialect.Modes.Contains(request.Mode))
            throw EngineException.Validation($"Import mode '{request.Mode}' is not supported for {provider.DisplayName}.", new { field = "mode" });
        if (request.Columns.Count == 0) throw EngineException.Validation("No columns are mapped.", new { field = "columns" });
        if (string.IsNullOrWhiteSpace(request.Target.Table)) throw EngineException.Validation("The target table is required.", new { field = "target.table" });
        if (request.Mode is "upsert" or "updateOnly" && request.KeyColumns is not { Count: > 0 })
            throw EngineException.Validation("Key columns are required for this import mode.", new { field = "keyColumns" });
        if (request.Target.Create && request.Mode != "append")
            request.Mode = "append"; // a new table is empty: every mode is an insert

        var rc = new ImportRunContext(request, connectionId, profile, provider, password, dialect, services, catalog, ReportDirectory, log);
        connections.Touch(connectionId);
        return jobs.Start(JobKind, connectionId, ownerClientId, async (ctx, ct) => await ImportRunner.RunAsync(rc, ctx, ct).ConfigureAwait(false));
    }

    public string? ErrorReportPath(string jobId)
    {
        var path = ErrorReport.PathFor(ReportDirectory, jobId);
        return File.Exists(path) ? path : null;
    }
}
