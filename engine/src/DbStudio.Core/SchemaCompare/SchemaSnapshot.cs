using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Sql;

namespace DbStudio.Core.SchemaCompare;

/// <summary>Everything the compare needs to talk to one connection's provider.</summary>
internal sealed record ProviderContext(ConnectionProfile Profile, string? Password, IDbProvider Provider, IDesignerDatabase Db, IDdlScripter Scripter)
{
    public Dialect Dialect => Provider.Dialect;
    public string ProviderId => Provider.Id;
}

/// <summary>
/// A non-table object of a schema (view, routine, trigger, sequence, type, package).
/// </summary>
/// <param name="Key">"kind:name" (PostgreSQL routines add the signature: "func:fn_tax(amount numeric)").</param>
/// <param name="Ddl">The definition as stored on the server (views: the CREATE VIEW the designer scripter generates).</param>
/// <param name="OnTable">Triggers: the table.</param>
/// <param name="Columns">Views: the output columns (PostgreSQL decides CREATE OR REPLACE VIEW vs DROP + CREATE with them).</param>
internal sealed record DbObject(string Kind, string Key, string Name, string Ddl, string? OnTable = null, IReadOnlyList<CatalogColumn>? Columns = null,
    ViewModel? View = null);

internal sealed class SchemaSnapshot
{
    public required string? Database { get; init; }
    public required string Schema { get; init; }
    public Dictionary<string, TableModel> Tables { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, DbObject> Objects { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<string> Notes { get; } = [];
}

/// <summary>Reads a schema into a <see cref="SchemaSnapshot"/> with the provider's catalog reader and designer database.</summary>
internal static class SnapshotReader
{
    private const int Parallelism = 4;

    public static async Task<(string? Database, string Schema)> ResolveAsync(ProviderContext p, CompareEndpoint ep, CancellationToken ct)
    {
        var database = string.IsNullOrWhiteSpace(ep.Database) ? null : ep.Database.Trim();
        var schema = string.IsNullOrWhiteSpace(ep.Schema) ? null : ep.Schema.Trim();
        if (DialectInfo.SchemaIsDatabase(p.Dialect))
        {
            // MySQL / MariaDB / Oracle: the catalog has no database level, the schema is the database.
            schema ??= database;
            database = null;
            if (schema is null) throw EngineException.Validation("Pick a schema to compare.", new { field = "schema" });
            return (null, schema);
        }
        if (schema is null)
        {
            await using var reader = await p.Provider.OpenCatalogReaderAsync(p.Profile, p.Password, ct).ConfigureAwait(false);
            schema = await reader.GetDefaultSchemaAsync(database, ct).ConfigureAwait(false);
        }
        return (database, schema);
    }

    public static async Task<SchemaSnapshot> ReadAsync(ProviderContext p, string? database, string schema, CompareOptions options, Action<string> progress,
        Action<int> addTotal, CancellationToken ct)
    {
        var snap = new SchemaSnapshot { Database = database, Schema = schema };
        await using var reader = await p.Provider.OpenCatalogReaderAsync(p.Profile, p.Password, ct).ConfigureAwait(false);
        SchemaCatalog catalog;
        try
        {
            catalog = await reader.LoadSchemaAsync(database, schema, ct).ConfigureAwait(false);
        }
        catch (EngineException ex) when (ex.Code == ErrorCodes.NotFound)
        {
            throw EngineException.Validation($"Schema '{schema}' was not found.", new { field = "schema" });
        }

        var tables = new List<CatalogObject>();
        var views = new List<CatalogObject>();
        var others = new List<(CatalogObject Obj, string Kind)>();
        var skipped = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var o in catalog.Objects)
        {
            if (IsInternal(o)) continue;
            switch (o.Type)
            {
                case ObjectTypes.Table: if (options.Tables) tables.Add(o); break;
                case ObjectTypes.View: if (options.Views) views.Add(o); break;
                case ObjectTypes.MView: skipped.Add("materialized views"); break;
                case ObjectTypes.Proc: if (options.Procedures) others.Add((o, CompareKinds.Proc)); break;
                case ObjectTypes.Func or ObjectTypes.TableFunc: if (options.Functions) others.Add((o, CompareKinds.Func)); break;
                case ObjectTypes.Trigger: if (options.Triggers) others.Add((o, CompareKinds.Trigger)); break;
                case ObjectTypes.Sequence: if (options.Sequences) others.Add((o, CompareKinds.Sequence)); break;
                case ObjectTypes.Package: if (options.Procedures) others.Add((o, CompareKinds.Package)); break;
                case ObjectTypes.Type when p.Dialect == Dialect.PgSql: if (options.Tables) others.Add((o, CompareKinds.Type)); break;
                case ObjectTypes.Type: skipped.Add("user-defined types"); break;
                case ObjectTypes.Synonym: skipped.Add("synonyms"); break;
            }
        }
        if (skipped.Count > 0) snap.Notes.Add($"Not compared in {schema}: {string.Join(", ", skipped)}.");

        addTotal(tables.Count + views.Count + others.Select(x => x.Obj.Name).Distinct(StringComparer.Ordinal).Count());

        // tables and views: one short connection each, a few at a time
        var gate = new SemaphoreSlim(Parallelism);
        var tableTasks = tables.DistinctBy(t => t.Name, StringComparer.Ordinal).Select(async t =>
        {
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var model = await p.Db.ReadTableAsync(p.Profile, p.Password, database, schema, t.Name, ct).ConfigureAwait(false);
                progress(t.Name);
                return (t.Name, Model: (TableModel?)model);
            }
            finally { gate.Release(); }
        }).ToList();
        var viewTasks = views.DistinctBy(v => v.Name, StringComparer.Ordinal).Select(async v =>
        {
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                ViewModel? model = null;
                try { model = await p.Db.ReadViewAsync(p.Profile, p.Password, database, schema, v.Name, ct).ConfigureAwait(false); }
                catch (EngineException ex) when (ex.Code != ErrorCodes.NotFound)
                {
                    lock (snap.Notes) snap.Notes.Add($"View {v.Name} was skipped: {ex.Message}");
                }
                progress(v.Name);
                return (Object: v, Model: model);
            }
            finally { gate.Release(); }
        }).ToList();

