using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Sources.Mongo;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;

namespace DbStudio.Federation.Fetchers;

/// <summary>
/// The long-lived client of a non-relational member: the engine's <see cref="SourceClientManager"/> (never a second
/// pool) with a lease for the duration of the call; without one (tests, a member whose profile is not saved) the member
/// provider opens a short-lived client.
/// </summary>
internal static class MemberClients
{
    public static async Task<T> WithClientAsync<TClient, T>(SourceContext context, Func<TClient, Task<T>> work, CancellationToken ct) where TClient : class, IDataSourceClient
    {
        var manager = context.Services.GetService<SourceClientManager>();
        var id = context.Member.ConnectionId ?? context.Profile?.Id;
        if (manager is not null && !string.IsNullOrEmpty(id) && context.Services.GetService<ConnectionStore>()?.Find(id) is not null)
        {
            using var lease = manager.AcquireLease(id);
            var client = await manager.GetAsync(id, ct).ConfigureAwait(false) as TClient
                         ?? throw EngineException.Validation($"Member '{context.Member.Alias}' is not a {typeof(TClient).Name} connection.");
            return await work(client).ConfigureAwait(false);
        }
        if (context.Source is null || context.Profile is null)
            throw EngineException.SourceUnavailable($"Member '{context.Member.Alias}' has no client.");
        var own = await context.Source.OpenAsync(context.Profile, context.Password, ct).ConfigureAwait(false);
        await using (own.ConfigureAwait(false))
        {
            var client = own as TClient ?? throw EngineException.Validation($"Member '{context.Member.Alias}' is not a {typeof(TClient).Name} connection.");
            return await work(client).ConfigureAwait(false);
        }
    }

    /// <summary>The mounted tables of a member: explicit list, or (AllTables) <paramref name="all"/> with the overrides applied.</summary>
    public static IEnumerable<MountedTable> Mounted(LinkMember member, IEnumerable<string>? all)
    {
        if (!member.AllTables || all is null) return member.Tables;
        return all.Select(n => member.Tables.FirstOrDefault(t => t.Name == n) ?? new MountedTable { Name = n });
    }

    public static int OptionInt(JsonObject? options, string key, int fallback, int min, int max) =>
        options?[key] is JsonValue v && (v.TryGetValue<int>(out var i) || (v.TryGetValue<string>(out var s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out i)))
            ? Math.Clamp(i, min, max) : fallback;

    public static string? OptionString(JsonObject? options, string key) =>
        options?[key] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : null;

    /// <summary>Drops the limit when a predicate was dropped (ISourceFetcher.Accept rule).</summary>
    public static FetchRequest Keep(FetchRequest proposed, List<PushdownPredicate> kept) =>
        kept.Count == proposed.Predicates.Count ? proposed with { Predicates = kept } : proposed with { Predicates = kept, Limit = null };
}

/// <summary>
/// P3 fetcher "mongodb": a member's collections as link tables. Catalog = the member database's collections (or the
/// explicit ones) with their top-level fields inferred from a sample (<c>MountedTable.Options.sampleSize</c>, default
/// 1000): one BSON type → its kind, int+double → float, int/double+decimal → decimal, anything else mixed (and documents,
/// arrays) → JSON text. Fetch = aggregate <c>$match</c> (pushable predicates on single-typed fields) → <c>$project</c> →
/// <c>$limit</c>; nested documents and arrays arrive as relaxed Extended JSON, ObjectIds as hex strings, dates in UTC.
/// </summary>
public sealed partial class MongoFetcher : ISourceFetcher
{
    public const int DefaultSampleSize = 1000;

    private static string Database(SourceContext context, MongoClientHandle client) =>
        context.Member.Schema is { Length: > 0 } s ? s
        : client.DefaultDatabase ?? throw EngineException.Validation($"Member '{context.Member.Alias}': choose the MongoDB database (member schema).", new { field = "schema" });

