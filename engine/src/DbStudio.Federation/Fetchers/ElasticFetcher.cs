using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Sources.Elasticsearch;

namespace DbStudio.Federation.Fetchers;

/// <summary>
/// P3 fetcher "elasticsearch": indices (aliases, patterns) as link tables. Catalog = <c>_id</c> plus the mapping's
/// fields, top-level and dotted object paths (nested / flattened / geo fields as JSON); kinds from the field types
/// (keyword/text → string, long… → int, double… → float, date → datetime in UTC, boolean → bool). Fetch = <c>_search</c>
/// with <c>_source</c> filtering and a <c>bool.filter</c> of the pushable predicates (term / terms / range / exists on
/// keyword, numeric, date and boolean fields; text fields only through a keyword sub-field), paged with scroll up to the
/// row cap. Multi-valued fields arrive as JSON arrays.
/// </summary>
public sealed class ElasticFetcher : ISourceFetcher
{
    public const int PageSize = 1000;
    private const string ScrollKeepAlive = "2m";

    private static Task<T> With<T>(SourceContext context, Func<EsClient, Task<T>> work, CancellationToken ct) =>
        MemberClients.WithClientAsync(context, work, ct);

    // ------------------------------------------------------------------ catalog

    public Task<SourceCatalog> LoadCatalogAsync(SourceContext context, CancellationToken ct) => With(context, async client =>
    {
        var t = client.Transport;
        var warnings = new List<string>();
        IEnumerable<string>? all = null;
        if (context.Member.AllTables)
        {
            var cat = await t.GetAsync("_cat/indices?format=json&h=index&expand_wildcards=open", ct).ConfigureAwait(false);
            all = cat.EnumerateArray().Select(e => e.GetProperty("index").GetString() ?? "").Where(n => n.Length > 0 && !n.StartsWith('.')).Order(StringComparer.Ordinal).ToList();
        }
        var tables = new List<SourceTable>();
        foreach (var mt in MemberClients.Mounted(context.Member, all))
        {
            JsonElement mapping;
            try { mapping = await t.GetAsync(EsTransport.Seg(mt.Name) + "/_mapping", ct).ConfigureAwait(false); }
            catch (EngineException e) when (e.Status == 404 || e.Code == ErrorCodes.NotFound)
            {
                warnings.Add($"Index {mt.Name} does not exist.");
                continue;
            }
            var columns = Columns(mapping);
            long? count = null;
            if (await t.TryGetAsync(EsTransport.Seg(mt.Name) + "/_count", ct).ConfigureAwait(false) is { } c && c.TryGetProperty("count", out var n) && n.TryGetInt64(out var cn)) count = cn;
            tables.Add(new SourceTable(mt.Name, mt.LinkName, null, null, "index", columns, ["_id"], [], count, mt.Options));
        }
        return new SourceCatalog(tables, warnings);
    }, ct);

    /// <summary>
    /// Columns of a <c>_mapping</c> response (all indices merged, first type wins): <c>_id</c>, then every leaf field by
    /// dotted path. SourceType = the ES type, plus <c>+keyword</c> when a text field has a keyword sub-field.
    /// </summary>
    internal static List<SourceColumn> Columns(JsonElement mapping)
    {
        var cols = new List<SourceColumn> { new("_id", "_id", ColumnKinds.String, false, IsPk: true) };
        var seen = new HashSet<string>(StringComparer.Ordinal) { "_id" };
        foreach (var index in mapping.EnumerateObject())
        {
            if (!index.Value.TryGetProperty("mappings", out var m) || !m.TryGetProperty("properties", out var props)) continue;
            Walk(props, "");
        }
        return cols;

        void Walk(JsonElement props, string prefix)
        {
            foreach (var f in props.EnumerateObject())
            {
                var path = prefix + f.Name;
                var type = f.Value.TryGetProperty("type", out var ty) ? ty.GetString() ?? "object" : "object";
                if (type == "object" && f.Value.TryGetProperty("properties", out var sub))
                {
                    Walk(sub, path + ".");
                    continue;
                }
                if (!seen.Add(path)) continue;
                var keyword = type == "text" && f.Value.TryGetProperty("fields", out var fields)
                    && fields.EnumerateObject().Any(x => x.Name == "keyword" && x.Value.TryGetProperty("type", out var kt) && kt.GetString() == "keyword");
                cols.Add(new SourceColumn(path, keyword ? "text+keyword" : type, KindOf(type), true));
            }
        }
    }