        // routines, triggers, sequences: the catalog reader owns one connection, so one after the other
        foreach (var group in others.GroupBy(x => (x.Kind, x.Obj.Name), (k, g) => g.First()))
        {
            ct.ThrowIfCancellationRequested();
            progress(group.Obj.Name);
            string ddl;
            try
            {
                var r = await reader.GetDdlAsync(new ObjectRef(database, schema, group.Obj.Name, group.Obj.Type), ct).ConfigureAwait(false);
                ddl = r.Ddl;
            }
            catch (EngineException ex)
            {
                snap.Notes.Add($"{group.Kind} {group.Obj.Name} was skipped: {ex.Message}");
                continue;
            }
            if (ddl.TrimStart().StartsWith("--", StringComparison.Ordinal) && !CompareSql.ParseHeader(ddl, p.Dialect).Kind.Any())
            {
                snap.Notes.Add($"{group.Kind} {group.Obj.Name} was skipped: its definition is not available (encrypted or not visible).");
                continue;
            }
            AddObjects(snap, p.Dialect, group.Kind, group.Obj, ddl);
        }

        foreach (var (name, model) in await Task.WhenAll(tableTasks).ConfigureAwait(false))
            if (model is not null) snap.Tables[name] = model;
        foreach (var (obj, model) in await Task.WhenAll(viewTasks).ConfigureAwait(false))
        {
            if (model is null) continue;
            var def = new ViewDefinition(schema, obj.Name, null, model.Body, model.Options);
            string ddl;
            try
            {
                ddl = string.Join(";\n", p.Scripter.ScriptView(def, new DdlScriptContext(DefaultSchema: schema)).Statements.Select(s => s.Sql)) + ";";
            }
            catch (ArgumentException)
            {
                ddl = model.Ddl;
            }
            snap.Objects[CompareIds.Key(CompareKinds.View, obj.Name)] = new DbObject(CompareKinds.View, CompareIds.Key(CompareKinds.View, obj.Name), obj.Name, ddl,
                Columns: obj.Columns, View: model);
        }
        return snap;
    }

    private static bool IsInternal(CatalogObject o) =>
        o.Name.StartsWith("BIN$", StringComparison.Ordinal) || o.Name.StartsWith("ISEQ$$", StringComparison.Ordinal)
        || (o.Type == ObjectTypes.Sequence && o.Comment is { } c && c.Contains("owned by", StringComparison.OrdinalIgnoreCase));

    private static void AddObjects(SchemaSnapshot snap, Dialect dialect, string kind, CatalogObject obj, string ddl)
    {
        if (dialect == Dialect.PgSql && kind is CompareKinds.Proc or CompareKinds.Func)
        {
            // GetDdl returns every overload of the name: each one is its own object, keyed by its parameter list.
            foreach (var statement in CompareSql.SplitStatements(ddl, dialect))
            {
                var header = CompareSql.ParseHeader(statement, dialect);
                var k = header.Kind switch { "PROCEDURE" or "PROC" => CompareKinds.Proc, _ => CompareKinds.Func };
                var signature = PgSignature(statement, header, dialect);
                var key = CompareIds.Key(k, obj.Name + signature);
                snap.Objects[key] = new DbObject(k, key, obj.Name + signature, statement);
            }
            return;
        }
        var trimmed = ddl.Trim();
        if (dialect == Dialect.PgSql && kind == CompareKinds.Trigger)
        {
            // GetDdl returns the trigger function first and a COMMENT after: only the CREATE TRIGGER belongs to the trigger.
            var create = CompareSql.SplitStatements(trimmed, dialect).FirstOrDefault(s => CompareSql.ParseHeader(s, dialect).Kind == "TRIGGER");
            if (create is not null) trimmed = create;
        }
        var key2 = CompareIds.Key(kind, obj.Name);
        string? onTable = null;
        if (kind == CompareKinds.Trigger)
            onTable = CompareSql.TriggerTable(trimmed, dialect)?.Table ?? CommentTable(obj.Comment);
        snap.Objects[key2] = new DbObject(kind, key2, obj.Name, trimmed, onTable);
    }

    private static string? CommentTable(string? comment)
    {
        if (comment is null || !comment.StartsWith("on ", StringComparison.OrdinalIgnoreCase)) return null;
        var rest = comment[3..];
        var colon = rest.IndexOf(':');
        return (colon > 0 ? rest[..colon] : rest).Trim();
    }

    /// <summary>"(amount numeric, rate numeric)" for <c>CREATE FUNCTION s.f(amount numeric, rate numeric DEFAULT 1)</c>: names and types, defaults removed.</summary>
    internal static string PgSignature(string statement, CompareSql.CreateHeader header, Dialect dialect)
    {
        if (header.RestStart <= 0 || header.RestStart >= statement.Length) return "()";
        var rest = statement[header.RestStart..];
        var tokens = SqlTokenizer.Tokenize(rest, dialect);
        var open = tokens.FindIndex(t => t.IsPunct('('));
        if (open < 0) return "()";
        var depth = 0;
        var paramStart = tokens[open].End;
        var parts = new List<string>();
        for (var i = open; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (t.IsPunct('(')) { depth++; continue; }
            if (t.IsPunct(')'))
            {
                depth--;
                if (depth == 0)
                {
                    parts.Add(rest[paramStart..t.Start]);
                    break;
                }
                continue;
            }
            if (depth == 1 && t.IsPunct(','))
            {
                parts.Add(rest[paramStart..t.Start]);
                paramStart = t.End;
            }
        }
        var cleaned = parts.Select(StripDefault).Select(s => string.Join(' ', s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))).Where(s => s.Length > 0).ToList();
        return "(" + string.Join(", ", cleaned) + ")";

        string StripDefault(string param)
        {
            var toks = SqlTokenizer.Tokenize(param, dialect);
            var d = 0;
            foreach (var t in toks)
            {
                if (t.IsPunct('(')) d++;
                else if (t.IsPunct(')')) d--;
                else if (d == 0 && (t.IsWord("DEFAULT") || (t.Kind == SqlTokenKind.Operator && t.Value == "="))) return param[..t.Start];
            }
            return param;
        }
    }
}

/// <summary>Item ids: "kind:name".</summary>
internal static class CompareIds
{
    public static string Key(string kind, string name) => kind + ":" + name;
}
