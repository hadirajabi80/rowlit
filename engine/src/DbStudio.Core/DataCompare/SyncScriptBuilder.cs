using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Core.DataCompare;

/// <summary>The SQL that reads one side of a comparison: column list, filter and the key order.</summary>
public static class DataCompareSql
{
    /// <summary>Dialects whose servers can sort the rows (CQL cannot ORDER BY an arbitrary column).</summary>
    public static bool CanOrder(Dialect d) => d != Dialect.Cql;

    /// <summary>
    /// The ORDER BY expression of a key column that sorts the way <see cref="KeyComparer"/> does: text by code point (binary
    /// collations), GUIDs as text, everything else by value.
    /// </summary>
    public static string OrderExpression(Dialect d, string quoted, ValueFamily family, CanonType type)
    {
        if (family is not (ValueFamily.Text or ValueFamily.Guid)) return quoted;
        var plainText = type.Kind is TypeKind.Char or TypeKind.VarChar or TypeKind.Text;
        return d switch
        {
            Dialect.TSql => family == ValueFamily.Guid ? $"CAST({quoted} AS char(36)) COLLATE Latin1_General_BIN2"
                : plainText ? $"{quoted} COLLATE Latin1_General_BIN2" : $"CAST({quoted} AS nvarchar(4000)) COLLATE Latin1_General_BIN2",
            Dialect.PgSql => $"CAST({quoted} AS text) COLLATE \"C\"",
            Dialect.MySql => $"CAST(CONVERT({quoted} USING utf8mb4) AS BINARY)",
            // a CAST keeps the column's collation (NOCASE, RTRIM): BINARY is the code point order
            Dialect.Sqlite => $"CAST({quoted} AS TEXT) COLLATE BINARY",
            Dialect.PlSql => $"NLSSORT({quoted}, 'NLS_SORT=BINARY')",
            _ => quoted,
        };
    }

    /// <summary>SELECT of one side; <paramref name="order"/> null = unordered (the engine sorts).</summary>
    public static string Select(Dialect d, string from, IEnumerable<string> items, string? where,
        IReadOnlyList<(string Quoted, ValueFamily Family, CanonType Type, bool Nullable)>? order)
    {
        var sb = new StringBuilder("SELECT ").Append(string.Join(", ", items)).Append(" FROM ").Append(from);
        if (!string.IsNullOrWhiteSpace(where)) sb.Append(" WHERE ").Append(where.Trim());
        if (order is { Count: > 0 } && CanOrder(d))
        {
            var parts = new List<string>();
            foreach (var o in order)
            {
                if (o.Nullable) parts.Add($"CASE WHEN {o.Quoted} IS NULL THEN 0 ELSE 1 END");
                parts.Add(OrderExpression(d, o.Quoted, o.Family, o.Type));
            }
            sb.Append(" ORDER BY ").Append(string.Join(", ", parts));
        }
        return sb.ToString();
    }

    /// <summary>A query side as a derived table (the newline keeps a trailing line comment inside the parentheses).</summary>
    public static string QueryFrom(string query) => "(\n" + TrimQuery(query) + "\n) dcq";

    public static string TrimQuery(string query)
    {
        var q = query.Trim();
        while (q.EndsWith(';')) q = q[..^1].TrimEnd();
        return q;
    }

    /// <summary>A WHERE filter must be one condition: no ';' and no comments outside string literals.</summary>
    public static void CheckWhere(string? where, string field)
    {
        if (string.IsNullOrWhiteSpace(where)) return;
        var inQuote = false;
        for (var i = 0; i < where.Length; i++)
        {
            var c = where[i];
            if (c == '\'') inQuote = !inQuote;
            else if (!inQuote && (c == ';' || (c == '-' && i + 1 < where.Length && where[i + 1] == '-') || (c == '/' && i + 1 < where.Length && where[i + 1] == '*')))
                throw EngineException.Validation("The filter must be a single condition (no ';' or comments).", new { field });
        }
    }