    public Task<SourceCatalog> LoadCatalogAsync(SourceContext context, CancellationToken ct) =>
        MemberClients.WithClientAsync<MongoClientHandle, SourceCatalog>(context, async client =>
        {
            var db = Database(context, client);
            var warnings = new List<string>();
            var collections = await client.Gateway.ListCollectionsAsync(db, null, ct).ConfigureAwait(false);
            var types = collections.ToDictionary(c => c.GetValue("name").AsString, c => c.GetValue("type", "collection").AsString, StringComparer.Ordinal);
            var all = context.Member.AllTables ? types.Keys.Where(n => !n.StartsWith("system.", StringComparison.Ordinal)).Order(StringComparer.Ordinal) : null;
            var tables = new List<SourceTable>();
            foreach (var mt in MemberClients.Mounted(context.Member, all))
            {
                if (!types.TryGetValue(mt.Name, out var type))
                {
                    warnings.Add($"Collection {db}.{mt.Name} does not exist.");
                    continue;
                }
                var sample = MemberClients.OptionInt(mt.Options, "sampleSize", DefaultSampleSize, 1, 100_000);
                var docs = await client.Gateway.FindAsync(db, mt.Name, new FindSpec(new BsonDocument(), Limit: sample, MaxTime: context.Limits.FetchTimeout), ct).ConfigureAwait(false);
                long? estimate = null;
                if (type == "collection")
                {
                    try { estimate = await client.Gateway.EstimatedCountAsync(db, mt.Name, TimeSpan.FromSeconds(10), ct).ConfigureAwait(false); }
                    catch (Exception e) when (e is not OperationCanceledException) { /* views, permissions */ }
                }
                var columns = Infer(docs);
                tables.Add(new SourceTable(mt.Name, mt.LinkName, null, db, type, columns, columns.Any(c => c.Name == "_id") ? ["_id"] : [], [], estimate, mt.Options));
            }
            return new SourceCatalog(tables, warnings);
        }, ct);

    /// <summary>Top-level fields of a sample, in first-seen order (_id first).</summary>
    internal static List<SourceColumn> Infer(IEnumerable<BsonDocument> docs)
    {
        var order = new List<string>();
        var seen = new Dictionary<string, (HashSet<string> Types, int Count)>(StringComparer.Ordinal);
        var n = 0;
        foreach (var d in docs)
        {
            n++;
            foreach (var e in d.Elements)
            {
                if (!seen.TryGetValue(e.Name, out var s))
                {
                    s = (new HashSet<string>(StringComparer.Ordinal), 0);
                    order.Add(e.Name);
                }
                if (!e.Value.IsBsonNull && e.Value.BsonType != BsonType.Undefined) s.Types.Add(BsonKit.TypeAlias(e.Value));
                seen[e.Name] = (s.Types, s.Count + (e.Value.IsBsonNull ? 0 : 1));
            }
        }
        // An empty collection has no fields to infer, but every document will have an _id: mounting it with that column
        // keeps `select count(*) from mg.empty` working (0 rows) instead of "table does not exist".
        if (n == 0) return [new SourceColumn("_id", "objectId", ColumnKinds.String, Nullable: false, IsPk: true)];
        if (seen.ContainsKey("_id")) { order.Remove("_id"); order.Insert(0, "_id"); }
        return order.Select(name =>
        {
            var (types, count) = seen[name];
            var sourceType = types.Count == 0 ? "null" : string.Join("|", types.Order(StringComparer.Ordinal));
            return new SourceColumn(name, sourceType, KindOf(types), Nullable: count < n || name != "_id", IsPk: name == "_id");
        }).ToList();
    }

    private static string KindOf(HashSet<string> types)
    {
        if (types.Count == 0) return ColumnKinds.String;
        if (types.Count == 1)
        {
            return types.First() switch
            {
                "int" or "long" => ColumnKinds.Int,
                "double" => ColumnKinds.Float,
                "decimal" => ColumnKinds.Decimal,
                "bool" => ColumnKinds.Bool,
                "date" or "timestamp" => ColumnKinds.DateTime,
                "object" or "array" => ColumnKinds.Json,
                "binData" => ColumnKinds.Binary,
                _ => ColumnKinds.String,
            };
        }
        if (types.All(t => t is "int" or "long")) return ColumnKinds.Int;
        if (types.All(t => t is "int" or "long" or "double")) return ColumnKinds.Float;
        if (types.All(t => t is "int" or "long" or "double" or "decimal")) return ColumnKinds.Decimal;
        return types.Any(t => t is "object" or "array") ? ColumnKinds.Json : ColumnKinds.String;
    }

    // ------------------------------------------------------------------ push-down

    public FetchRequest Accept(SourceContext context, FetchRequest proposed)
    {
        var kept = proposed.Predicates.Where(p => Match(proposed.Table, p) is not null).ToList();
        return MemberClients.Keep(proposed, kept);
    }