    private static string KindOf(string type) => type switch
    {
        "keyword" or "text" or "wildcard" or "constant_keyword" or "match_only_text" or "ip" or "version" or "search_as_you_type" or "binary" => ColumnKinds.String,
        "long" or "integer" or "short" or "byte" or "unsigned_long" => ColumnKinds.Int,
        "double" or "float" or "half_float" or "scaled_float" => ColumnKinds.Float,
        "boolean" => ColumnKinds.Bool,
        "date" or "date_nanos" => ColumnKinds.DateTime,
        _ => ColumnKinds.Json,
    };

    // ------------------------------------------------------------------ push-down

    public FetchRequest Accept(SourceContext context, FetchRequest proposed) =>
        MemberClients.Keep(proposed, proposed.Predicates.Where(p => Clause(proposed.Table, p) is not null).ToList());

    /// <summary>The filter clause of one predicate, or null when it cannot be pushed exactly.</summary>
    internal static JsonObject? Clause(SourceTable table, PushdownPredicate p)
    {
        var col = table.Columns.FirstOrDefault(c => c.Name == p.Column);
        if (col is null) return null;
        string field;
        switch (col.SourceType)
        {
            case "_id": field = "_id"; break;
            case "keyword" or "constant_keyword" or "long" or "integer" or "short" or "byte" or "double" or "float" or "half_float" or "scaled_float" or "boolean" or "date" or "date_nanos" or "ip":
                field = col.Name; break;
            case "text+keyword": field = col.Name + ".keyword"; break;
            default: return null;
        }
        if (p.Op == PushdownOps.IsNotNull) return new JsonObject { ["exists"] = new JsonObject { ["field"] = field } };
        var values = new List<JsonNode>();
        foreach (var lit in p.Values)
        {
            var v = Literal(col, lit);
            if (v is null) return null;
            values.Add(v);
        }
        JsonObject Range(params (string Op, JsonNode V)[] bounds)
        {
            var r = new JsonObject();
            foreach (var (op, v) in bounds) r[op] = v;
            return new JsonObject { ["range"] = new JsonObject { [field] = r } };
        }
        if (col.SourceType == "_id" && p.Op is not (PushdownOps.Eq or PushdownOps.In)) return null;
        return p.Op switch
        {
            PushdownOps.Eq when values.Count == 1 => new JsonObject { ["term"] = new JsonObject { [field] = values[0] } },
            PushdownOps.Ne when values.Count == 1 => new JsonObject { ["bool"] = new JsonObject { ["must_not"] = new JsonArray(new JsonObject { ["term"] = new JsonObject { [field] = values[0] } }) } },
            PushdownOps.In when values.Count >= 1 => new JsonObject { ["terms"] = new JsonObject { [field] = new JsonArray(values.ToArray()) } },
            PushdownOps.Lt when values.Count == 1 => Range(("lt", values[0])),
            PushdownOps.Gt when values.Count == 1 => Range(("gt", values[0])),
            PushdownOps.Le when values.Count == 1 => Range(("lte", values[0])),
            PushdownOps.Ge when values.Count == 1 => Range(("gte", values[0])),
            PushdownOps.Between when values.Count == 2 => Range(("gte", values[0]), ("lte", values[1].DeepClone())),
            _ => null,
        };
    }