    /// <summary>A query must be one statement (a ';' is allowed at its end only).</summary>
    public static void CheckQuery(string query, string field)
    {
        var q = TrimQuery(query);
        if (q.Length == 0) throw EngineException.Validation("The query is empty.", new { field });
        var inQuote = false;
        for (var i = 0; i < q.Length; i++)
        {
            var c = q[i];
            if (c == '\'') inQuote = !inQuote;
            else if (!inQuote && c == ';') throw EngineException.Validation("The query must be a single statement.", new { field });
        }
    }
}

/// <summary>A column of the table a sync writes, in the order of the compared rows.</summary>
/// <param name="Writable">False for columns the side cannot be written (computed, rowversion) or does not have.</param>
public sealed record SyncColumn(string Name, CanonType Type, string TypeText, bool IsKey, bool Identity, bool Writable);

public sealed record BuiltSync(List<string> Statements, long Inserts, long Updates, long Deletes, List<string> Warnings);

/// <summary>
/// The statements that make one side of a comparison like the other: DELETE (rows only on the changed side), UPDATE (only
/// the changed columns, matched on the key values of the changed side) and INSERT (multi-row, WP-3's
/// <see cref="TransferSql.BuildInsert"/>), literals rendered by <see cref="TransferSql.Literal"/> for the column types of
/// the changed side (<see cref="TypeMapper.Parse"/>). Statements carry no terminator; <see cref="Text"/> adds them.
/// </summary>
public static class SyncScriptBuilder
{
    private const int MaxInsertRows = 200;
    private const int MaxInList = 200;
    private const int MaxOrGroups = 50;

    /// <summary>Dialects a sync can write.</summary>
    public static bool CanWrite(Dialect d) => d is Dialect.TSql or Dialect.PgSql or Dialect.MySql or Dialect.Sqlite or Dialect.PlSql;

    /// <param name="columns">Columns of the changed side, aligned with the row arrays of <paramref name="diffs"/>.</param>
    /// <param name="toTarget">Make the target like the source (else the source like the target).</param>
    /// <param name="classes">Compare classes to sync (<see cref="DiffClasses"/>).</param>
    public static BuiltSync Build(Dialect d, string? schema, string table, IReadOnlyList<SyncColumn> columns, IEnumerable<DataDiffRow> diffs,
        bool toTarget, IReadOnlySet<string> classes)
    {
        if (!columns.Any(c => c.IsKey)) throw EngineException.Validation("A sync needs key columns.");
        var qt = TransferSql.Qualified(d, schema, table);
        var insertClass = toTarget ? DiffClasses.OnlyInSource : DiffClasses.OnlyInTarget;
        var deleteClass = toTarget ? DiffClasses.OnlyInTarget : DiffClasses.OnlyInSource;
        var keyIdx = columns.Select((c, i) => (c, i)).Where(x => x.c.IsKey).Select(x => x.i).ToArray();
        var writable = columns.Select((c, i) => (c, i)).Where(x => x.c.Writable).ToList();
        var warnings = new List<string>();

        var deletes = new List<object?[]>();
        var updates = new List<(object?[] From, object?[] Where, int[] Changed)>();
        var inserts = new List<object?[]>();
        var skippedUpdates = 0;
        foreach (var diff in diffs)
        {
            if (!classes.Contains(diff.Class)) continue;
            var from = toTarget ? diff.Source : diff.Target;
            var self = toTarget ? diff.Target : diff.Source;
            if (diff.Class == deleteClass && self is not null) deletes.Add(self);
            else if (diff.Class == insertClass && from is not null) inserts.Add(from);
            else if (diff.Class == DiffClasses.Changed && from is not null && self is not null)
            {
                var changed = (diff.Changed ?? []).Where(i => i >= 0 && i < columns.Count && columns[i].Writable && !columns[i].IsKey).ToArray();
                if (changed.Length == 0) skippedUpdates++;
                else updates.Add((from, self, changed));
            }
        }
        if (skippedUpdates > 0) warnings.Add($"{skippedUpdates} changed rows differ only in columns that cannot be written (computed / generated): they are left as they are.");

        var statements = new List<string>();
        // ---- deletes first (frees unique values), then updates, then inserts
        if (deletes.Count > 0)
        {
            if (keyIdx.Length == 1 && deletes.All(r => r[keyIdx[0]] is not null))
            {
                var k = columns[keyIdx[0]];
                foreach (var chunk in deletes.Chunk(MaxInList))
                    statements.Add($"DELETE FROM {qt} WHERE {TransferSql.Quote(d, k.Name)} IN ({string.Join(", ", chunk.Select(r => KeyLiteral(d, r[keyIdx[0]], k)))})");
            }
            else
            {
                foreach (var chunk in deletes.Chunk(MaxOrGroups))
                    statements.Add($"DELETE FROM {qt} WHERE {string.Join(" OR ", chunk.Select(r => "(" + Match(d, columns, keyIdx, r) + ")"))}");
            }
        }
        foreach (var (from, where, changed) in updates)
        {
            var set = string.Join(", ", changed.Select(i => $"{TransferSql.Quote(d, columns[i].Name)} = {TransferSql.Literal(d, from[i], columns[i].Type, columns[i].TypeText)}"));
            statements.Add($"UPDATE {qt} SET {set} WHERE {Match(d, columns, keyIdx, where)}");
        }
        if (inserts.Count > 0)
        {
            var cols = writable.Select(x => new TargetColumn(x.c.Name, x.c.Type, x.c.TypeText, x.c.Identity, x.c.IsKey)).ToList();
            var identity = writable.FirstOrDefault(x => x.c.Identity);
            var mode = new InsertMode(identity.c is not null, false);
            var per = Math.Min(MaxInsertRows, TransferSql.MaxRowsPerInsert(d));
            foreach (var chunk in inserts.Chunk(per))
            {
                var rows = chunk.Select(r => writable.Select(x => r[x.i]).ToArray()).ToList();
                statements.AddRange(TransferSql.BuildInsert(d, qt, cols, rows, mode));
            }
            if (identity.c is not null)
            {
                if (TransferSql.ResetIdentity(d, schema, table, identity.c.Name) is { } reset) statements.Add(reset);
                if (d == Dialect.PlSql) warnings.Add($"{identity.c.Name} is an identity column: the inserts fail if it is GENERATED ALWAYS.");
            }
        }
        return new BuiltSync(statements, inserts.Count, updates.Count, deletes.Count, warnings);
    }