    /// <summary>The $match clause of one predicate, or null when it cannot be pushed exactly (superset semantics).</summary>
    internal static BsonDocument? Match(SourceTable table, PushdownPredicate p)
    {
        var col = table.Columns.FirstOrDefault(c => c.Name == p.Column);
        if (col is null || col.SourceType.Contains('|', StringComparison.Ordinal) || col.Name.Contains('.', StringComparison.Ordinal) || col.Name.StartsWith('$')) return null;
        if (p.Op == PushdownOps.IsNotNull) return new BsonDocument(col.Name, new BsonDocument("$ne", BsonNull.Value));
        var values = new List<BsonValue>();
        foreach (var lit in p.Values)
        {
            var v = Literal(col, lit);
            if (v is null) return null;
            values.Add(v);
        }
        return p.Op switch
        {
            PushdownOps.Eq when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$eq", values[0])),
            PushdownOps.Ne when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$ne", values[0])),
            PushdownOps.Lt when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$lt", values[0])),
            PushdownOps.Gt when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$gt", values[0])),
            PushdownOps.Le when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$lte", values[0])),
            PushdownOps.Ge when values.Count == 1 => new BsonDocument(col.Name, new BsonDocument("$gte", values[0])),
            PushdownOps.Between when values.Count == 2 => new BsonDocument(col.Name, new BsonDocument { { "$gte", values[0] }, { "$lte", values[1] } }),
            PushdownOps.In when values.Count >= 1 => new BsonDocument(col.Name, new BsonDocument("$in", new BsonArray(values))),
            PushdownOps.Like when values.Count == 1 && col.SourceType == "string" && LikeRegex(p.Values[0].Value) is { } re
                => new BsonDocument(col.Name, new BsonDocument("$regex", new BsonRegularExpression(re, "s"))),
            _ => null,
        };
    }

    /// <summary>A literal as the BSON type the field holds; null when the types do not match (the predicate is not pushed).</summary>
    private static BsonValue? Literal(SourceColumn col, PushdownLiteral lit)
    {
        var inv = CultureInfo.InvariantCulture;
        switch (col.SourceType)
        {
            case "int" or "long" or "double" or "decimal":
                if (lit.Kind is not (ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float)) return null;
                if (lit.Kind == ColumnKinds.Int && long.TryParse(lit.Value, NumberStyles.Integer, inv, out var l)) return new BsonInt64(l);
                if (lit.Kind == ColumnKinds.Float && double.TryParse(lit.Value, NumberStyles.Float, inv, out var d)) return new BsonDouble(d);
                if (decimal.TryParse(lit.Value, NumberStyles.Float, inv, out var m)) return new BsonDecimal128(m);
                return null;
            case "string":
                return lit.Kind == ColumnKinds.String ? new BsonString(lit.Value) : null;
            case "objectId":
                return lit.Kind == ColumnKinds.String && ObjectId.TryParse(lit.Value, out var oid) ? new BsonObjectId(oid) : null;
            case "bool":
                return lit.Kind == ColumnKinds.Bool && bool.TryParse(lit.Value, out var b) ? BsonBoolean.Create(b) : null;
            case "date":
                if (lit.Kind == ColumnKinds.DateTimeOffset && DateTimeOffset.TryParse(lit.Value, inv, DateTimeStyles.None, out var dto)) return new BsonDateTime(dto.UtcDateTime);
                // Dates are read as UTC timestamps, so a zone-less literal is UTC too.
                if (lit.Kind is ColumnKinds.DateTime or ColumnKinds.Date && DateTime.TryParse(lit.Value, inv, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt))
                    return new BsonDateTime(DateTime.SpecifyKind(dt, DateTimeKind.Utc));
                return null;
            default:
                return null;
        }
    }

    /// <summary>SQL LIKE (no escape character) → anchored regex; null when the pattern holds a backslash.</summary>
    internal static string? LikeRegex(string like)
    {
        if (like.Contains('\\', StringComparison.Ordinal)) return null;
        var sb = new StringBuilder("^");
        foreach (var ch in like)
        {
            sb.Append(ch switch
            {
                '%' => ".*",
                '_' => ".",
                _ => Regex.Escape(ch.ToString()),
            });
        }
        return sb.Append('$').ToString();
    }

    internal static List<BsonDocument> Pipeline(FetchRequest request)
    {
        var pipeline = new List<BsonDocument>();
        var matches = request.Predicates.Select(p => Match(request.Table, p)).Where(m => m is not null).Select(m => (BsonValue)m!).ToList();
        if (matches.Count == 1) pipeline.Add(new BsonDocument("$match", matches[0]));
        else if (matches.Count > 1) pipeline.Add(new BsonDocument("$match", new BsonDocument("$and", new BsonArray(matches))));
        var project = new BsonDocument();
        foreach (var c in request.Columns) project[c] = 1;
        if (!request.Columns.Contains("_id")) project["_id"] = 0;
        pipeline.Add(new BsonDocument("$project", project));
        var cap = request.MaxRows == long.MaxValue ? long.MaxValue : request.MaxRows + 1;
        var limit = Math.Min(request.Limit ?? long.MaxValue, cap);
        if (limit != long.MaxValue) pipeline.Add(new BsonDocument("$limit", limit));
        return pipeline;
    }

    public string Describe(SourceContext context, FetchRequest request)
    {
        var db = context.Member.Schema ?? context.Profile?.GetString("database") ?? "";
        var stages = string.Join(", ", Pipeline(request).Select(s => Ejson.Relaxed(s)));
        return $"db.getSiblingDB({Ejson.Relaxed(new BsonString(db))}).getCollection({Ejson.Relaxed(new BsonString(request.Table.Name))}).aggregate([{stages}])";
    }

