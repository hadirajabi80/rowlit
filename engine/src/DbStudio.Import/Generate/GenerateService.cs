using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import.Generate;

internal sealed record Resolved(ConnectionProfile Profile, IDbProvider Provider, ImportDialect Dialect, string? Password);

/// <summary>A request turned into a ready row factory (connection-dependent parts done: parent samples, sequence starts).</summary>
internal sealed record Prepared(RowFactory Factory, long Rows, long Seed, IReadOnlyList<string> Warnings, bool Identity);

/// <summary>
/// Mock data generator backend: the inferred plan of a table, a preview of generated rows and the generate job. Rows are
/// written through the Import Wizard's loaders (<see cref="TargetWriter"/>: SqlBulkCopy, COPY, ClickHouse native insert,
/// Oracle array binding, batched multi-row INSERT) so every dialect the wizard imports into is supported.
/// </summary>
public sealed class GenerateService(ConnectionStore connections, ProviderRegistry providers, CatalogService catalog, JobManager jobs, AppPaths paths,
    IServiceProvider services, ILogger<GenerateService> log)
{
    public const string JobKind = "generate.run";
    public const long DefaultRows = 1000;
    public const long MaxRows = 5_000_000;
    /// <summary>Parent rows read per foreign key (values are drawn from this sample).</summary>
    public const int ParentSample = 10_000;

    public string ReportDirectory => Path.Combine(paths.DataDir, "generate-reports");

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    // ------------------------------------------------------------------ resolve

    internal async Task<Resolved> ResolveAsync(string connectionId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(connectionId)) throw EngineException.Validation("connectionId is required.", new { field = "connectionId" });
        var profile = await connections.ResolveForOpenAsync(connectionId, ct).ConfigureAwait(false); // WP-SSH
        var provider = providers.Find(profile.ProviderId)
                       ?? throw EngineException.Validation($"'{profile.Name}' is not a relational connection; data is generated into a table.", new { field = "connectionId" });
        if (provider.Dialect == Dialect.Cql)
            throw EngineException.Validation("Generating data in Cassandra is not supported yet.", new { field = "connectionId" });
        ImportDialect dialect;
        try
        {
            dialect = ImportDialect.For(provider.Dialect, provider.Id);
        }
        catch (NotSupportedException ex)
        {
            throw EngineException.Validation(ex.Message, new { field = "connectionId" });
        }
        return new Resolved(profile, provider, dialect, connections.GetPassword(connectionId));
    }

    internal async Task<ObjectDetails> ReadDetailsAsync(string connectionId, string? database, string? schema, string table, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(table)) throw EngineException.Validation("table is required.", new { field = "table" });
        try
        {
            var details = await catalog.GetObjectDetailsAsync(connectionId, new ObjectRef(Blank(database), Blank(schema), table, ObjectTypes.Table), ct).ConfigureAwait(false);
            if (details.Columns.Count == 0) throw EngineException.NotFound($"Table '{table}'");
            return details;
        }
        catch (EngineException ex) when (ex.Status == 404)
        {
            throw EngineException.NotFound($"Table '{table}'");
        }
    }

    private static TargetCol TargetOf(ImportDialect d, ColumnDetail c)
    {
        var kind = d.Classify(c.Type, out var max);
        return new TargetCol(c.Name, kind, c.Type ?? "", max, c.Nullable, c.Default is not null, c.IsIdentity);
    }

    /// <summary>Column name to the name of the first foreign key containing it.</summary>
    private static Dictionary<string, string> ForeignKeyOf(ObjectDetails details)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var fk in details.ForeignKeys)
            foreach (var c in fk.Columns) map.TryAdd(c, fk.Name);
        return map;
    }

    /// <summary>Single-column unique keys (PK or unique index) and keys over several columns.</summary>
    private static (HashSet<string> Solo, List<IReadOnlyList<string>> Composite) UniqueKeys(ObjectDetails details)
    {
        var solo = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var composite = new List<IReadOnlyList<string>>();
        void Add(IReadOnlyList<string> cols)
        {
            if (cols.Count == 1) solo.Add(cols[0]);
            else if (cols.Count > 1 && !composite.Any(k => k.SequenceEqual(cols, StringComparer.OrdinalIgnoreCase))) composite.Add(cols);
        }
        Add(details.Columns.Where(c => c.IsPk).OrderBy(c => c.Ordinal).Select(c => c.Name).ToList());
        foreach (var ix in details.Indexes.Where(i => i.Unique || i.IsPrimaryKey)) Add(ix.Columns.ToList());
        return (solo, composite);
    }

    // ------------------------------------------------------------------ plan

    public async Task<GeneratePlan> PlanAsync(string connectionId, string? database, string? schema, string table, CancellationToken ct)
    {
        var r = await ResolveAsync(connectionId, ct).ConfigureAwait(false);
        var details = await ReadDetailsAsync(connectionId, database, schema, table, ct).ConfigureAwait(false);
        var d = r.Dialect;
        var warnings = new List<string>();
        var canGenerate = !r.Profile.ReadOnly;
        var reason = canGenerate ? null : $"The connection '{r.Profile.Name}' is read-only: generating data is not allowed.";

        await using var conn = await ImportConnections.OpenAsync(r.Provider, r.Profile, r.Password, database, services, ct).ConfigureAwait(false);
        var hints = await CheckHints.ReadAsync(conn, d, Blank(database), Blank(schema), table, details.Columns, ct).ConfigureAwait(false);

        var fkOf = ForeignKeyOf(details);
        var (solo, composite) = UniqueKeys(details);
        var now = DateTime.Now;
        var columns = new List<GenerateColumn>();
        foreach (var c in details.Columns.OrderBy(c => c.Ordinal))
        {
            var tc = TargetOf(d, c);
            var cc = TypeBounds.Context(d, c, tc);
            hints.TryGetValue(c.Name, out var hint);
            columns.Add(Inference.Infer(d, table, c, tc, cc, fkOf.GetValueOrDefault(c.Name), solo.Contains(c.Name), hint, now));
        }

        var fks = new List<GenerateForeignKey>();
        foreach (var fk in details.ForeignKeys)
        {
            var parent = d.Qualify(Blank(database), Blank(fk.RefSchema) ?? Blank(schema), fk.RefTable);
            var hasRows = await HasRowsAsync(conn, d, parent, fk.RefColumns, ct).ConfigureAwait(false);
            fks.Add(new GenerateForeignKey(fk.Name, fk.Columns, fk.RefSchema, fk.RefTable, fk.RefColumns, hasRows));
            var members = columns.Where(c => fk.Columns.Contains(c.Name, StringComparer.OrdinalIgnoreCase) && c.Generator == GeneratorCatalog.ForeignKey).ToList();
            if (members.Count > 0 && !hasRows)
                warnings.Add(members.All(m => m.Nullable)
                    ? $"The parent table {fk.RefTable} has no rows: {string.Join(", ", fk.Columns)} will be NULL. Generate the parent first for real references."
                    : $"The parent table {fk.RefTable} has no rows, but {string.Join(", ", fk.Columns)} cannot be NULL. Generate the parent table first.");
        }

        foreach (var col in columns.Where(c => c.Unique && c.Generator is not (GeneratorCatalog.Skip or GeneratorCatalog.ForeignKey or "sequence")))
        {
            var detail = details.Columns.First(c => string.Equals(c.Name, col.Name, StringComparison.OrdinalIgnoreCase));
            var tc = TargetOf(d, detail);
            try
            {
                var g = GeneratorCatalog.Create(col.Generator, new GenArgs(col.Options, TypeBounds.Context(d, detail, tc), 1, now));
                if (g.Cardinality < DefaultRows)
                    warnings.Add($"Column {col.Name} must be unique but its generator can only produce {g.Cardinality:N0} distinct values.");
            }
            catch (ArgumentException)
            {
                // reported when the options are used
            }
        }

        if (details.Triggers.Count > 0) warnings.Add($"The table has {details.Triggers.Count} trigger(s); they fire for every generated row.");
        if (columns.Any(c => c.IsComputed)) warnings.Add("Computed columns are left to the database.");

        return new GeneratePlan(r.Provider.Id, CoreJson.ToWire(r.Provider.Dialect), canGenerate, reason, r.Profile.ReadOnly, table, DefaultRows, MaxRows,
            Random.Shared.NextInt64(1, 1_000_000_000), d.DefaultBatchSize, d.Transactional, columns, fks, composite, warnings);
    }

    private static async Task<bool> HasRowsAsync(ImportConnection conn, ImportDialect d, string table, IReadOnlyList<string> columns, CancellationToken ct)
    {
        try
        {
            await using var cmd = conn.Db.CreateCommand();
            cmd.CommandText = GenerateSql.Sample(d, table, columns, 1);
            await using var rd = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            return await rd.ReadAsync(ct).ConfigureAwait(false);
        }
        catch (System.Data.Common.DbException)
        {
            return true; // unknown (no permission on the parent): do not warn
        }
    }

    // ------------------------------------------------------------------ prepare (shared by preview and run)

    internal async Task<Prepared> PrepareAsync(GenerateRequest req, Resolved r, ObjectDetails details, ImportConnection conn, CancellationToken ct)
    {
        var d = r.Dialect;
        if (req.Rows is < 1 or > MaxRows) throw EngineException.Validation($"Rows must be between 1 and {MaxRows:N0}.", new { field = "rows" });
        var seed = req.Seed ?? Random.Shared.NextInt64(1, 1_000_000_000);
        var warnings = new List<string>();
        var now = DateTime.Now;

        var byName = details.Columns.ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        foreach (var rc in req.Columns)
            if (!byName.ContainsKey(rc.Name)) throw EngineException.Validation($"The table has no column '{rc.Name}'.", new { field = "columns", column = rc.Name });
        var specs = req.Columns.ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);

        var fkOf = ForeignKeyOf(details);
        var (solo, composite) = UniqueKeys(details);

        var setups = new List<ColumnSetup>();
        var identity = false;
        foreach (var c in details.Columns.OrderBy(c => c.Ordinal))
        {
            var tc = TargetOf(d, c);
            var cc = TypeBounds.Context(d, c, tc);
            var spec = specs.GetValueOrDefault(c.Name) ?? Inference.Infer(d, details.Ref.Name, c, tc, cc, fkOf.GetValueOrDefault(c.Name), solo.Contains(c.Name), null, now);
            var generator = string.IsNullOrWhiteSpace(spec.Generator) ? GeneratorCatalog.Skip : spec.Generator.Trim();
            if (generator.Equals(GeneratorCatalog.Skip, StringComparison.OrdinalIgnoreCase)) continue;
            if (c.IsComputed)
            {
                warnings.Add($"Column {c.Name} is computed and was left out.");
                continue;
            }
            if (!GeneratorCatalog.Exists(generator)) throw EngineException.Validation($"Unknown generator '{generator}' for column '{c.Name}'.", new { field = "columns", column = c.Name });
            if (!GeneratorCatalog.Supports(generator, tc.Kind))
                throw EngineException.Validation($"The generator '{generator}' cannot fill column '{c.Name}' ({c.Type}).", new { field = "columns", column = c.Name });
            string? fkName = null;
            if (generator.Equals(GeneratorCatalog.ForeignKey, StringComparison.OrdinalIgnoreCase))
            {
                if (!fkOf.TryGetValue(c.Name, out fkName))
                    throw EngineException.Validation($"Column '{c.Name}' is not part of a foreign key, so it cannot take parent table values.", new { field = "columns", column = c.Name });
            }
            if (c.IsIdentity) identity = true;
            setups.Add(new ColumnSetup(tc, cc, generator, spec.Options ?? [], spec.NullPercent, spec.Unique || solo.Contains(c.Name), fkName));
        }
        if (setups.Count == 0) throw EngineException.Validation("Every column is skipped: nothing to generate.", new { field = "columns" });

        // Foreign keys: all-or-nothing per key, then sample the parent rows.
        var fkSetups = new List<FkSetup>();
        foreach (var fk in details.ForeignKeys)
        {
            var members = setups.Where(s => string.Equals(s.ForeignKey, fk.Name, StringComparison.OrdinalIgnoreCase)).ToList();
            if (members.Count == 0) continue;
            if (members.Count != fk.Columns.Count)
                throw EngineException.Validation($"Foreign key {fk.Name} covers {string.Join(", ", fk.Columns)}: set all of its columns to 'Parent table value', or none.", new { field = "columns" });
            var parentSchema = Blank(fk.RefSchema) ?? Blank(req.Schema);
            var parent = d.Qualify(Blank(req.Database), parentSchema, fk.RefTable);
            var selfReference = string.Equals(fk.RefTable, details.Ref.Name, StringComparison.OrdinalIgnoreCase)
                                && (parentSchema is null || Blank(req.Schema) is null || string.Equals(parentSchema, Blank(req.Schema), StringComparison.OrdinalIgnoreCase));
            var tuples = selfReference && req.TruncateFirst ? [] : await SampleAsync(conn, d, parent, fk.RefColumns, ct).ConfigureAwait(false);
            var ordered = fk.Columns.Select(col => members.First(m => string.Equals(m.Target.Name, col, StringComparison.OrdinalIgnoreCase))).ToList();
            if (tuples.Count == 0)
            {
                if (ordered.Any(m => !m.Target.Nullable))
                    throw EngineException.Validation($"The parent table {fk.RefTable} has no rows to reference from {string.Join(", ", fk.Columns)}. Generate the parent table first.", new { field = "columns" });
                warnings.Add($"The parent table {fk.RefTable} has no rows: {string.Join(", ", fk.Columns)} will be NULL.");
            }
            fkSetups.Add(new FkSetup(fk.Name, fk.Columns, tuples));
        }

        // Sequences that continue after the table's current maximum.
        var autoStarts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var table = d.Qualify(Blank(req.Database), Blank(req.Schema), details.Ref.Name);
        foreach (var s in setups.Where(s => s.Generator.Equals("sequence", StringComparison.OrdinalIgnoreCase) && s.Context.IsNumeric))
        {
            var start = s.Options.TryGetValue("start", out var v) ? v : null;
            if (!string.IsNullOrWhiteSpace(start) && !start.Trim().Equals("auto", StringComparison.OrdinalIgnoreCase)) continue;
            autoStarts[s.Target.Name] = req.TruncateFirst ? 1 : await MaxPlusOneAsync(conn, d, table, s.Target.Name, ct).ConfigureAwait(false);
        }

        RowFactory factory;
        try
        {
            factory = RowFactory.Create(setups, fkSetups, composite, req.Rows, seed, autoStarts, now);
        }
        catch (ArgumentException ex)
        {
            throw EngineException.Validation(ex.Message, new { field = "columns" });
        }
        catch (GenerateExhaustedException ex)
        {
            throw EngineException.Validation(ex.Message, new { field = "rows" });
        }
        return new Prepared(factory, req.Rows, seed, warnings, identity);
    }

    private static async Task<List<object?[]>> SampleAsync(ImportConnection conn, ImportDialect d, string parent, IReadOnlyList<string> columns, CancellationToken ct)
    {
        var rows = new List<object?[]>();
        await using var cmd = conn.Db.CreateCommand();
        cmd.CommandText = GenerateSql.Sample(d, parent, columns, ParentSample);
        cmd.CommandTimeout = 60;
        await using var rd = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await rd.ReadAsync(ct).ConfigureAwait(false))
        {
            var row = new object?[columns.Count];
            for (var i = 0; i < row.Length; i++) row[i] = await rd.IsDBNullAsync(i, ct).ConfigureAwait(false) ? null : rd.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    private static async Task<long> MaxPlusOneAsync(ImportConnection conn, ImportDialect d, string table, string column, CancellationToken ct)
    {
        try
        {
            await using var cmd = conn.Db.CreateCommand();
            cmd.CommandText = $"SELECT MAX({d.Quote(column)}) FROM {table}";
            var v = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
            if (v is null or DBNull) return 1;
            return Convert.ToInt64(Math.Floor(Convert.ToDecimal(v, System.Globalization.CultureInfo.InvariantCulture)), System.Globalization.CultureInfo.InvariantCulture) + 1;
        }
        catch (Exception ex) when (ex is System.Data.Common.DbException or FormatException or OverflowException or InvalidCastException)
        {
            return 1;
        }
    }

    // ------------------------------------------------------------------ preview

    public async Task<GeneratePreview> PreviewAsync(GenerateRequest req, CancellationToken ct)
    {
        var r = await ResolveAsync(req.ConnectionId, ct).ConfigureAwait(false);
        var details = await ReadDetailsAsync(req.ConnectionId, req.Database, req.Schema, req.Table, ct).ConfigureAwait(false);
        await using var conn = await ImportConnections.OpenAsync(r.Provider, r.Profile, r.Password, req.Database, services, ct).ConfigureAwait(false);
        var prep = await PrepareAsync(req, r, details, conn, ct).ConfigureAwait(false);
        var n = (int)Math.Min(Math.Clamp(req.PreviewRows ?? 20, 1, 100), prep.Rows);
        var rows = new List<IReadOnlyList<string?>>(n);
        try
        {
            for (var i = 0; i < n; i++) rows.Add(prep.Factory.Row(i).Select(Display).ToList());
        }
        catch (GenerateExhaustedException ex)
        {
            throw EngineException.Validation(ex.Message, new { field = "rows" });
        }
        var columns = prep.Factory.Columns.Select(c => new GeneratePreviewColumn(c.Name, c.TypeText, c.Kind)).ToList();
        return new GeneratePreview(columns, rows, prep.Warnings, prep.Seed);
    }

    internal static string? Display(object? v)
    {
        if (v is null) return null;
        var s = v switch
        {
            byte[] b => "0x" + Convert.ToHexString(b.AsSpan(0, Math.Min(b.Length, 16))) + (b.Length > 16 ? "..." : ""),
            DateTime dt when dt.TimeOfDay == TimeSpan.Zero => dt.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            DateTime dt => dt.ToString("yyyy-MM-dd HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture),
            _ => CellConverter.Text(v),
        };
        return s.Length > 300 ? s[..300] + "..." : s;
    }

    // ------------------------------------------------------------------ run

    public string Start(GenerateRequest request, string? ownerClientId)
    {
        var profile = connections.Get(request.ConnectionId);
        if (profile.ReadOnly) throw EngineException.ReadOnly(profile.Name, "generate data");
        if (string.IsNullOrWhiteSpace(request.Table)) throw EngineException.Validation("table is required.", new { field = "table" });
        if (request.Rows is < 1 or > MaxRows) throw EngineException.Validation($"Rows must be between 1 and {MaxRows:N0}.", new { field = "rows" });
        if (request.OnError is not ("stop" or "skip")) throw EngineException.Validation("onError must be 'stop' or 'skip'.", new { field = "onError" });
        connections.Touch(request.ConnectionId);
        return jobs.Start(JobKind, request.ConnectionId, ownerClientId, async (ctx, ct) => await GenerateRunner.RunAsync(this, request, services, log, ctx, ct).ConfigureAwait(false));
    }

    public string? ErrorReportPath(string jobId)
    {
        var path = ErrorReport.PathFor(ReportDirectory, jobId);
        return File.Exists(path) ? path : null;
    }
}

/// <summary>Small SQL helpers of the generator.</summary>
internal static class GenerateSql
{
    /// <summary>Up to <paramref name="limit"/> non-null rows of the given columns.</summary>
    public static string Sample(ImportDialect d, string table, IReadOnlyList<string> columns, int limit)
    {
        var list = string.Join(", ", columns.Select(d.Quote));
        var where = string.Join(" AND ", columns.Select(c => d.Quote(c) + " IS NOT NULL"));
        return d.Dialect switch
        {
            Dialect.TSql => $"SELECT TOP ({limit}) {list} FROM {table} WHERE {where}",
            Dialect.PlSql => $"SELECT {list} FROM {table} WHERE {where} FETCH FIRST {limit} ROWS ONLY",
            _ => $"SELECT {list} FROM {table} WHERE {where} LIMIT {limit}",
        };
    }
}