    private static string Match(Dialect d, IReadOnlyList<SyncColumn> columns, int[] keyIdx, object?[] row) =>
        string.Join(" AND ", keyIdx.Select(i => row[i] is null
            ? $"{TransferSql.Quote(d, columns[i].Name)} IS NULL"
            : $"{TransferSql.Quote(d, columns[i].Name)} = {KeyLiteral(d, row[i], columns[i])}"));

    /// <summary>
    /// A key value of the changed side itself: rendered for its own column type, except SQLite text (dates stored as text
    /// must match byte for byte, not be reformatted).
    /// </summary>
    private static string KeyLiteral(Dialect d, object? wire, SyncColumn c)
    {
        if (d == Dialect.Sqlite && wire is string s && c.Type.Kind is not (TypeKind.Int or TypeKind.Decimal or TypeKind.Float or TypeKind.Boolean))
            return TransferSql.Str(d, s);
        return TransferSql.Literal(d, wire, c.Type, c.TypeText);
    }

    /// <summary>The script as console text: header comments, statements with terminators.</summary>
    public static string Text(Dialect d, string header, BuiltSync built)
    {
        var sb = new StringBuilder();
        foreach (var line in header.Split('\n')) sb.Append("-- ").Append(line.TrimEnd('\r')).Append('\n');
        foreach (var w in built.Warnings) sb.Append("-- WARNING: ").Append(w.Replace('\n', ' ')).Append('\n');
        sb.Append('\n');
        foreach (var st in built.Statements)
        {
            var sql = st.TrimEnd();
            sb.Append(sql);
            if (!sql.EndsWith(';')) sb.Append(';');
            sb.Append(d == Dialect.TSql ? "\nGO\n\n" : "\n\n");
        }
        return sb.ToString().TrimEnd() + "\n";
    }
}
