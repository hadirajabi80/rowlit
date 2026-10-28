using System.Text.RegularExpressions;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;

namespace DbStudio.Core.Transfer;

/// <summary>A resolved connection: profile (with secrets applied), password and provider.</summary>
public sealed record TransferConnection(ConnectionProfile Profile, string? Password, IDbProvider Provider);

/// <summary>What the transfer needs from the engine: connections, providers and the per-provider designer features.</summary>
public interface ITransferEnvironment
{
    /// <summary>404 when the connection does not exist; 400 when it is not a relational one.</summary>
    TransferConnection Resolve(string connectionId);

    ProviderFeatures Features { get; }

    IDbProvider? FindProvider(string providerId);
}

/// <summary>A column that takes part in the copy.</summary>
internal sealed class ColumnMap
{
    public required string SourceName { get; init; }
    public required string SourceType { get; init; }
    public required CanonType SourceCanon { get; init; }
    public required string TargetName { get; init; }
    public required TargetColumn Target { get; init; }
    /// <summary>SELECT list item reading the column from the source.</summary>
    public required string SelectItem { get; init; }
}

internal sealed class PreparedTable
{
    public required PlannedTable Planned { get; set; }
    public required string SourceSchema { get; init; }
    public required string SourceName { get; init; }
    public string? SourceKind { get; init; }
    public List<ColumnMap> Columns { get; } = [];
    public bool CreateTable { get; set; }
    public bool DropFirst { get; set; }
    public bool IdentityInsert { get; set; }
    public string? IdentityColumn { get; set; }
    public string? Where { get; init; }
    public TableModel? SourceModel { get; set; }
    public List<string> KeyColumnsTarget { get; } = [];
    public List<TableColumnModel> ColumnModels { get; set; } = [];
    public Action? Script { get; set; }
}

internal sealed class PreparedPlan
{
    public required TransferPlan Wire { get; init; }
    public required List<PreparedTable> Tables { get; init; }
    public required Dialect SourceDialect { get; init; }
    public required Dialect TargetDialect { get; init; }
    public required string TargetProviderId { get; init; }
    public required string? TargetSchema { get; init; }
    public required TransferOptions Options { get; init; }
    public required bool SameLocation { get; init; }
}

/// <summary>
/// Builds the plan of a transfer: reads the source tables, maps every column to the target dialect (editable per column),
/// scripts the target DDL with the target provider's designer scripter (tables first, indexes and foreign keys after the
/// data) and notes what cannot be carried over.
/// </summary>
internal sealed class TransferPlanner(ITransferEnvironment env)
{
    private sealed record SourceTable(TransferTableSpec Spec, string Schema, string Name, bool IsView, TableModel? Model, string? Error);

