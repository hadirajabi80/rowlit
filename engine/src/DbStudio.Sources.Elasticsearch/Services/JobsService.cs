using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Services;

namespace DbStudio.Sources.Elasticsearch.Services;

/// <summary>
/// Long operations run as <see cref="JobManager"/> jobs: reindex (server-side task, progress polled from <c>_tasks</c>),
/// import (<c>_bulk</c> in chunks from NDJSON / JSON / CSV) and export (scroll → NDJSON / JSON / CSV).
/// </summary>
public sealed class JobsService
{
    /// <summary>A <c>_bulk</c> request is cut at this many bytes even below the batch size.</summary>
    public const int MaxBulkBytes = 5 * 1024 * 1024;

    public const int MaxErrors = 20;

    /// <summary>How often a running reindex task is polled (tests shorten it).</summary>
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(500);

    // ---------------------------------------------------------------- reindex

    public static (JsonObject Body, string Query) ReindexBody(EsReindexRequest? req)
    {
        var source = EsNames.Target(req?.Source, "source");
        var dest = EsNames.Index(req?.Dest, "dest");
        if (string.Equals(source, dest, StringComparison.Ordinal)) throw EngineException.Validation("The destination must differ from the source.", new { field = "dest" });
        var src = new JsonObject { ["index"] = new JsonArray(source.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(s => (JsonNode?)s).ToArray()) };
        if (EsJson.UnwrapQuery(EsJson.Node(req!.Query)) is { } q)
        {
            if (q is not JsonObject) throw EngineException.Validation("query must be a query DSL object.", new { field = "query" });
            src["query"] = q;
        }
        var body = new JsonObject { ["source"] = src, ["dest"] = new JsonObject { ["index"] = dest } };
        var conflicts = req.Conflicts?.Trim().ToLowerInvariant();
        if (conflicts is not (null or "" or "abort" or "proceed")) throw EngineException.Validation("conflicts is 'abort' or 'proceed'.", new { field = "conflicts" });
        if (conflicts is "proceed") body["conflicts"] = "proceed";
        if (req.MaxDocs is { } max)
        {
            if (max < 1) throw EngineException.Validation("maxDocs must be ≥ 1.", new { field = "maxDocs" });
            body["max_docs"] = max;
        }
        if (!string.IsNullOrWhiteSpace(req.Script)) body["script"] = new JsonObject { ["source"] = req.Script, ["lang"] = "painless" };
        var query = new List<string> { "wait_for_completion=false", "refresh=true" };
        if (req.Slices is { } slices)
        {
            if (slices is < 1 or > 64) throw EngineException.Validation("slices must be between 1 and 64.", new { field = "slices" });
            query.Add($"slices={slices}");
        }
        return (body, string.Join('&', query));
    }