    public Task<FetchResult> FetchAsync(SourceContext context, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct) =>
        MemberClients.WithClientAsync<MongoClientHandle, FetchResult>(context, async client =>
        {
            var sw = Stopwatch.StartNew();
            var db = Database(context, client);
            var pipeline = Pipeline(request);
            var describe = Describe(context, request);
            var kinds = request.Columns.Select(c => request.Table.Columns.FirstOrDefault(x => x.Name == c)?.Kind ?? ColumnKinds.String).ToArray();
            // A field sampled as only strings (or only ObjectIds) reads other BSON types as NULL: pushed filters compare
            // strings with strings, so the engine must not see "5" for a numeric 5 the source filter skipped.
            var strict = request.Columns.Select(c => request.Table.Columns.FirstOrDefault(x => x.Name == c)?.SourceType switch
            {
                "string" => BsonType.String,
                "objectId" => BsonType.ObjectId,
                _ => (BsonType?)null,
            }).ToArray();
            var row = new object?[request.Columns.Count];
            long rows = 0, mismatched = 0;
            var truncated = false;
            try
            {
                await foreach (var doc in client.Gateway.AggregateStreamAsync(db, request.Table.Name, pipeline, new AggregateSpec(MaxTime: request.Timeout), ct).ConfigureAwait(false))
                {
                    if (rows >= request.MaxRows) { truncated = true; break; }
                    for (var i = 0; i < row.Length; i++)
                    {
                        if (!doc.TryGetValue(request.Columns[i], out var v)) { row[i] = null; continue; }
                        if (strict[i] is { } only && v.BsonType != only && !v.IsBsonNull) { row[i] = null; mismatched++; continue; }
                        row[i] = Clr(v, kinds[i]);
                    }
                    target.AppendRow(row);
                    rows++;
                    if (rows % 1000 == 0) progress?.Report(rows);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException and not FetchException)
            {
                if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
                throw new FetchException(context.Member.Alias, request.Table.LinkName, MongoSettingsBuilder.Redact(MongoErrors.Map(e)?.Message ?? e.Message, context.Profile?.GetString("uri")), e);
            }
            progress?.Report(rows);
            return new FetchResult(rows, truncated, describe, sw.ElapsedMilliseconds, target.ConversionFailures + mismatched,
                mismatched > 0 ? [$"{mismatched} values of another BSON type than the sampled one were read as NULL (raise the table's sampleSize option)."] : null);
        }, ct);

    private static object DecimalOrText(Decimal128 d)
    {
        try { return Decimal128.ToDecimal(d); }
        catch (OverflowException) { return d.ToString(); }
    }

    /// <summary>A BSON value as the CLR value the appender converts for the column kind.</summary>
    internal static object? Clr(BsonValue v, string kind)
    {
        if (v.IsBsonNull || v.BsonType is BsonType.Undefined or BsonType.MinKey or BsonType.MaxKey) return null;
        if (kind == ColumnKinds.Json) return Ejson.Relaxed(v);
        if (kind == ColumnKinds.String)
        {
            return v.BsonType switch
            {
                BsonType.String => v.AsString,
                BsonType.ObjectId => v.AsObjectId.ToString(),
                BsonType.Int32 => v.AsInt32.ToString(CultureInfo.InvariantCulture),
                BsonType.Int64 => v.AsInt64.ToString(CultureInfo.InvariantCulture),
                BsonType.Double => v.AsDouble.ToString("R", CultureInfo.InvariantCulture),
                BsonType.Decimal128 => v.AsDecimal128.ToString(),
                BsonType.Boolean => v.AsBoolean ? "true" : "false",
                BsonType.DateTime => v.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                _ => Ejson.Relaxed(v),
            };
        }
        return v.BsonType switch
        {
            BsonType.String => v.AsString,
            BsonType.ObjectId => v.AsObjectId.ToString(),
            BsonType.Int32 => (long)v.AsInt32,
            BsonType.Int64 => v.AsInt64,
            BsonType.Double => v.AsDouble,
            BsonType.Decimal128 => DecimalOrText(v.AsDecimal128),
            BsonType.Boolean => v.AsBoolean,
            BsonType.DateTime => DateTime.SpecifyKind(v.ToUniversalTime(), DateTimeKind.Unspecified),
            BsonType.Timestamp => DateTime.SpecifyKind(DateTimeOffset.FromUnixTimeSeconds(v.AsBsonTimestamp.Timestamp).UtcDateTime, DateTimeKind.Unspecified),
            BsonType.Binary when v.AsBsonBinaryData.SubType is BsonBinarySubType.UuidStandard => v.AsBsonBinaryData.ToGuid(),
            BsonType.Binary => v.AsBsonBinaryData.Bytes,
            _ => Ejson.Relaxed(v),
        };
    }
}
