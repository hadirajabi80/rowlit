using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Numerics;
using System.Text.Json;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Views;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Federation.Materialize;

/// <summary>
/// <c>job.progress</c> message of a materialize job (JSON in <see cref="JobProgressEvent.Message"/>; Done = rows written).
/// </summary>
/// <param name="Phase">preparing | fetching | writing | committing | done.</param>
/// <param name="Fetched">Rows fetched from the sources so far (all mounted tables).</param>
/// <param name="Written">Rows written into the target.</param>
/// <param name="Rate">Rows written per second (smoothed).</param>
/// <param name="Source">The mounted table being fetched (phase fetching).</param>
public sealed record MaterializeProgress(string Phase, long Fetched, long Written, double Rate, string? Source = null)
{
    /// <summary>Rows written (= <see cref="Written"/>; the key the UI's materialize wizard reads).</summary>
    public long Rows => Written;

    /// <summary>Expected row count: unknown until the result is read (always null; the job's Total is null too).</summary>
    public long? Total => null;
}

/// <summary>
/// Materialize (plan-links 2): runs a link query (SQL or a linked view) and writes the result into a table of a
/// writable relational connection through Import's <see cref="TargetWriter"/> / <see cref="ImportDialect"/> — bulk paths
/// (COPY, SqlBulkCopy, ClickHouse bulk) where the dialect has one, batched INSERTs otherwise — as a JobManager job
/// (kind <see cref="JobKind"/>, progress <see cref="MaterializeProgress"/>, result <see cref="MaterializeResult"/>).
/// Modes: create (fails when the table exists), replace (the rows are loaded into a new table that replaces the old
/// one only when everything was written), append (columns matched by name, case-insensitive). Read-only targets are
/// refused (403 READ_ONLY), links and non-relational connections too (400).
/// </summary>
public sealed class MaterializeService(
    ILinkRuntime runtime,
    ConnectionStore connections,
    ProviderRegistry providers,
    CatalogService catalog,
    JobManager jobs,
    LinkedViewStore views,
    IServiceProvider services,
    ILogger<MaterializeService>? log = null)
{
    public const string JobKind = "links.materialize";

    private readonly ILogger _log = log ?? (ILogger)NullLogger.Instance;

    private sealed record Target(ConnectionProfile Profile, IDbProvider Provider, ImportDialect Dialect, string? Password, string? Database, string? Schema, string Table);

    internal sealed record Mapped(List<TargetCol> Columns, List<NewColumnSpec> Specs, List<string> Warnings, List<int> SourceIndex);

    // ------------------------------------------------------------------ request checks

    private Target ResolveTarget(MaterializeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.TargetConnectionId)) throw EngineException.Validation("targetConnectionId is required.", new { field = "targetConnectionId" });
        if (string.IsNullOrWhiteSpace(request.Table)) throw EngineException.Validation("table is required.", new { field = "table" });
        if (request.Mode is not (MaterializeModes.Create or MaterializeModes.Replace or MaterializeModes.Append))
            throw EngineException.Validation($"mode must be {MaterializeModes.Create}, {MaterializeModes.Replace} or {MaterializeModes.Append}.", new { field = "mode" });
        if (request.BatchSize is < 1) throw EngineException.Validation("batchSize must be at least 1.", new { field = "batchSize" });
        var profile = connections.Get(request.TargetConnectionId);
        if (profile.ProviderId == LinkIds.ProviderId)
            throw EngineException.Validation("A linked database cannot be a materialize target (it is read-only): choose one of its member connections or another database.", new { field = "targetConnectionId" });
        var provider = providers.Find(profile.ProviderId)
                       ?? throw EngineException.Validation($"'{profile.Name}' is not a relational connection: materialize needs a table to write to.", new { field = "targetConnectionId" });
        if (provider.Dialect is Dialect.Cql or Dialect.DuckDb)
            throw EngineException.Validation($"Materializing into {provider.DisplayName} is not supported.", new { field = "targetConnectionId" });
        if (profile.ReadOnly) throw EngineException.ReadOnly(profile.Name, "materialize");
        var dialect = ImportDialect.For(provider.Dialect, provider.Id);
        var db = string.IsNullOrWhiteSpace(request.Database) ? null : request.Database.Trim();
        var schema = string.IsNullOrWhiteSpace(request.Schema) ? null : request.Schema.Trim();
        return new Target(connections.ResolveForOpen(profile) /* WP-SSH */, provider, dialect, connections.GetPassword(profile.Id), db, schema, request.Table.Trim());
    }

    private string QuerySql(string linkId, MaterializeRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.ViewId)) return views.Get(linkId, request.ViewId).Sql;
        if (string.IsNullOrWhiteSpace(request.Sql)) throw EngineException.Validation("sql or viewId is required.", new { field = "sql" });
        return request.Sql;
    }

    /// <summary>The query without trailing semicolons / whitespace (it is wrapped for the preview).</summary>
    private static string Bare(string sql) => sql.Trim().TrimEnd(';').TrimEnd();

    // ------------------------------------------------------------------ preview

    /// <summary>The DDL and column mapping the job would use (the sources are read with a one-row cap to learn the result columns).</summary>
    public async Task<MaterializePreview> PreviewAsync(string linkId, MaterializeRequest request, CancellationToken ct)
    {
        runtime.Definition(linkId);
        var target = ResolveTarget(request);
        var sql = QuerySql(linkId, request);
        IReadOnlyList<ColumnInfo> resultColumns;
        await using (var q = await runtime.OpenQueryAsync(linkId, $"SELECT * FROM (\n{Bare(sql)}\n) AS q LIMIT 0", request.Params,
                         new LinkQueryOptions(MaxRowsPerSource: 1), ct).ConfigureAwait(false))
        {
            resultColumns = q.Columns;
        }
        var d = target.Dialect;
        var create = request.Mode != MaterializeModes.Append;
        var table = create ? d.Fold(target.Table) : target.Table;
        bool exists;
        List<TargetCol> existing;
        if (create) (exists, existing) = await TableAsync(request.TargetConnectionId, d, target.Database, target.Schema, table, ct).ConfigureAwait(false);
        else (exists, existing, table) = await AppendTargetAsync(request.TargetConnectionId, d, target.Database, target.Schema, table, ct).ConfigureAwait(false);
        var warnings = new List<string>();
        string? ddl = null;
        IReadOnlyList<ColumnInfo> columns;
        if (create)
        {
            var mapped = MapForCreate(d, resultColumns);
            warnings.AddRange(mapped.Warnings);
            ddl = d.CreateTable(d.Qualify(target.Database, target.Schema, table), mapped.Specs, []);
            if (exists && request.Mode == MaterializeModes.Create) warnings.Add($"The table {table} already exists: choose replace or append.");
            if (exists && request.Mode == MaterializeModes.Replace) warnings.Add($"The table {table} exists and will be replaced (dropped) after the rows are written.");
            columns = mapped.Specs.Select((s, i) => new ColumnInfo(s.Name, i, s.SqlType, KindOfTarget(mapped.Columns[i].Kind), s.Nullable)).ToList();
        }
        else
        {
            if (!exists) warnings.Add($"The table {target.Table} does not exist: append needs an existing table.");
            var mapped = exists ? MapForAppend(resultColumns, existing) : null;
            if (mapped is not null) warnings.AddRange(mapped.Warnings);
            columns = mapped is null ? [] : mapped.Columns.Select((c, i) => new ColumnInfo(c.Name, i, c.TypeText, KindOfTarget(c.Kind), c.Nullable)).ToList();
        }
        return new MaterializePreview(CoreJson.ToWire(d.Dialect), ddl, columns, warnings, exists);
    }

    // ------------------------------------------------------------------ job

    /// <summary>Validates the request and starts the job; returns its id.</summary>
    public string Start(string linkId, MaterializeRequest request, string? ownerClientId)
    {
        runtime.Definition(linkId);
        var target = ResolveTarget(request);
        var sql = QuerySql(linkId, request);
        connections.Touch(request.TargetConnectionId);
        return jobs.Start(JobKind, request.TargetConnectionId, ownerClientId,
            async (ctx, ct) => await RunAsync(linkId, sql, request, target, ctx, ct).ConfigureAwait(false));
    }

    private async Task<object?> RunAsync(string linkId, string sql, MaterializeRequest request, Target target, JobContext job, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var d = target.Dialect;
        long fetched = 0, written = 0;
        double rate = 0;
        var lastTick = Stopwatch.GetTimestamp();
        long lastWritten = 0;
        string phase = "preparing";
        string? source = null;
        var fetchedPerTable = new System.Collections.Concurrent.ConcurrentDictionary<string, long>(StringComparer.Ordinal);

        void Report(bool force = false)
        {
            var now = Stopwatch.GetTimestamp();
            var dt = Stopwatch.GetElapsedTime(lastTick, now).TotalSeconds;
            if (!force && dt < 0.2) return;
            if (dt > 0 && phase == "writing")
            {
                var inst = (written - lastWritten) / dt;
                rate = rate == 0 ? inst : rate * 0.6 + inst * 0.4;
            }
            lastTick = now;
            lastWritten = written;
            job.Report(written, null, JsonSerializer.Serialize(new MaterializeProgress(phase, fetched, written, Math.Round(rate, 1), source), CoreJson.Options), force);
        }

        Report(true);
        phase = "fetching";
        var progress = new SyncProgress<LinkFetchProgress>(p =>
        {
            fetchedPerTable[p.Table.ToString()] = p.Rows;
            fetched = fetchedPerTable.Values.Sum();
            source = p.Done ? null : p.Table.ToString();
            Report(p.Done);
        });

        await using var query = await runtime.OpenQueryAsync(linkId, sql, request.Params, new LinkQueryOptions(request.SessionId, progress), ct).ConfigureAwait(false);
        var warnings = query.Plan.Warnings.ToList();
        var create = request.Mode != MaterializeModes.Append;
        var finalName = create ? d.Fold(target.Table) : target.Table;
        bool exists;
        List<TargetCol> existing;
        if (create) (exists, existing) = await TableAsync(request.TargetConnectionId, d, target.Database, target.Schema, finalName, ct).ConfigureAwait(false);
        else (exists, existing, finalName) = await AppendTargetAsync(request.TargetConnectionId, d, target.Database, target.Schema, finalName, ct).ConfigureAwait(false);
        var finalTable = d.Qualify(target.Database, target.Schema, finalName);
        Mapped mapped;
        string writeName;
        if (create)
        {
            if (exists && request.Mode == MaterializeModes.Create)
                throw EngineException.Validation($"The table {finalName} already exists: choose replace or append.", new { field = "table" });
            mapped = MapForCreate(d, query.Columns);
            // Replace loads a fresh table and swaps it in at the end, so a failure keeps the old one.
            writeName = exists ? d.Fold(TempName(finalName, d.MaxIdentifierLength)) : finalName;
        }
        else
        {
            if (!exists) throw EngineException.NotFound($"Table '{target.Table}'");
            mapped = MapForAppend(query.Columns, existing);
            writeName = finalName;
        }
        foreach (var w in mapped.Warnings) warnings.Add(new PlanWarning(PlanWarningCodes.Conversion, w));
        var writeTable = d.Qualify(target.Database, target.Schema, writeName);

        await using var conn = await ImportConnections.OpenAsync(target.Provider, target.Profile, target.Password, target.Database, services, ct).ConfigureAwait(false);
        await using var writer = new TargetWriter(conn, d, writeTable, mapped.Columns, [], "append", useBulk: true);
        var created = false;
        var parser = new ValueParser(new SourceOptions());
        var converter = new CellConverter(parser);
        try
        {
            if (create)
            {
                await writer.ExecuteAsync(d.CreateTable(writeTable, mapped.Specs, []), ct).ConfigureAwait(false);
                created = true;
            }
            if (d.Dialect == Dialect.TSql && mapped.Columns.Any(c => c.IsIdentity))
                await writer.ExecuteAsync($"SET IDENTITY_INSERT {writeTable} ON", ct).ConfigureAwait(false);
            phase = "writing";
            Report(true);
            await writer.BeginAsync(ct).ConfigureAwait(false);
            var batchSize = Math.Max(1, request.BatchSize ?? d.DefaultBatchSize);
            var reader = query.Reader;
            var raw = new object?[reader.FieldCount];
            var batch = new List<object?[]>(batchSize);
            long rowNumber = 0;
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                rowNumber++;
                for (var i = 0; i < raw.Length; i++) raw[i] = reader.IsDBNull(i) ? null : Normalize(reader.GetValue(i));
                var row = new object?[mapped.Columns.Count];
                for (var j = 0; j < row.Length; j++)
                {
                    var col = mapped.Columns[j];
                    var v = raw[mapped.SourceIndex[j]];
                    try
                    {
                        row[j] = v is Guid g && col.Kind == Kinds.Guid ? g : converter.Convert(v, col.Kind);
                    }
                    catch (ValueConversionException e)
                    {
                        throw EngineException.Validation($"Row {rowNumber.ToString(CultureInfo.InvariantCulture)}, column {col.Name}: {e.Message}", new { field = "columns", column = col.Name });
                    }
                    if (row[j] is null && !col.Nullable && !col.IsIdentity)
                        throw EngineException.Validation($"Row {rowNumber.ToString(CultureInfo.InvariantCulture)}: column {col.Name} does not allow NULL.", new { field = "columns", column = col.Name });
                }
                batch.Add(row);
                if (batch.Count >= batchSize)
                {
                    written += await writer.WriteAsync(batch, false, ct).ConfigureAwait(false);
                    batch.Clear();
                    Report();
                }
            }
            if (batch.Count > 0) written += await writer.WriteAsync(batch, false, ct).ConfigureAwait(false);
            phase = "committing";
            Report(true);
            await writer.CommitAsync(ct).ConfigureAwait(false);
            if (d.Dialect == Dialect.TSql && mapped.Columns.Any(c => c.IsIdentity))
                await writer.ExecuteAsync($"SET IDENTITY_INSERT {writeTable} OFF", CancellationToken.None).ConfigureAwait(false);
            if (writeName != finalName)
            {
                await writer.ExecuteAsync(d.DropTable(finalTable), ct).ConfigureAwait(false);
                await writer.ExecuteAsync(RenameSql(d, target.Database, target.Schema, writeName, finalName), ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            await writer.RollbackAsync().ConfigureAwait(false);
            if (created)
            {
                try { await writer.ExecuteAsync(d.DropTable(writeTable), CancellationToken.None).ConfigureAwait(false); }
                catch (Exception dropEx) { _log.LogWarning(dropEx, "Could not drop {Table} after a failed materialize", writeTable); }
            }
            if (ex is OperationCanceledException or EngineException) throw;
            throw new EngineException(500, ErrorCodes.ProviderError, "Materialize failed: " + FirstLine(ex.Message));
        }

        if (create)
        {
            try { await catalog.RefreshAsync(request.TargetConnectionId, target.Database, target.Schema is null ? null : [target.Schema], CancellationToken.None).ConfigureAwait(false); }
            catch (Exception e) { _log.LogDebug(e, "Catalog refresh after materialize failed"); }
        }
        phase = "done";
        Report(true);
        return new MaterializeResult(request.TargetConnectionId, target.Database, target.Schema, finalName, written, sw.ElapsedMilliseconds, warnings);
    }

    /// <summary>Synchronous <see cref="IProgress{T}"/> (Progress&lt;T&gt; posts to the thread pool and could report after the job ended).</summary>
    private sealed class SyncProgress<T>(Action<T> report) : IProgress<T>
    {
        private readonly object _gate = new();
        public void Report(T value) { lock (_gate) report(value); }
    }

    private static string FirstLine(string message)
    {
        var i = message.IndexOfAny(['\r', '\n']);
        return i > 0 ? message[..i] : message;
    }

    private static string TempName(string table, int max)
    {
        var suffix = "_rowlit_" + Guid.NewGuid().ToString("N")[..6];
        var stem = table.Length + suffix.Length > max ? table[..Math.Max(1, max - suffix.Length)] : table;
        return stem + suffix;
    }

    /// <summary>Renames <paramref name="from"/> to <paramref name="to"/> in the same schema.</summary>
    internal static string RenameSql(ImportDialect d, string? database, string? schema, string from, string to) => d.Dialect switch
    {
        Dialect.TSql => $"EXEC {(string.IsNullOrEmpty(database) ? "" : d.Quote(database) + ".")}sys.sp_rename N'{d.Qualify(null, schema, from).Replace("'", "''", StringComparison.Ordinal)}', N'{to.Replace("'", "''", StringComparison.Ordinal)}'",
        Dialect.MySql or Dialect.ClickHouse => $"RENAME TABLE {d.Qualify(database, schema, from)} TO {d.Qualify(database, schema, to)}",
        _ => $"ALTER TABLE {d.Qualify(database, schema, from)} RENAME TO {d.Quote(to)}",
    };

    // ------------------------------------------------------------------ columns

    /// <summary>
    /// The table append writes to: the name as typed, else its folded form (Oracle creates QA_MAT_X for qa_mat_x, PostgreSQL
    /// qa_mat_x for QA_MAT_X, so "append" to the name the user typed for "create" must find the table that create made).
    /// </summary>
    private async Task<(bool Exists, List<TargetCol> Columns, string Name)> AppendTargetAsync(string connectionId, ImportDialect d, string? database, string? schema, string table, CancellationToken ct)
    {
        var (exists, columns) = await TableAsync(connectionId, d, database, schema, table, ct).ConfigureAwait(false);
        if (exists) return (true, columns, table);
        var folded = d.Fold(table);
        if (!string.Equals(folded, table, StringComparison.Ordinal))
        {
            (exists, columns) = await TableAsync(connectionId, d, database, schema, folded, ct).ConfigureAwait(false);
            if (exists) return (true, columns, folded);
        }
        return (false, [], table);
    }

    private async Task<(bool Exists, List<TargetCol> Columns)> TableAsync(string connectionId, ImportDialect d, string? database, string? schema, string table, CancellationToken ct)
    {
        ObjectDetails details;
        try
        {
            details =await catalog.GetObjectDetailsAsync(connectionId, new ObjectRef(database, schema, table, ObjectTypes.Table), ct).ConfigureAwait(false);
        }
        catch (EngineException ex) when (ex.Status == 404)
        {
            return (false, []);
        }
        if (details.Columns.Count == 0) return (false, []);
        var cols = details.Columns.OrderBy(c => c.Ordinal).Select(c =>
        {
            var kind = d.Classify(c.Type, out var max);
            return new TargetCol(c.Name, kind, c.Type, max, c.Nullable, c.Default is not null, c.IsIdentity);
        }).ToList();
        return (true, cols);
    }

    /// <summary>New table columns for a query result: names sanitized (and folded), unique; types from the result kinds.</summary>
    internal static Mapped MapForCreate(ImportDialect d, IReadOnlyList<ColumnInfo> result)
    {
        var cols = new List<TargetCol>();
        var specs = new List<NewColumnSpec>();
        var warnings = new List<string>();
        var index = new List<int>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < result.Count; i++)
        {
            var c = result[i];
            var stem = d.Fold(ImportDialect.SanitizeName(c.Name, d.MaxIdentifierLength));
            var name = stem;
            for (var n = 2; !seen.Add(name); n++) name = stem + "_" + n.ToString(CultureInfo.InvariantCulture);
            if (name != c.Name) warnings.Add($"Column {c.Name} is created as {name}.");
            var (sqlType, kind) = TypeFor(d, c, warnings);
            var classified = d.Classify(sqlType, out var max);
            cols.Add(new TargetCol(name, classified == Kinds.Other ? kind : classified, sqlType, max, true, false, false));
            specs.Add(new NewColumnSpec(name, sqlType, true));
            index.Add(i);
        }
        if (result.Count == 0) throw EngineException.Validation("The query returns no columns.", new { field = "sql" });
        return new Mapped(cols, specs, warnings, index);
    }

    /// <summary>Result columns matched by name (case-insensitive) to the existing table's columns.</summary>
    internal static Mapped MapForAppend(IReadOnlyList<ColumnInfo> result, List<TargetCol> existing)
    {
        var cols = new List<TargetCol>();
        var index = new List<int>();
        var warnings = new List<string>();
        var missing = new List<string>();
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < result.Count; i++)
        {
            var t = existing.FirstOrDefault(c => string.Equals(c.Name, result[i].Name, StringComparison.OrdinalIgnoreCase));
            if (t is null) { missing.Add(result[i].Name); continue; }
            if (!used.Add(t.Name)) throw EngineException.Validation($"The query returns the column {result[i].Name} twice.", new { field = "sql" });
            cols.Add(t);
            index.Add(i);
        }
        if (missing.Count > 0)
            throw EngineException.Validation($"The target table has no column {string.Join(", ", missing)} (append matches columns by name).", new { field = "table", columns = missing });
        foreach (var t in existing.Where(t => !used.Contains(t.Name) && !t.Nullable && !t.HasDefault && !t.IsIdentity))
            warnings.Add($"Column {t.Name} is NOT NULL without a default and the query does not fill it.");
        return new Mapped(cols, [], warnings, index);
    }

    private static (string SqlType, string Kind) TypeFor(ImportDialect d, ColumnInfo c, List<string> warnings)
    {
        string Text(int? size) => d.SqlType(new InferredType(Kinds.Text, size is > 0 and <= 4000 ? size : 1_000_000));
        switch (c.Kind)
        {
            case ColumnKinds.Int: return (d.SqlType(new InferredType(Kinds.BigInt)), Kinds.BigInt);
            case ColumnKinds.Float: return (d.SqlType(new InferredType(Kinds.Float)), Kinds.Float);
            case ColumnKinds.Decimal:
            {
                var precision = Math.Clamp(c.Precision ?? 38, 1, d.Dialect == Dialect.MySql ? 65 : 38);
                var scale = Math.Clamp(c.Scale ?? 10, 0, precision);
                return (d.SqlType(new InferredType(Kinds.Decimal, null, precision, scale)), Kinds.Decimal);
            }
            case ColumnKinds.Bool: return (d.SqlType(new InferredType(Kinds.Bool)), Kinds.Bool);
            case ColumnKinds.Date: return (d.SqlType(new InferredType(Kinds.Date)), Kinds.Date);
            case ColumnKinds.Time: return (d.SqlType(new InferredType(Kinds.Time)), Kinds.Time);
            case ColumnKinds.DateTime: return (d.SqlType(new InferredType(Kinds.DateTime)), Kinds.DateTime);
            case ColumnKinds.DateTimeOffset:
                warnings.Add($"Column {c.Name} (timestamp with time zone) is stored as a UTC timestamp.");
                return (d.SqlType(new InferredType(Kinds.DateTime)), Kinds.DateTime);
            case ColumnKinds.Guid: return (d.SqlType(new InferredType(Kinds.Guid)), Kinds.Guid);
            case ColumnKinds.Binary:
                return (d.Dialect switch
                {
                    Dialect.PgSql => "bytea",
                    Dialect.MySql => "longblob",
                    Dialect.TSql => "varbinary(max)",
                    Dialect.PlSql or Dialect.Sqlite => "BLOB",
                    Dialect.Snowflake => "BINARY",
                    _ => "String",
                }, Kinds.Binary);
            case ColumnKinds.Json:
                return d.Dialect switch
                {
                    Dialect.PgSql => ("jsonb", Kinds.Json),
                    Dialect.MySql => ("json", Kinds.Json),
                    _ => (Text(null), Kinds.Text),
                };
            default: return (Text(c.Size), Kinds.Text);
        }
    }

    private static string KindOfTarget(string importKind) => importKind switch
    {
        Kinds.Int or Kinds.BigInt => ColumnKinds.Int,
        Kinds.Decimal => ColumnKinds.Decimal,
        Kinds.Float => ColumnKinds.Float,
        Kinds.Bool => ColumnKinds.Bool,
        Kinds.Date => ColumnKinds.Date,
        Kinds.DateTime => ColumnKinds.DateTime,
        Kinds.Time => ColumnKinds.Time,
        Kinds.Guid => ColumnKinds.Guid,
        Kinds.Binary => ColumnKinds.Binary,
        Kinds.Json => ColumnKinds.Json,
        Kinds.Text => ColumnKinds.String,
        _ => ColumnKinds.Other,
    };

    /// <summary>Reader values (DuckDB / SQLite CLR types) → the types CellConverter / TargetWriter understand.</summary>
    internal static object? Normalize(object? v) => v switch
    {
        null or DBNull => null,
        long or string or bool or decimal or double or DateTime or TimeSpan or Guid or byte[] => v,
        int i => (long)i,
        short s => (long)s,
        sbyte sb => (long)sb,
        byte b => (long)b,
        ushort us => (long)us,
        uint ui => (long)ui,
        ulong ul => ul <= long.MaxValue ? (object)(long)ul : (decimal)ul,
        float f => (double)f,
        Half h => (double)h,
        BigInteger bi => bi >= long.MinValue && bi <= long.MaxValue ? (object)(long)bi : bi >= (BigInteger)decimal.MinValue && bi <= (BigInteger)decimal.MaxValue ? (decimal)bi : bi.ToString(CultureInfo.InvariantCulture),
        DateOnly d => d.ToDateTime(TimeOnly.MinValue),
        TimeOnly t => t.ToTimeSpan(),
        DateTimeOffset dto => DateTime.SpecifyKind(dto.UtcDateTime, DateTimeKind.Unspecified),
        char c => c.ToString(),
        _ => FromOther(v),
    };

    private static object FromOther(object v)
    {
        // DuckDB.NET structs (DuckDBDateOnly, DuckDBTimeOnly, …) convert explicitly to the BCL types.
        var t = v.GetType();
        foreach (var target in new[] { typeof(DateTime), typeof(DateOnly), typeof(TimeOnly), typeof(TimeSpan) })
        {
            var op = t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
                .FirstOrDefault(m => m.Name is "op_Explicit" or "op_Implicit" && m.ReturnType == target && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType == t);
            if (op is not null) return Normalize(op.Invoke(null, [v]))!;
        }
        return Convert.ToString(v, CultureInfo.InvariantCulture) ?? "";
    }
}