    private static JsonNode? Literal(SourceColumn col, PushdownLiteral lit)
    {
        var inv = CultureInfo.InvariantCulture;
        switch (col.Kind)
        {
            case ColumnKinds.Int or ColumnKinds.Float:
                if (lit.Kind == ColumnKinds.Int && long.TryParse(lit.Value, NumberStyles.Integer, inv, out var l)) return JsonValue.Create(l);
                if (lit.Kind is ColumnKinds.Float or ColumnKinds.Decimal && double.TryParse(lit.Value, NumberStyles.Float, inv, out var d)) return JsonValue.Create(d);
                return null;
            case ColumnKinds.Bool:
                return lit.Kind == ColumnKinds.Bool && bool.TryParse(lit.Value, out var b) ? JsonValue.Create(b) : null;
            case ColumnKinds.DateTime:
                if (lit.Kind == ColumnKinds.DateTimeOffset && DateTimeOffset.TryParse(lit.Value, inv, DateTimeStyles.None, out var dto))
                    return JsonValue.Create(dto.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", inv));
                // Dates are read as UTC timestamps: a zone-less literal is UTC (ES' default too).
                if (lit.Kind is ColumnKinds.DateTime or ColumnKinds.Date && DateTime.TryParse(lit.Value, inv, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt))
                    return JsonValue.Create(dt.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", inv));
                return null;
            case ColumnKinds.String:
                return lit.Kind == ColumnKinds.String && col.SourceType != "ip" ? JsonValue.Create(lit.Value) : null;
            default:
                return null;
        }
    }

    internal static JsonObject Body(FetchRequest request, int size)
    {
        var filters = new JsonArray(request.Predicates.Select(p => Clause(request.Table, p)).Where(c => c is not null).Select(c => (JsonNode)c!).ToArray());
        var source = new JsonArray(request.Columns.Where(c => c != "_id").Select(c => (JsonNode)JsonValue.Create(c)!).ToArray());
        return new JsonObject
        {
            ["size"] = size,
            ["_source"] = source.Count == 0 ? JsonValue.Create(false) : source,
            ["query"] = filters.Count == 0 ? new JsonObject { ["match_all"] = new JsonObject() } : new JsonObject { ["bool"] = new JsonObject { ["filter"] = filters } },
            ["sort"] = new JsonArray(JsonValue.Create("_doc")),
        };
    }

    private static int Size(FetchRequest request)
    {
        var cap = request.MaxRows == long.MaxValue ? long.MaxValue : request.MaxRows + 1;
        return (int)Math.Max(1, Math.Min(PageSize, Math.Min(request.Limit ?? long.MaxValue, cap)));
    }

    public string Describe(SourceContext context, FetchRequest request) =>
        $"POST /{request.Table.Name}/_search\n{Body(request, Size(request)).ToJsonString(new JsonSerializerOptions { WriteIndented = true })}";

    // ------------------------------------------------------------------ fetch

    public Task<FetchResult> FetchAsync(SourceContext context, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct) => With(context, async client =>
    {
        var sw = Stopwatch.StartNew();
        var t = client.Transport;
        var size = Size(request);
        var wanted = Math.Min(request.Limit ?? long.MaxValue, request.MaxRows == long.MaxValue ? long.MaxValue : request.MaxRows + 1);
        var kinds = request.Columns.Select(c => request.Table.Columns.FirstOrDefault(x => x.Name == c)?.Kind ?? ColumnKinds.String).ToArray();
        var row = new object?[request.Columns.Count];
        long rows = 0;
        var truncated = false;
        string? scrollId = null;
        try
        {
            var page = await t.JsonAsync(HttpMethod.Post, EsTransport.Seg(request.Table.Name) + "/_search?scroll=" + ScrollKeepAlive, Body(request, size), ct, request.Timeout).ConfigureAwait(false);
            while (true)
            {
                if (page.TryGetProperty("_scroll_id", out var sid)) scrollId = sid.GetString();
                var hits = page.GetProperty("hits").GetProperty("hits");
                if (hits.GetArrayLength() == 0) break;
                foreach (var hit in hits.EnumerateArray())
                {
                    if (rows >= request.MaxRows) { truncated = true; break; }
                    if (rows >= wanted) break;
                    var src = hit.TryGetProperty("_source", out var s) ? s : default;
                    for (var i = 0; i < row.Length; i++)
                    {
                        var name = request.Columns[i];
                        row[i] = name == "_id" ? hit.GetProperty("_id").GetString() : Clr(Lookup(src, name), kinds[i]);
                    }
                    target.AppendRow(row);
                    rows++;
                    if (rows % 1000 == 0) progress?.Report(rows);
                }
                if (truncated || rows >= wanted || scrollId is null || hits.GetArrayLength() < size) break;
                page = await t.JsonAsync(HttpMethod.Post, "_search/scroll", new JsonObject { ["scroll"] = ScrollKeepAlive, ["scroll_id"] = scrollId }, ct, request.Timeout).ConfigureAwait(false);
            }
        }
        catch (EngineException e)
        {
            if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
            throw new FetchException(context.Member.Alias, request.Table.LinkName, e.Message, e);
        }
        finally
        {
            if (scrollId is not null)
            {
                try { await t.SendAsync(HttpMethod.Delete, "_search/scroll", System.Text.Encoding.UTF8.GetBytes(new JsonObject { ["scroll_id"] = scrollId }.ToJsonString()), "application/json", CancellationToken.None, TimeSpan.FromSeconds(10)).ConfigureAwait(false); }
                catch (Exception) { /* expires by itself */ }
            }
        }
        progress?.Report(rows);
        return new FetchResult(rows, truncated, Describe(context, request), sw.ElapsedMilliseconds, target.ConversionFailures);
    }, ct);

    /// <summary>The value at a dotted path of a _source document (a literal dotted key wins; arrays of objects are not descended).</summary>
    internal static JsonElement? Lookup(JsonElement source, string path)
    {
        if (source.ValueKind != JsonValueKind.Object) return null;
        if (source.TryGetProperty(path, out var direct)) return direct;
        var dot = path.IndexOf('.');
        while (dot > 0)
        {
            if (source.TryGetProperty(path[..dot], out var head) && head.ValueKind == JsonValueKind.Object && Lookup(head, path[(dot + 1)..]) is { } v) return v;
            dot = path.IndexOf('.', dot + 1);
        }
        return null;
    }

    internal static object? Clr(JsonElement? value, string kind)
    {
        if (value is not { } v || v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
        if (kind == ColumnKinds.Json || v.ValueKind is JsonValueKind.Object or JsonValueKind.Array) return v.GetRawText();
        var inv = CultureInfo.InvariantCulture;
        switch (kind)
        {
            case ColumnKinds.Int:
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var l)) return l;
                if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), NumberStyles.Integer, inv, out var ls)) return ls;
                return v.ValueKind == JsonValueKind.Number ? v.GetDouble() : v.ToString();
            case ColumnKinds.Float:
                if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
                return double.TryParse(v.GetString(), NumberStyles.Float, inv, out var d) ? d : v.ToString();
            case ColumnKinds.Bool:
                if (v.ValueKind is JsonValueKind.True or JsonValueKind.False) return v.GetBoolean();
                return v.GetString() is "true" ? true : v.GetString() is "false" ? false : v.ToString();
            case ColumnKinds.DateTime:
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var ms))
                    return DateTime.SpecifyKind(DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime, DateTimeKind.Unspecified);
                var text = v.GetString();
                if (DateTimeOffset.TryParse(text, inv, DateTimeStyles.AssumeUniversal, out var dto)) return DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Unspecified);
                return text;
            default:
                return v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText();
        }
    }
}