    public async Task<PreparedPlan> PlanAsync(TransferSpec spec, CancellationToken ct)
    {
        Validate(spec);
        var opts = spec.Opts;
        var source = env.Resolve(spec.Source.ConnectionId);
        var sd = source.Provider.Dialect;

        // ---- target side: connection or dump dialect
        TransferConnection? target = null;
        IDbProvider targetProvider;
        if (spec.Target.IsFile)
        {
            var id = spec.Target.DumpProvider;
            targetProvider = (string.IsNullOrWhiteSpace(id) ? null : env.FindProvider(id))
                             ?? throw EngineException.Validation("target.dumpProvider must name a relational provider.", new { field = "target.dumpProvider" });
        }
        else
        {
            if (string.IsNullOrWhiteSpace(spec.Target.ConnectionId))
                throw EngineException.Validation("target.connectionId is required.", new { field = "target.connectionId" });
            target = env.Resolve(spec.Target.ConnectionId);
            if (target.Profile.ReadOnly) throw EngineException.ReadOnly(target.Profile.Name, "data transfer");
            targetProvider = target.Provider;
        }
        var td = targetProvider.Dialect;
        IDdlScripter scripter;
        try { scripter = env.Features.Scripter(targetProvider.Id); }
        catch (EngineException) { throw EngineException.Validation($"{targetProvider.DisplayName} cannot be a data transfer target (no DDL support).", new { field = "target" }); }

        DdlScriptContext ctx = DdlScriptContext.Default;
        if (target is not null)
        {
            try
            {
                ctx = await env.Features.Database(targetProvider.Id)
                    .GetScriptContextAsync(target.Profile, target.Password, Blank(spec.Target.Database), Blank(spec.Target.Schema), null, ct).ConfigureAwait(false);
            }
            catch (EngineException) { /* defaults */ }
        }
        var knownTypes = new HashSet<string>(scripter.GetTypes(ctx).Types.Select(t => TypeMapper.Split(t.Name).Base), StringComparer.Ordinal);

        // ---- schemas
        var sourceDb = Blank(spec.Source.Database);
        var sourceSchema = Blank(spec.Source.Schema) ?? await DefaultSchemaAsync(source, sourceDb, ct).ConfigureAwait(false);
        var targetDb = Blank(spec.Target.Database);
        var targetSchema = Blank(spec.Target.Schema);
        if (targetSchema is null)
        {
            targetSchema = target is not null
                ? await DefaultSchemaAsync(target, targetDb, ct).ConfigureAwait(false)
                : DialectInfo.DefaultSchemaFallback(td);
        }
        if (DialectInfo.SchemaIsDatabase(td) && string.IsNullOrEmpty(targetSchema) && target is not null)
            targetSchema = targetDb;
        var sameLocation = target is not null && string.Equals(target.Profile.Id, source.Profile.Id, StringComparison.Ordinal)
                           && string.Equals(targetDb ?? "", sourceDb ?? "", StringComparison.OrdinalIgnoreCase)
                           && string.Equals(targetSchema ?? "", sourceSchema ?? "", StringComparison.OrdinalIgnoreCase);

        // ---- existing tables of the target schema
        var existing = new Dictionary<string, CatalogObject>(CaseComparer(td));
        if (target is not null)
        {
            try
            {
                await using var reader = await target.Provider.OpenCatalogReaderAsync(target.Profile, target.Password, ct).ConfigureAwait(false);
                var cat = await reader.LoadSchemaAsync(targetDb, targetSchema ?? "", ct).ConfigureAwait(false);
                foreach (var o in cat.Objects.Where(o => o.Type is ObjectTypes.Table or ObjectTypes.View)) existing[o.Name] = o;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // a schema that does not exist yet has no tables
            }
        }

        // ---- read the source tables
        var sources = new List<SourceTable>();
        foreach (var t in spec.Tables)
        {
            ct.ThrowIfCancellationRequested();
            var schema = Blank(t.Schema) ?? sourceSchema ?? "";
            var isView = string.Equals(t.Type, "view", StringComparison.OrdinalIgnoreCase);
            try
            {
                var model = await ReadSourceAsync(source, sourceDb, schema, t.Name, isView, ct).ConfigureAwait(false);
                sources.Add(new SourceTable(t, schema, t.Name, isView, model, null));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                sources.Add(new SourceTable(t, schema, t.Name, isView, null, ex.Message));
            }
        }

        // ---- target names of every table (foreign keys point at them)
        var targetNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in sources)
            targetNames[Key(s.Schema, s.Name)] = Blank(s.Spec.TargetName) ?? TransferSql.CaseFold(s.Name, opts.NameCase, td);

        var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var warnings = new List<string>();
        var prepared = new List<PreparedTable>();
        foreach (var s in sources)
        {
            ct.ThrowIfCancellationRequested();
            var pt = BuildTable(s, spec, opts, sd, td, scripter, ctx, knownTypes, targetSchema, targetNames, existing, target is null, sameLocation, usedNames, sourceSchema);
            prepared.Add(pt);
        }
        UnifyForeignKeyTypes(prepared, opts);
        foreach (var p in prepared) p.Script?.Invoke();

        // ---- order: referenced tables first
        var ordered = OrderByDependencies(prepared, targetNames);
        var schemaStatements = new List<string>();
        if (opts.CreateSchema && !string.IsNullOrEmpty(targetSchema) && opts.CreateMode != CreateModes.None && TransferSql.CreateSchema(td, targetSchema) is { } cs)
            schemaStatements.Add(cs);