    public async Task<EsReindexResult> ReindexAsync(EsClient c, EsReindexRequest? req, JobContext? job, CancellationToken ct)
    {
        var (body, query) = ReindexBody(req);
        var started = await c.Transport.JsonAsync(HttpMethod.Post, $"_reindex?{query}", body, ct).ConfigureAwait(false);
        var taskId = started.Str("task") ?? throw new EngineException(422, ErrorCodes.ProviderError, "Elasticsearch did not return a reindex task.");
        job?.Report(0, null, $"Task {taskId} started", force: true);
        var sw = Stopwatch.StartNew();
        try
        {
            while (true)
            {
                await Task.Delay(PollInterval, ct).ConfigureAwait(false);
                var t = await c.Transport.GetAsync($"_tasks/{taskId}", ct).ConfigureAwait(false);
                var status = t.Path("task.status") ?? default;
                var done = (status.Long("created") ?? 0) + (status.Long("updated") ?? 0) + (status.Long("deleted") ?? 0) + (status.Long("version_conflicts") ?? 0);
                var total = status.Long("total");
                var completed = t.Bool("completed") == true;
                job?.Report(done, total is > 0 ? total : null, $"{done:N0} of {(total ?? 0):N0} documents", force: completed);
                if (!completed) continue;
                if (t.Prop("error") is { } err)
                {
                    var type = err.Str("type");
                    var reason = err.Str("reason");
                    throw new EngineException(422, ErrorCodes.ProviderError, type is null ? reason ?? "Reindex failed." : $"{type}: {reason}",
                        new EsErrorDetail(500, type, null));
                }
                var r = t.Prop("response") ?? status;
                var failures = r.Prop("failures").Items().Take(MaxErrors).Select(f =>
                    f.Prop("cause") is { } cause ? $"{f.Str("id") ?? f.Str("index") ?? "?"}: {cause.Str("type")}: {cause.Str("reason")}" : f.GetRawText()).ToList();
                return new EsReindexResult(taskId, r.Long("total") ?? total ?? 0, r.Long("created") ?? 0, r.Long("updated") ?? 0, r.Long("deleted") ?? 0,
                    r.Long("version_conflicts") ?? 0, failures, r.Long("took") ?? sw.ElapsedMilliseconds);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            try
            {
                using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await c.Transport.JsonAsync(HttpMethod.Post, $"_tasks/{taskId}/_cancel", null, cancel.Token).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is EngineException or OperationCanceledException) { /* best effort */ }
            throw;
        }
    }

    // ---------------------------------------------------------------- import

    public sealed record ImportPlan(string Index, string Format, string? Path, string? Upload, string? IdField, int BatchSize, string? Pipeline, char Delimiter, bool Header);

    public static ImportPlan ParseImport(EsImportRequest? req)
    {
        var index = EsNames.Index(req?.Index, "index");
        var format = Format(req?.Format);
        var path = string.IsNullOrWhiteSpace(req?.Path) ? null : req!.Path!.Trim();
        if (path is null && req?.Upload is null) throw EngineException.Validation("Give a file path or the file content (upload).", new { field = "path" });
        if (path is not null && !File.Exists(path)) throw EngineException.Validation($"The file '{path}' does not exist.", new { field = "path" });
        var batch = req!.BatchSize ?? 1000;
        if (batch is < 1 or > 50_000) throw EngineException.Validation("batchSize must be between 1 and 50,000.", new { field = "batchSize" });
        var delimiter = req.Csv?.Delimiter is { Length: > 0 } d ? (d == "\\t" ? '\t' : d[0]) : ',';
        var pipeline = string.IsNullOrWhiteSpace(req.Pipeline) ? null : req.Pipeline.Trim();
        return new ImportPlan(index, format, path, path is null ? req.Upload : null, string.IsNullOrWhiteSpace(req.IdField) ? null : req.IdField.Trim(), batch,
            pipeline, delimiter, req.Csv?.Header ?? true);
    }

    internal static string Format(string? f) => (f ?? "ndjson").Trim().ToLowerInvariant() switch
    {
        "ndjson" or "jsonl" or "json-lines" => "ndjson",
        "json" => "json",
        "csv" => "csv",
        var other => throw EngineException.Validation($"Unknown format '{other}' (ndjson, json, csv).", new { field = "format" }),
    };

    /// <summary>One document to index: its source, optional _id (from idField, or an export with metadata / bulk action line).</summary>
    public sealed record ImportDoc(JsonObject Source, string? Id);

    public async Task<EsImportResult> ImportAsync(EsClient c, ImportPlan plan, JobContext? job, CancellationToken ct)
    {
        c.EnsureWritable("import documents");
        var sw = Stopwatch.StartNew();
        long indexed = 0, failed = 0, read = 0;
        var errors = new List<string>();
        var bulk = new MemoryStream();
        var inBatch = 0;
        var q = new List<string> { "refresh=false" };
        if (plan.Pipeline is not null) q.Add($"pipeline={Uri.EscapeDataString(plan.Pipeline)}");
        var bulkPath = $"{EsTransport.Seg(plan.Index)}/_bulk?{string.Join('&', q)}";

        async Task FlushAsync()
        {
            if (inBatch == 0) return;
            var res = await c.Transport.NdjsonAsync(bulkPath, bulk.ToArray(), ct, TimeSpan.FromMinutes(5)).ConfigureAwait(false);
            var (ok, bad) = CountBulk(res, errors);
            indexed += ok;
            failed += bad;
            bulk.SetLength(0);
            inBatch = 0;
            job?.Report(read, null, $"{indexed:N0} indexed{(failed > 0 ? $", {failed:N0} failed" : "")}");
        }

        Stream input = plan.Path is not null
            ? new FileStream(plan.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true)
            : new MemoryStream(Encoding.UTF8.GetBytes(plan.Upload ?? ""));
        await using (input)
        {
            await foreach (var doc in ReadDocsAsync(input, plan, ct).ConfigureAwait(false))
            {
                read++;
                var id = plan.IdField is null ? doc.Id : IdOf(doc.Source, plan.IdField) ?? doc.Id;
                if (plan.IdField is not null && id is null)
                {
                    // generating an id here would make a re-import duplicate the document: report it instead
                    failed++;
                    if (errors.Count < MaxErrors) errors.Add($"document {read}: no value in the id field '{plan.IdField}'");
                    continue;
                }
                var action = id is null ? """{"index":{}}""" : JsonSerializer.Serialize(new { index = new { _id = id } });
                var line = Encoding.UTF8.GetBytes(action + "\n" + doc.Source.ToJsonString(EsJson.Relaxed) + "\n");
                if (inBatch > 0 && bulk.Length + line.Length > MaxBulkBytes) await FlushAsync().ConfigureAwait(false);
                bulk.Write(line);
                inBatch++;
                if (inBatch >= plan.BatchSize) await FlushAsync().ConfigureAwait(false);
            }
        }
        await FlushAsync().ConfigureAwait(false);
        await c.Transport.SendAsync(HttpMethod.Post, $"{EsTransport.Seg(plan.Index)}/_refresh", null, null, ct).ConfigureAwait(false);
        job?.Report(read, read, $"{indexed:N0} indexed{(failed > 0 ? $", {failed:N0} failed" : "")}", force: true);
        return new EsImportResult(indexed, failed, errors, sw.ElapsedMilliseconds);
    }

    /// <summary>The document id from <paramref name="field"/>: a top-level key (also a literal "a.b" key, as CSV headers give) or a dotted path into nested objects.</summary>
    internal static string? IdOf(JsonObject source, string field)
    {
        JsonNode? node = source.TryGetPropertyValue(field, out var direct) ? direct : null;
        if (node is null && field.Contains('.', StringComparison.Ordinal))
        {
            node = source;
            foreach (var part in field.Split('.'))
            {
                node = node is JsonObject o && o.TryGetPropertyValue(part, out var next) ? next : null;
                if (node is null) break;
            }
        }
        return node is JsonValue v && v.ToString() is { Length: > 0 } s ? s : null;
    }

    internal static (long Ok, long Failed) CountBulk(JsonElement res, List<string> errors)
    {
        long ok = 0, bad = 0;
        foreach (var item in res.Prop("items").Items())
        {
            var op = item.ValueKind == JsonValueKind.Object ? item.EnumerateObject().FirstOrDefault().Value : default;
            if (op.ValueKind != JsonValueKind.Object) continue;
            if (op.Prop("error") is { } err)
            {
                bad++;
                if (errors.Count < MaxErrors)
                    errors.Add($"{op.Str("_id") ?? "(no id)"}: {(err.ValueKind == JsonValueKind.Object ? $"{err.Str("type")}: {err.Str("reason")}" : EsJson.AsString(err))}");
            }
            else ok++;
        }
        return (ok, bad);
    }

    /// <summary>Parses the import file. NDJSON: one object per line (a bulk action line before a document is honoured).</summary>
    internal static async IAsyncEnumerable<ImportDoc> ReadDocsAsync(Stream input, ImportPlan plan, [EnumeratorCancellation] CancellationToken ct)
    {
        if (plan.Format == "json")
        {
            // A JSON array (streamed) or a single object.
            var buffered = new BufferedStream(input, 64 * 1024);
            var first = await PeekNonWhitespaceAsync(buffered, ct).ConfigureAwait(false);
            if (first == '[')
            {
                var n = 0;
                await foreach (var el in JsonSerializer.DeserializeAsyncEnumerable<JsonElement>(buffered, cancellationToken: ct).ConfigureAwait(false))
                {
                    n++;
                    yield return ToDoc(el, $"element {n}");
                }
            }
            else if (first is not null)
            {
                var el = await JsonSerializer.DeserializeAsync<JsonElement>(buffered, cancellationToken: ct).ConfigureAwait(false);
                yield return ToDoc(el, "the document");
            }
            yield break;
        }
        using var reader = new StreamReader(input, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, bufferSize: 64 * 1024, leaveOpen: true);
        if (plan.Format == "ndjson")
        {
            string? pendingId = null;
            var lineNo = 0;
            while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
            {
                lineNo++;
                if (string.IsNullOrWhiteSpace(line)) continue;
                JsonElement el;
                try { el = JsonSerializer.Deserialize<JsonElement>(line); }
                catch (JsonException ex) { throw EngineException.Validation($"Line {lineNo} is not valid JSON: {ex.Message}", new { field = "upload", line = lineNo }); }
                if (IsBulkAction(el, out var actionId))
                {
                    pendingId = actionId;
                    continue;
                }
                var doc = ToDoc(el, $"line {lineNo}");
                yield return doc with { Id = doc.Id ?? pendingId };
                pendingId = null;
            }
            yield break;
        }
        // CSV
        string[]? header = null;
        var row = 0;
        await foreach (var fields in CsvRowsAsync(reader, plan.Delimiter, ct).ConfigureAwait(false))
        {
            row++;
            if (header is null)
            {
                if (plan.Header)
                {
                    header = fields.Select(f => f.Trim()).ToArray();
                    continue;
                }
                header = fields.Select((_, i) => $"column{i + 1}").ToArray();
            }
            if (fields.Count == 1 && fields[0].Length == 0) continue;
            var obj = new JsonObject();
            for (var i = 0; i < Math.Min(header.Length, fields.Count); i++)
            {
                if (header[i].Length == 0 || fields[i].Length == 0) continue;
                obj[header[i]] = CsvValue(fields[i]);
            }
            yield return new ImportDoc(obj, null);
        }
    }

    private static async Task<char?> PeekNonWhitespaceAsync(BufferedStream s, CancellationToken ct)
    {
        // BufferedStream has no peek: read the leading whitespace (and a UTF-8 BOM) and seek back to the first token when seekable.
        var buf = new byte[1];
        while (await s.ReadAsync(buf, ct).ConfigureAwait(false) == 1)
        {
            var b = buf[0];
            if (b is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n' or 0xEF or 0xBB or 0xBF) continue;
            s.Seek(-1, SeekOrigin.Current);
            return (char)b;
        }
        return null;
    }

    private static bool IsBulkAction(JsonElement el, out string? id)
    {
        id = null;
        if (el.ValueKind != JsonValueKind.Object) return false;
        var props = el.EnumerateObject().ToList();
        if (props.Count != 1 || props[0].Name is not ("index" or "create") || props[0].Value.ValueKind != JsonValueKind.Object) return false;
        id = props[0].Value.Str("_id");
        return true;
    }

    private static ImportDoc ToDoc(JsonElement el, string where)
    {
        if (el.ValueKind != JsonValueKind.Object) throw EngineException.Validation($"{char.ToUpperInvariant(where[0])}{where[1..]} is not a JSON object.", new { field = "upload" });
        var node = JsonNode.Parse(el.GetRawText())!.AsObject();
        // An export with metadata: { _index, _id, _source }.
        if (node["_source"] is JsonObject source && node.ContainsKey("_id"))
        {
            source = (JsonObject)source.DeepClone();
            return new ImportDoc(source, node["_id"]?.ToString());
        }
        return new ImportDoc(node, null);
    }

    private static JsonNode? CsvValue(string s)
    {
        if (s == "true") return JsonValue.Create(true);
        if (s == "false") return JsonValue.Create(false);
        if (s.Length <= 20 && (s[0] is '-' or (>= '0' and <= '9')) && !(s.Length > 1 && s[0] == '0' && s[1] != '.')
            && long.TryParse(s, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l)) return JsonValue.Create(l);
        // an integer that does not fit a long (a 20-digit id) stays text: as a double it would lose its last digits
        if (s.Length < 24 && (s[0] is '-' or (>= '0' and <= '9')) && !(s.Length > 1 && s[0] == '0' && s[1] != '.') && s.AsSpan().IndexOfAny('.', 'e', 'E') >= 0
            && double.TryParse(s, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var d)
            && double.IsFinite(d)) return JsonValue.Create(d);
        return JsonValue.Create(s);
    }

    /// <summary>RFC 4180 rows (quoted fields with "" escapes and line breaks).</summary>
    internal static async IAsyncEnumerable<List<string>> CsvRowsAsync(TextReader reader, char delimiter, [EnumeratorCancellation] CancellationToken ct)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        var buf = new char[16 * 1024];
        var any = false;
        int n;
        while ((n = await reader.ReadAsync(buf.AsMemory(), ct).ConfigureAwait(false)) > 0)
        {
            for (var i = 0; i < n; i++)
            {
                var ch = buf[i];
                any = true;
                if (quoted)
                {
                    if (ch == '"')
                    {
                        // look ahead for an escaped quote (may cross a buffer boundary: handled via prev)
                        if (i + 1 < n)
                        {
                            if (buf[i + 1] == '"') { sb.Append('"'); i++; }
                            else quoted = false;
                        }
                        else
                        {
                            var next = reader.Peek();
                            if (next == '"') { sb.Append('"'); reader.Read(); }
                            else quoted = false;
                        }
                    }
                    else sb.Append(ch);
                }
                else if (ch == '"' && sb.Length == 0) quoted = true;
                else if (ch == delimiter) { fields.Add(sb.ToString()); sb.Clear(); }
                else if (ch == '\n')
                {
                    fields.Add(sb.ToString());
                    sb.Clear();
                    yield return fields;
                    fields = [];
                    any = false;
                }
                else if (ch != '\r') sb.Append(ch);
            }
        }
        if (any && (sb.Length > 0 || fields.Count > 0))
        {
            fields.Add(sb.ToString());
            yield return fields;
        }
    }

    // ---------------------------------------------------------------- export

    public sealed record ExportPlan(string Index, string Format, JsonNode? Query, IReadOnlyList<string>? Fields, long? Max, string? Path, bool IncludeMeta)
    {
        public string Extension => Format switch { "ndjson" => "ndjson", "json" => "json", _ => "csv" };
    }

    public static ExportPlan ParseExport(EsExportRequest? req)
    {
        var index = EsNames.Target(req?.Index);
        var format = Format(req?.Format);
        var query = EsJson.UnwrapQuery(EsJson.Node(req!.Query));
        if (query is not null and not JsonObject) throw EngineException.Validation("query must be a query DSL object.", new { field = "query" });
        if (req.Max is < 1) throw EngineException.Validation("max must be ≥ 1.", new { field = "max" });
        var path = string.IsNullOrWhiteSpace(req.Path) ? null : req.Path.Trim();
        if (path is not null && Path.GetDirectoryName(Path.GetFullPath(path)) is { } dir && !Directory.Exists(dir))
            throw EngineException.Validation($"The folder '{dir}' does not exist.", new { field = "path" });
        var fields = req.Fields?.Select(f => f.Trim()).Where(f => f.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        return new ExportPlan(index, format, query, fields is { Count: > 0 } ? fields : null, req.Max, path, req.IncludeMeta);
    }

    public async Task<long> ExportAsync(EsClient c, ExportPlan plan, Stream output, JobContext? job, CancellationToken ct)
    {
        var t = c.Transport;
        var body = new JsonObject
        {
            ["size"] = (int)Math.Min(1000, plan.Max ?? 1000),
            ["sort"] = new JsonArray("_doc"),
            ["track_total_hits"] = true,
        };
        if (plan.Query is not null) body["query"] = plan.Query.DeepClone();
        if (plan.Fields is not null) body["_source"] = new JsonArray(plan.Fields.Select(f => (JsonNode?)f).ToArray());
        var page = await t.JsonAsync(HttpMethod.Post, $"{EsTransport.Seg(plan.Index)}/_search?scroll=2m", body, ct, TimeSpan.FromMinutes(2)).ConfigureAwait(false);
        var scrollIds = new HashSet<string>(StringComparer.Ordinal);
        long written = 0;
        var total = page.Path("hits.total") is { } tot ? (tot.ValueKind == JsonValueKind.Number ? tot.GetInt64() : tot.Long("value")) : null;
        if (plan.Max is { } max && (total is null || total > max)) total = max;
        await using var writer = new StreamWriter(output, new UTF8Encoding(plan.Format == "csv"), 64 * 1024, leaveOpen: true);
        List<string>? columns = null;
        // CSV without a field list: documents may bring new fields at any page, so the rows are spooled to a temp file and
        // the header (the union of every document's fields) is written once the scroll is over.
        var spoolColumns = new List<string>();
        var spoolSeen = new HashSet<string>(StringComparer.Ordinal);
        var spoolPath = plan.Format == "csv" && plan.Fields is null ? Path.GetTempFileName() : null;
        StreamWriter? spool = spoolPath is null ? null : new StreamWriter(spoolPath, false, new UTF8Encoding(false), 64 * 1024);
        try
        {
            if (plan.Format == "json") await writer.WriteAsync("[").ConfigureAwait(false);
            while (true)
            {
                if (page.Str("_scroll_id") is { } sid) scrollIds.Add(sid);
                var hits = page.Path("hits.hits").Items().ToList();
                if (hits.Count == 0) break;
                if (plan.Format == "csv" && spool is null && columns is null)
                {
                    columns = plan.Fields!.ToList();
                    await writer.WriteLineAsync(string.Join(',', new[] { "_id" }.Concat(columns).Select(CsvEscape))).ConfigureAwait(false);
                }
                foreach (var h in hits)
                {
                    if (plan.Max is { } m && written >= m) break;
                    var source = h.Prop("_source") ?? JsonSerializer.SerializeToElement(new { });
                    switch (plan.Format)
                    {
                        case "ndjson":
                            await writer.WriteAsync(DocText(h, source, plan.IncludeMeta)).ConfigureAwait(false);
                            await writer.WriteAsync('\n').ConfigureAwait(false);
                            break;
                        case "json":
                            await writer.WriteAsync(written == 0 ? "\n" : ",\n").ConfigureAwait(false);
                            await writer.WriteAsync(DocText(h, source, plan.IncludeMeta)).ConfigureAwait(false);
                            break;
                        default:
                            var flat = new Dictionary<string, string>(StringComparer.Ordinal);
                            Flatten(source, "", flat);
                            if (spool is not null)
                            {
                                foreach (var k in flat.Keys) if (spoolSeen.Add(k)) spoolColumns.Add(k);
                                await spool.WriteLineAsync(JsonSerializer.Serialize(new Dictionary<string, object?> { ["_id"] = h.Str("_id") ?? "", ["f"] = flat })).ConfigureAwait(false);
                            }
                            else
                            {
                                await writer.WriteLineAsync(string.Join(',', new[] { h.Str("_id") ?? "" }.Concat(columns!.Select(col => flat.GetValueOrDefault(col, ""))).Select(CsvEscape)))
                                    .ConfigureAwait(false);
                            }
                            break;
                    }
                    written++;
                }
                job?.Report(written, total, $"{written:N0} documents");
                if (plan.Max is { } mx && written >= mx) break;
                var sidNow = page.Str("_scroll_id");
                if (sidNow is null) break;
                page = await t.JsonAsync(HttpMethod.Post, "_search/scroll", new JsonObject { ["scroll"] = "2m", ["scroll_id"] = sidNow }, ct, TimeSpan.FromMinutes(2))
                    .ConfigureAwait(false);
            }
            if (plan.Format == "json") await writer.WriteAsync(written == 0 ? "]\n" : "\n]\n").ConfigureAwait(false);
            if (spool is not null)
            {
                await spool.DisposeAsync().ConfigureAwait(false);
                spool = null;
                if (written > 0) await WriteSpooledCsvAsync(writer, spoolPath!, spoolColumns, ct).ConfigureAwait(false);
            }
            await writer.FlushAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            if (spool is not null) await spool.DisposeAsync().ConfigureAwait(false);
            if (spoolPath is not null) try { File.Delete(spoolPath); } catch (IOException) { /* temp file */ }
            if (scrollIds.Count > 0)
            {
                try
                {
                    using var clear = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                    await t.SendAsync(HttpMethod.Delete, "_search/scroll", Encoding.UTF8.GetBytes(EsJson.Text(new JsonObject
                    {
                        ["scroll_id"] = new JsonArray(scrollIds.Select(s => (JsonNode?)s).ToArray()),
                    })), "application/json", clear.Token).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is EngineException or OperationCanceledException) { /* scrolls expire anyway */ }
            }
        }
        job?.Report(written, written, $"{written:N0} documents", force: true);
        return written;
    }

    /// <summary>Header (the union of the spooled documents' fields) and the spooled rows.</summary>
    private static async Task WriteSpooledCsvAsync(StreamWriter writer, string spoolPath, List<string> columns, CancellationToken ct)
    {
        await writer.WriteLineAsync(string.Join(',', new[] { "_id" }.Concat(columns).Select(CsvEscape))).ConfigureAwait(false);
        using var reader = new StreamReader(spoolPath, new UTF8Encoding(false), false, 64 * 1024);
        while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
        {
            using var doc = JsonDocument.Parse(line);
            var fields = doc.RootElement.GetProperty("f");
            var cells = new List<string> { doc.RootElement.GetProperty("_id").GetString() ?? "" };
            foreach (var col in columns) cells.Add(fields.TryGetProperty(col, out var v) ? v.GetString() ?? "" : "");
            await writer.WriteLineAsync(string.Join(',', cells.Select(CsvEscape))).ConfigureAwait(false);
        }
    }

    private static string DocText(JsonElement hit, JsonElement source, bool meta) => meta
        ? JsonSerializer.Serialize(new Dictionary<string, object?> { ["_index"] = hit.Str("_index"), ["_id"] = hit.Str("_id"), ["_source"] = source }, EsJson.Relaxed)
        : JsonSerializer.Serialize(source, EsJson.Relaxed);

    internal static List<string> CsvColumns(IEnumerable<JsonElement> hits)
    {
        var cols = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var h in hits)
        {
            var flat = new Dictionary<string, string>(StringComparer.Ordinal);
            if (h.Prop("_source") is { } s) Flatten(s, "", flat);
            foreach (var k in flat.Keys) if (seen.Add(k)) cols.Add(k);
        }
        return cols;
    }

    /// <summary>Objects become dotted columns; arrays and scalars are cells (arrays as JSON).</summary>
    internal static void Flatten(JsonElement e, string prefix, Dictionary<string, string> into)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in e.EnumerateObject()) Flatten(p.Value, prefix.Length == 0 ? p.Name : $"{prefix}.{p.Name}", into);
            return;
        }
        if (prefix.Length == 0) return;
        into[prefix] = e.ValueKind switch
        {
            JsonValueKind.String => e.GetString() ?? "",
            JsonValueKind.Null => "",
            JsonValueKind.Array => JsonSerializer.Serialize(e, EsJson.Relaxed),
            _ => e.GetRawText(),
        };
    }

    internal static string CsvEscape(string s) =>
        s.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{s.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : s;
}