        var wire = new TransferPlan(source.Provider.Id, targetProvider.Id, CoreJson.ToWire(td), ordered.Select(p => p.Planned).ToList(), warnings, schemaStatements);
        return new PreparedPlan
        {
            Wire = wire, Tables = ordered, SourceDialect = sd, TargetDialect = td, TargetProviderId = targetProvider.Id, TargetSchema = targetSchema,
            Options = opts, SameLocation = sameLocation,
        };
    }

    // ------------------------------------------------------------------ validation / lookups

    private static void Validate(TransferSpec spec)
    {
        if (spec is null) throw EngineException.Validation("A request body is required.");
        if (spec.Source is null || string.IsNullOrWhiteSpace(spec.Source.ConnectionId))
            throw EngineException.Validation("source.connectionId is required.", new { field = "source.connectionId" });
        if (spec.Target is null) throw EngineException.Validation("target is required.", new { field = "target" });
        if (spec.Tables is null || spec.Tables.Count == 0) throw EngineException.Validation("Pick at least one table.", new { field = "tables" });
        if (spec.Tables.Any(t => string.IsNullOrWhiteSpace(t.Name))) throw EngineException.Validation("Every table needs a name.", new { field = "tables" });
        var o = spec.Opts;
        if (!CreateModes.IsKnown(o.CreateMode)) throw EngineException.Validation($"Unknown createMode '{o.CreateMode}'.", new { field = "options.createMode" });
        if (!DataModes.IsKnown(o.DataMode)) throw EngineException.Validation($"Unknown dataMode '{o.DataMode}'.", new { field = "options.dataMode" });
        if (!NameCases.IsKnown(o.NameCase)) throw EngineException.Validation($"Unknown nameCase '{o.NameCase}'.", new { field = "options.nameCase" });
        if (o.BatchSize is < 1 or > 100_000) throw EngineException.Validation("batchSize must be between 1 and 100000.", new { field = "options.batchSize" });
        if (o.CreateMode == CreateModes.None && o.DataMode == DataModes.None)
            throw EngineException.Validation("Nothing to do: choose to create tables, copy data, or both.", new { field = "options" });
        if (spec.Target.IsFile && spec.Target.ConnectionId is { Length: > 0 } && string.IsNullOrWhiteSpace(spec.Target.DumpProvider))
            throw EngineException.Validation("target.dumpProvider is required for a SQL file.", new { field = "target.dumpProvider" });
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static string Key(string schema, string name) => schema + "\u0001" + name;

    private static StringComparer CaseComparer(Dialect d) => d is Dialect.TSql or Dialect.Sqlite ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private async Task<string?> DefaultSchemaAsync(TransferConnection c, string? database, CancellationToken ct)
    {
        try
        {
            await using var reader = await c.Provider.OpenCatalogReaderAsync(c.Profile, c.Password, ct).ConfigureAwait(false);
            var s = await reader.GetDefaultSchemaAsync(database, ct).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(s)) return s;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // fall through to the dialect default
        }
        return DialectInfo.DefaultSchemaFallback(c.Provider.Dialect) is { Length: > 0 } f ? f : database;
    }

    /// <summary>The source table as a <see cref="TableModel"/>: from the designer when it can read it, else from the catalog.</summary>
    private async Task<TableModel> ReadSourceAsync(TransferConnection c, string? database, string schema, string name, bool isView, CancellationToken ct)
    {
        TableModel? model = null;
        if (!isView)
        {
            try
            {
                model = await env.Features.Database(c.Provider.Id).ReadTableAsync(c.Profile, c.Password, database, schema, name, ct).ConfigureAwait(false);
            }
            catch (EngineException ex) when (ex.Status == 404) { throw; }
            catch (EngineException) { model = null; }
        }
        if (model is null || model.Columns.Any(col => string.IsNullOrWhiteSpace(col.Type)))
        {
            await using var reader = await c.Provider.OpenCatalogReaderAsync(c.Profile, c.Password, ct).ConfigureAwait(false);
            var details = await reader.GetObjectDetailsAsync(new ObjectRef(database, schema, name, isView ? ObjectTypes.View : ObjectTypes.Table), ct).ConfigureAwait(false);
            if (details.Columns.Count == 0) throw EngineException.NotFound($"Table {schema}.{name}");
            if (model is null)
            {
                model = new TableModel
                {
                    Schema = schema, Name = name,
                    Columns = details.Columns.OrderBy(x => x.Ordinal).Select(x => new TableColumnModel
                    {
                        Id = x.Name, Name = x.Name, Type = x.Type, Nullable = x.Nullable, Default = x.Default,
                        Identity = x.IsIdentity ? new IdentityModel() : null, Comment = x.Comment,
                    }).ToList(),
                    PrimaryKey = details.Columns.Any(x => x.IsPk)
                        ? new PrimaryKeyModel { Columns = details.Columns.Where(x => x.IsPk).OrderBy(x => x.Ordinal).Select(x => x.Name).ToList() }
                        : null,
                    Indexes = details.Indexes.Where(i => !i.IsPrimaryKey).Select(i => new IndexModel { Name = i.Name, Unique = i.Unique, Columns = i.Columns.Select(cn => new IndexColumnModel(cn)).ToList() }).ToList(),
                    ForeignKeys = details.ForeignKeys.Select(f => new ForeignKeyModel { Name = f.Name, Columns = [.. f.Columns], RefSchema = f.RefSchema, RefTable = f.RefTable, RefColumns = [.. f.RefColumns] }).ToList(),
                };
            }
            else
            {
                // computed columns have no type in the designer model: take it from the catalog
                var types = details.Columns.ToDictionary(x => x.Name, x => x.Type, StringComparer.OrdinalIgnoreCase);
                model = model with
                {
                    Columns = model.Columns.Select(col => string.IsNullOrWhiteSpace(col.Type) && types.TryGetValue(col.Name, out var ty) ? col with { Type = ty } : col).ToList(),
                };
            }
        }
        return model with { Schema = schema, Name = name };
    }

    // ------------------------------------------------------------------ per table

    private PreparedTable BuildTable(SourceTable s, TransferSpec spec, TransferOptions opts, Dialect sd, Dialect td, IDdlScripter scripter, DdlScriptContext ctx,
        HashSet<string> knownTypes, string? targetSchema, Dictionary<string, string> targetNames, Dictionary<string, CatalogObject> existing,
        bool isFile, bool sameLocation, HashSet<string> usedNames, string? sourceSchema)
    {
        var tgtName = targetNames[Key(s.Schema, s.Name)];
        var warnings = new List<string>();
        var tSchema = targetSchema ?? "";
        PlannedTable Failed(string error) => new(s.Schema, s.Name, s.IsView ? "view" : "table", tSchema, tgtName, [], [], [], warnings, false, null, s.Spec.Where, error);

        if (s.Model is null)
        {
            var pf = new PreparedTable { Planned = Failed(s.Error ?? "Could not read the source table."), SourceSchema = s.Schema, SourceName = s.Name, Where = s.Spec.Where };
            return pf;
        }
        // AUTO_INCREMENT / AUTOINCREMENT columns are identity columns for the transfer
        var model = s.Model with { Columns = s.Model.Columns.Select(c => c.Autoincrement && c.Identity is null ? c with { Identity = new IdentityModel() } : c).ToList() };
        var spec0 = s.Spec;
        var excluded = new HashSet<string>(spec0.ExcludedColumns ?? [], StringComparer.OrdinalIgnoreCase);
        var overrides = new Dictionary<string, string>(spec0.ColumnTypes ?? [], StringComparer.OrdinalIgnoreCase);

        // ---- existing target table?
        CatalogObject? exist = null;
        if (!isFile)
        {
            if (!existing.TryGetValue(tgtName, out exist) && CaseComparer(td) != StringComparer.OrdinalIgnoreCase)
            {
                // a table that differs only by case is the one to append to when we are not creating
                if (opts.CreateMode is CreateModes.None or CreateModes.SkipExisting)
                    exist = existing.Values.FirstOrDefault(o => string.Equals(o.Name, tgtName, StringComparison.OrdinalIgnoreCase));
            }
            if (exist is not null) tgtName = exist.Name;
        }
        var pt = new PreparedTable { Planned = Failed(""), SourceSchema = s.Schema, SourceName = s.Name, Where = s.Spec.Where, SourceModel = model, SourceKind = s.IsView ? "view" : "table" };

        string? error = null;
        var recreate = opts.CreateMode != CreateModes.None;
        if (exist is not null)
        {
            switch (opts.CreateMode)
            {
                case CreateModes.DropExisting:
                    pt.DropFirst = true;
                    pt.CreateTable = true;
                    break;
                case CreateModes.FailIfExists:
                    error = $"The table {tSchema}.{tgtName} already exists in the target.";
                    break;
                case CreateModes.SkipExisting:
                    warnings.Add($"The table {tgtName} exists in the target: its structure is kept.");
                    break;
            }
        }
        else if (opts.CreateMode == CreateModes.None && !isFile)
        {
            error = $"The table {tSchema}.{tgtName} does not exist in the target (creating tables is switched off).";
        }
        else
        {
            pt.CreateTable = opts.CreateMode != CreateModes.None;
        }
        if (isFile && opts.CreateMode == CreateModes.DropExisting) pt.DropFirst = true;
        var useExisting = exist is not null && !pt.CreateTable;
        var existingCols = useExisting
            ? exist!.Columns.ToDictionary(c => c.Name, c => c, CaseComparer(td))
            : null;

        // ---- key columns (text keys need a bounded type on some targets)
        var keyCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (model.PrimaryKey is not null) foreach (var c in model.PrimaryKey.Columns) keyCols.Add(c);
        foreach (var u in model.Uniques) foreach (var c in u.Columns) keyCols.Add(c);
        foreach (var ix in model.Indexes) foreach (var c in ix.Columns) keyCols.Add(c.Name);
        foreach (var fk in model.ForeignKeys) foreach (var c in fk.Columns) keyCols.Add(c);

        // ---- columns
        var plannedCols = new List<PlannedColumn>();
        var targetColumns = new List<TableColumnModel>();
        var colNameMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var featuresIdentity = scripter.GetTypes(ctx).Features;
        foreach (var col in model.Columns)
        {
            var srcType = string.IsNullOrWhiteSpace(col.Type) ? "text" : col.Type;
            var canon = TypeMapper.Parse(sd, srcType);
            var isKey = keyCols.Contains(col.Name) || (model.PrimaryKey?.Columns.Contains(col.Name, StringComparer.OrdinalIgnoreCase) ?? false);
            var mapped = TypeMapper.Map(sd, srcType, td, isKey, knownTypes);
            var tgtColName = TransferSql.CaseFold(col.Name, opts.NameCase, td);
            string? note = mapped.Note;
            var excl = excluded.Contains(col.Name);

            // rowversion cannot be written back
            if (sd == Dialect.TSql && td == Dialect.TSql && TypeMapper.Split(srcType).Base is "rowversion" or "timestamp")
            {
                excl = true;
                note = "rowversion values are generated by the server and not copied";
            }
            var defaultType = mapped.Text;
            var overridden = false;
            var finalType = mapped.Text;
            if (overrides.TryGetValue(col.Name, out var ov) && !string.IsNullOrWhiteSpace(ov) && !ov.Trim().Equals(mapped.Text, StringComparison.OrdinalIgnoreCase))
            {
                finalType = ov.Trim();
                overridden = true;
                note = "type chosen by you";
            }

            if (useExisting)
            {
                if (existingCols!.TryGetValue(tgtColName, out var ec) || existingCols.TryGetValue(col.Name, out ec) ||
                    (ec = exist!.Columns.FirstOrDefault(x => string.Equals(x.Name, col.Name, StringComparison.OrdinalIgnoreCase))) is not null)
                {
                    tgtColName = ec.Name;
                    finalType = ec.TypeText;
                    if (ec.Flags != 0 && (ec.Flags & 2) != 0) { excl = true; note = "computed column in the target is not written"; }
                    else if ((ec.Flags & 8) != 0) { excl = true; note = "never written by DML in the target"; }
                    if ((ec.Flags & 1) != 0 && !excl)
                    {
                        if (opts.Identity)
                        {
                            pt.IdentityInsert = true;
                            pt.IdentityColumn = ec.Name;
                        }
                        else
                        {
                            excl = true;
                            note = "identity column is generated by the target";
                        }
                    }
                }
                else
                {
                    excl = true;
                    note = "no such column in the target table";
                }
            }

            var targetCanon = TypeMapper.Parse(td, finalType);
            colNameMap[col.Name] = tgtColName;

            plannedCols.Add(new PlannedColumn(col.Name, tgtColName, srcType, finalType, defaultType, col.Nullable, isKey && (model.PrimaryKey?.Columns.Contains(col.Name, StringComparer.OrdinalIgnoreCase) ?? false),
                col.Identity is not null, col.Computed is not null, overridden, excl, note));
            if (excl) continue;

            var identity = col.Identity is not null && opts.Identity && IdentitySupported(td, featuresIdentity, model, opts);
            if (col.Identity is not null && opts.Identity && !identity && !useExisting) warnings.Add($"Column {col.Name}: identity is not supported by the target here, values are copied as plain numbers.");
            if (identity && !useExisting)
            {
                pt.IdentityInsert = true;
                pt.IdentityColumn = tgtColName;
            }
            string? def = null;
            if (opts.Defaults && col.Default is not null && col.Computed is null && !identity)
            {
                def = TypeMapper.MapDefault(col.Default, sd, td, targetCanon, out var reason);
                if (reason is not null) warnings.Add($"Column {col.Name}: {reason}.");
            }
            if (col.Computed is not null) warnings.Add($"Column {col.Name} is computed in the source: its values are copied as a plain column.");
            if (!string.IsNullOrEmpty(note) && !overridden && mapped.Note is not null) warnings.Add($"Column {col.Name}: {note}.");

            targetColumns.Add(new TableColumnModel
            {
                Id = tgtColName, Name = tgtColName, Type = finalType, Nullable = col.Nullable && !(model.PrimaryKey?.Columns.Contains(col.Name, StringComparer.OrdinalIgnoreCase) ?? false),
                Default = def, Comment = opts.Comments ? col.Comment : null,
                Identity = identity ? (col.Identity! with { Always = false }) : null,
                Collation = sd == td ? col.Collation : null,
            });
            var tcol = new TargetColumn(tgtColName, targetCanon, finalType, identity || (useExisting && pt.IdentityColumn == tgtColName), false);
            pt.Columns.Add(new ColumnMap
            {
                SourceName = col.Name, SourceType = srcType, SourceCanon = canon, TargetName = tgtColName, Target = tcol,
                SelectItem = TransferSql.SelectColumn(sd, col.Name, canon, srcType),
            });
        }

        if (pt.Columns.Count == 0 && error is null) error = "No column left to copy.";

        // ---- keys for upsert
        var pkCols = model.PrimaryKey?.Columns.Where(c => colNameMap.ContainsKey(c)).Select(c => colNameMap[c]).ToList() ?? [];
        if (useExisting && exist is not null && pkCols.Count == 0)
            pkCols = exist.PrimaryKey.ToList();
        if (model.PrimaryKey is not null && model.PrimaryKey.Columns.Any(c => !colNameMap.ContainsKey(c))) pkCols = [];
        pt.KeyColumnsTarget.AddRange(pkCols);
        if (opts.DataMode == DataModes.Upsert)
        {
            if (pkCols.Count == 0) warnings.Add("The table has no primary key: rows are appended instead of upserted.");
            else if (td is Dialect.ClickHouse or Dialect.Snowflake or Dialect.Cql) warnings.Add("Upsert is not supported by this target: rows are appended.");
        }
        for (var i = 0; i < pt.Columns.Count; i++)
        {
            var c = pt.Columns[i];
            if (pkCols.Contains(c.TargetName, StringComparer.OrdinalIgnoreCase))
                pt.Columns[i] = new ColumnMap
                {
                    SourceName = c.SourceName, SourceType = c.SourceType, SourceCanon = c.SourceCanon, TargetName = c.TargetName, SelectItem = c.SelectItem,
                    Target = c.Target with { IsKey = true },
                };
        }

        // ---- create / post statements
        var create = new List<string>();
        var post = new List<string>();
        long? estimate = null;
        pt.Planned = new PlannedTable(s.Schema, s.Name, s.IsView ? "view" : "table", tSchema, tgtName, plannedCols, create, post, warnings,
            exist is not null, estimate, s.Spec.Where, error);
        pt.ColumnModels = targetColumns;
        // Scripting runs once every table is mapped: foreign key columns first take over the type of the column they reference.
        pt.Script = () =>
        {
            if (pt.Planned.Error is not null || !(pt.CreateTable || isFile && opts.CreateMode != CreateModes.None)) return;
            try
            {
                BuildModels(s, model, opts, sd, td, tSchema, tgtName, targetColumns, colNameMap, targetNames, sameLocation, usedNames, warnings,
                    out var createModel, out var fullModel);
                foreach (var st in scripter.ScriptTable(null, createModel, ctx).Statements) create.Add(st.Sql);
                if (!ReferenceEquals(createModel, fullModel) && (fullModel.Indexes.Count > 0 || fullModel.ForeignKeys.Count > 0))
                {
                    foreach (var st in scripter.ScriptTable(createModel, fullModel, ctx).Statements) post.Add(st.Sql);
                }
            }
            catch (ArgumentException ex)
            {
                pt.Planned = pt.Planned with { Error = ex.Message };
            }
            catch (EngineException ex)
            {
                pt.Planned = pt.Planned with { Error = ex.Message };
            }
        };
        return pt;
    }

    /// <summary>
    /// Foreign key columns get the type of the column they reference (SQL Server and MySQL refuse a foreign key between
    /// different types, and the mapping of the two sides can differ, e.g. SQLite "int" next to "integer").
    /// </summary>
    private static void UnifyForeignKeyTypes(List<PreparedTable> tables, TransferOptions opts)
    {
        if (!opts.ForeignKeys) return;
        var byKey = new Dictionary<string, PreparedTable>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tables) byKey[Key(t.SourceSchema, t.SourceName)] = t;
        // repeat: a chain of references settles in as many rounds as it is long
        for (var round = 0; round < 4; round++)
        {
            var changed = false;
            foreach (var child in tables)
            {
                if (child.SourceModel is null || child.Planned.Error is not null) continue;
                foreach (var fk in child.SourceModel.ForeignKeys)
                {
                    var refSchema = string.IsNullOrEmpty(fk.RefSchema) ? child.SourceSchema : fk.RefSchema;
                    if (!byKey.TryGetValue(Key(refSchema, fk.RefTable), out var parent) || parent.Planned.Error is not null) continue;
                    for (var i = 0; i < fk.Columns.Count && i < fk.RefColumns.Count; i++)
                    {
                        var cc = child.Columns.FindIndex(c => c.SourceName.Equals(fk.Columns[i], StringComparison.OrdinalIgnoreCase));
                        var pc = parent.Columns.FindIndex(c => c.SourceName.Equals(fk.RefColumns[i], StringComparison.OrdinalIgnoreCase));
                        if (cc < 0 || pc < 0) continue;
                        var from = child.Columns[cc];
                        var to = parent.Columns[pc];
                        if (string.Equals(from.Target.TypeText, to.Target.TypeText, StringComparison.OrdinalIgnoreCase)) continue;
                        var plannedIdx = child.Planned.Columns.FindIndex(c => c.Name.Equals(from.SourceName, StringComparison.OrdinalIgnoreCase));
                        if (plannedIdx < 0 || child.Planned.Columns[plannedIdx].Overridden) continue;
                        var pcol = parent.Planned.Columns.Find(c => c.Name.Equals(to.SourceName, StringComparison.OrdinalIgnoreCase));
                        if (pcol is null) continue;
                        child.Columns[cc] = new ColumnMap
                        {
                            SourceName = from.SourceName, SourceType = from.SourceType, SourceCanon = from.SourceCanon, TargetName = from.TargetName,
                            SelectItem = from.SelectItem, Target = from.Target with { TypeText = to.Target.TypeText, Type = to.Target.Type },
                        };
                        var old = child.Planned.Columns[plannedIdx];
                        child.Planned.Columns[plannedIdx] = old with
                        {
                            TargetType = to.Target.TypeText,
                            Note = $"takes the type of the column it references ({parent.Planned.TargetName}.{to.TargetName})",
                        };
                        var mi = child.ColumnModels.FindIndex(m => m.Name == from.TargetName);
                        if (mi >= 0) child.ColumnModels[mi] = child.ColumnModels[mi] with { Type = to.Target.TypeText };
                        changed = true;
                    }
                }
            }
            if (!changed) break;
        }
    }

    private static bool IdentitySupported(Dialect td, DesignerFeatures f, TableModel model, TransferOptions opts)
    {
        switch (td)
        {
            case Dialect.TSql or Dialect.PgSql or Dialect.PlSql or Dialect.Snowflake:
                return f.Identity;
            case Dialect.MySql or Dialect.Sqlite:
                // AUTO_INCREMENT / AUTOINCREMENT need the column to be (part of) the key
                return opts.PrimaryKeys && model.PrimaryKey is not null;
            default:
                return false;
        }
    }

    private void BuildModels(SourceTable s, TableModel src, TransferOptions opts, Dialect sd, Dialect td, string tSchema, string tgtName,
        List<TableColumnModel> columns, Dictionary<string, string> colMap, Dictionary<string, string> targetNames, bool sameLocation,
        HashSet<string> usedNames, List<string> warnings, out TableModel createModel, out TableModel fullModel)
    {
        string Col(string c) => colMap.TryGetValue(c, out var m) ? m : TransferSql.CaseFold(c, opts.NameCase, td);
        bool AllMapped(IEnumerable<string> cs) => cs.All(colMap.ContainsKey);

        var limit = NameLimit(td);
        string Name(string? original, string fallback, bool schemaScoped)
        {
            string n;
            var regenerate = string.IsNullOrWhiteSpace(original) || sameLocation;
            n = regenerate ? fallback : TransferSql.CaseFold(original!, opts.NameCase, td);
            n = Trim(n, limit);
            if (schemaScoped)
            {
                var candidate = n;
                var i = 2;
                while (!usedNames.Add(tSchema + "\u0001" + candidate))
                    candidate = Trim(n, limit - 3) + "_" + i++;
                n = candidate;
            }
            return n;
        }

        var schemaScoped = td is Dialect.TSql or Dialect.PgSql or Dialect.Sqlite or Dialect.PlSql or Dialect.Snowflake;

        PrimaryKeyModel? pk = null;
        if (opts.PrimaryKeys && src.PrimaryKey is { Columns.Count: > 0 } spk)
        {
            if (AllMapped(spk.Columns))
                pk = new PrimaryKeyModel { Name = Name(spk.Name, TransferSql.CaseFold($"PK_{tgtName}", opts.NameCase, td), td != Dialect.MySql), Columns = spk.Columns.Select(Col).ToList(), Clustered = sd == td ? spk.Clustered : true };
            else warnings.Add("Primary key skipped: it uses a column that is not copied.");
        }
        var uniques = new List<UniqueModel>();
        if (opts.Uniques)
        {
            foreach (var u in src.Uniques)
            {
                if (!AllMapped(u.Columns)) { warnings.Add($"Unique constraint {u.Name} skipped: it uses a column that is not copied."); continue; }
                var cols = u.Columns.Select(Col).ToList();
                uniques.Add(new UniqueModel { Name = Name(u.Name, TransferSql.CaseFold($"UQ_{tgtName}_{string.Join('_', cols)}", opts.NameCase, td), schemaScoped), Columns = cols });
            }
        }
        var indexes = new List<IndexModel>();
        if (opts.Indexes && td is not (Dialect.ClickHouse or Dialect.Cql or Dialect.Snowflake))
        {
            var feat = true;
            foreach (var ix in src.Indexes)
            {
                if (!ix.Columns.All(c => colMap.ContainsKey(c.Name))) { warnings.Add($"Index {ix.Name} skipped: it uses an expression or a column that is not copied."); continue; }
                var include = ix.Include.Where(colMap.ContainsKey).Select(Col).ToList();
                var filter = ix.Filter;
                if (!string.IsNullOrWhiteSpace(filter) && sd != td) { warnings.Add($"Index {ix.Name}: the filter {filter} was not copied."); filter = null; }
                var cols = ix.Columns.Select(c => new IndexColumnModel(Col(c.Name), c.Desc)).ToList();
                indexes.Add(new IndexModel
                {
                    Name = Name(ix.Name, TransferSql.CaseFold($"IX_{tgtName}_{string.Join('_', cols.Select(c => c.Name))}", opts.NameCase, td), schemaScoped),
                    Columns = cols, Unique = ix.Unique, Clustered = sd == td && ix.Clustered, Include = feat ? include : [], Filter = filter,
                });
            }
        }
        else if (opts.Indexes && src.Indexes.Count > 0)
        {
            warnings.Add("The target does not support secondary indexes: they were skipped.");
        }
        var checks = new List<CheckModel>();
        foreach (var ck in src.Checks)
        {
            if (sd == td && opts.Defaults) checks.Add(new CheckModel { Name = ck.Name is null ? null : Name(ck.Name, ck.Name, schemaScoped), Expression = ck.Expression });
            else warnings.Add($"Check constraint {ck.Name} was not copied (expressions are dialect specific).");
        }
        var fks = new List<ForeignKeyModel>();
        if (opts.ForeignKeys && td is not (Dialect.ClickHouse or Dialect.Cql))
        {
            foreach (var fk in src.ForeignKeys)
            {
                var refSchema = string.IsNullOrEmpty(fk.RefSchema) ? s.Schema : fk.RefSchema;
                if (!AllMapped(fk.Columns)) { warnings.Add($"Foreign key {fk.Name} skipped: it uses a column that is not copied."); continue; }
                if (!targetNames.TryGetValue(Key(refSchema, fk.RefTable), out var refTarget))
                {
                    warnings.Add($"Foreign key {fk.Name} skipped: {fk.RefTable} is not part of this transfer.");
                    continue;
                }
                fks.Add(new ForeignKeyModel
                {
                    Name = Name(fk.Name, TransferSql.CaseFold($"FK_{tgtName}_{refTarget}_{string.Join('_', fk.Columns.Select(Col))}", opts.NameCase, td), schemaScoped),
                    Columns = fk.Columns.Select(Col).ToList(), RefSchema = tSchema, RefTable = refTarget,
                    RefColumns = fk.RefColumns.Select(c => TransferSql.CaseFold(c, opts.NameCase, td)).ToList(),
                    OnDelete = MapAction(fk.OnDelete, td), OnUpdate = MapAction(fk.OnUpdate, td),
                });
            }
        }
        else if (opts.ForeignKeys && src.ForeignKeys.Count > 0)
        {
            warnings.Add("The target does not support foreign keys: they were skipped.");
        }

        var options = new TableOptions();
        if (td == Dialect.ClickHouse)
        {
            options = new TableOptions
            {
                Extra = new Dictionary<string, string>
                {
                    ["engine"] = "MergeTree",
                    ["orderBy"] = pk is { Columns.Count: > 0 } ? "(" + string.Join(", ", pk.Columns.Select(c => TransferSql.Quote(td, c))) + ")" : "tuple()",
                },
            };
        }

        var baseModel = new TableModel
        {
            Schema = tSchema, Name = tgtName, Comment = opts.Comments ? src.Comment : null, Options = options, Columns = columns, PrimaryKey = pk,
            Uniques = uniques, Checks = checks,
        };
        // SQLite cannot ALTER ... ADD FOREIGN KEY: it goes inline into CREATE TABLE
        if (td == Dialect.Sqlite)
        {
            createModel = baseModel with { ForeignKeys = fks };
            fullModel = createModel with { Indexes = indexes };
        }
        else
        {
            createModel = baseModel;
            fullModel = baseModel with { Indexes = indexes, ForeignKeys = fks };
        }
        if (indexes.Count == 0 && (td == Dialect.Sqlite || fks.Count == 0)) fullModel = createModel;
    }

    private static string MapAction(string action, Dialect td)
    {
        var a = ReferentialActions.Normalize(action);
        if (td is Dialect.TSql or Dialect.PlSql && a == ReferentialActions.Restrict) return ReferentialActions.NoAction;
        if (td == Dialect.PlSql && a is ReferentialActions.SetDefault) return ReferentialActions.NoAction;
        return a;
    }

    private static int NameLimit(Dialect d) => d switch { Dialect.PgSql => 63, Dialect.MySql => 64, Dialect.TSql => 128, Dialect.PlSql => 128, _ => 255 };

    private static string Trim(string name, int limit) => name.Length <= limit ? name : name[..limit];

    // ------------------------------------------------------------------ ordering

    /// <summary>Parents before children (stable for independent tables; cycles keep their input order).</summary>
    private static List<PreparedTable> OrderByDependencies(List<PreparedTable> tables, Dictionary<string, string> targetNames)
    {
        var byKey = new Dictionary<string, PreparedTable>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in tables) byKey[Key(t.SourceSchema, t.SourceName)] = t;
        var result = new List<PreparedTable>();
        var state = new Dictionary<PreparedTable, int>();
        void Visit(PreparedTable t)
        {
            if (state.TryGetValue(t, out var st) && st != 0) return;
            state[t] = 1;
            if (t.SourceModel is not null)
            {
                foreach (var fk in t.SourceModel.ForeignKeys)
                {
                    var refSchema = string.IsNullOrEmpty(fk.RefSchema) ? t.SourceSchema : fk.RefSchema;
                    if (byKey.TryGetValue(Key(refSchema, fk.RefTable), out var parent) && !ReferenceEquals(parent, t)) Visit(parent);
                }
            }
            state[t] = 2;
            result.Add(t);
        }
        foreach (var t in tables) Visit(t);
        return result;
    }
}
