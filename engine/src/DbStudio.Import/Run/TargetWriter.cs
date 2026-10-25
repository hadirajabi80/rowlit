using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text;
using DbStudio.Core.Models;
using DbStudio.Import.Parsing;
using Microsoft.Data.SqlClient;
using Npgsql;
using Oracle.ManagedDataAccess.Client;

namespace DbStudio.Import.Run;

/// <summary>
/// Writes converted rows into the target table over one dedicated connection: bulk paths (SqlBulkCopy, COPY, ClickHouse
/// native insert) where the mode allows, otherwise parameterized multi-row INSERT / MERGE / ON CONFLICT / UPDATE. Owns
/// the transaction and the savepoints the runner uses to isolate bad rows.
/// </summary>
public sealed class TargetWriter(ImportConnection connection, ImportDialect dialect, string qualifiedTable, IReadOnlyList<TargetCol> columns,
    IReadOnlyList<string> keys, string mode, bool useBulk) : IAsyncDisposable
{
    private DbTransaction? _tx;
    private int _spCounter;

    public ImportDialect Dialect => dialect;
    public bool InTransaction => _tx is not null;
    public string LoadMethod => UsesBulk ? dialect.BulkMethod : dialect.ArrayBinding ? "Array binding" : "Batched multi-row INSERT";

    private bool UsesBulk => useBulk && mode is "append" or "truncateInsert" && dialect.Dialect is Core.Models.Dialect.TSql or Core.Models.Dialect.PgSql or Core.Models.Dialect.ClickHouse;

    private DbConnection Db => connection.Db;

    public async Task BeginAsync(CancellationToken ct)
    {
        if (!dialect.Transactional || _tx is not null) return;
        _tx = await Db.BeginTransactionAsync(ct).ConfigureAwait(false);
    }

    public async Task CommitAsync(CancellationToken ct)
    {
        if (_tx is null) return;
        var tx = _tx;
        _tx = null;
        await using (tx.ConfigureAwait(false)) await tx.CommitAsync(ct).ConfigureAwait(false);
    }

    public async Task RollbackAsync()
    {
        if (_tx is null) return;
        var tx = _tx;
        _tx = null;
        try { await tx.RollbackAsync(CancellationToken.None).ConfigureAwait(false); }
        catch (Exception) { /* connection already broken: the server rolled back */ }
        finally { await tx.DisposeAsync().ConfigureAwait(false); }
    }

    // ---- savepoints (null when the dialect has none or no transaction is open)

    public async Task<string?> SavepointAsync(CancellationToken ct)
    {
        if (_tx is null) return null;
        var name = "imp_sp" + (++_spCounter).ToString(CultureInfo.InvariantCulture);
        var sql = dialect.Savepoint(name);
        if (sql is null) return null;
        await ExecAsync(sql, ct).ConfigureAwait(false);
        return name;
    }

    public async Task RollbackToAsync(string? savepoint)
    {
        if (savepoint is null) return;
        var sql = dialect.RollbackToSavepoint(savepoint);
        if (sql is not null) await ExecAsync(sql, CancellationToken.None).ConfigureAwait(false);
    }

    public async Task ReleaseAsync(string? savepoint, CancellationToken ct)
    {
        if (savepoint is null) return;
        var sql = dialect.ReleaseSavepoint(savepoint);
        if (sql is not null) await ExecAsync(sql, ct).ConfigureAwait(false);
    }

    private async Task<long> ExecAsync(string sql, CancellationToken ct)
    {
        await using var cmd = NewCommand(sql);
        return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private DbCommand NewCommand(string sql)
    {
        var cmd = Db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 0;
        cmd.Transaction = _tx;
        return cmd;
    }

    public Task ExecuteAsync(string sql, CancellationToken ct) => ExecAsync(sql, ct);

    // ---- truncate

    /// <summary>Removes all rows. Inside a transaction DELETE is used where TRUNCATE would commit implicitly.</summary>
    public async Task ClearAsync(CancellationToken ct)
    {
        var truncateIsTransactional = dialect.Dialect is Core.Models.Dialect.TSql or Core.Models.Dialect.PgSql;
        if (_tx is not null && !truncateIsTransactional)
        {
            await ExecAsync(dialect.DeleteAllSql(qualifiedTable), ct).ConfigureAwait(false);
            return;
        }
        var sp = await SavepointAsync(ct).ConfigureAwait(false);
        try
        {
            await ExecAsync(dialect.TruncateSql(qualifiedTable), ct).ConfigureAwait(false);
        }
        catch (DbException) when (!ct.IsCancellationRequested)
        {
            // Referenced by a foreign key, or no TRUNCATE permission.
            await RollbackToAsync(sp).ConfigureAwait(false);
            await ExecAsync(dialect.DeleteAllSql(qualifiedTable), ct).ConfigureAwait(false);
        }
    }

    // ---- writing

    /// <summary>Writes the rows; returns the number of rows that were stored (update-only: rows that matched).</summary>
    public async Task<long> WriteAsync(IReadOnlyList<object?[]> rows, bool forceStatements, CancellationToken ct)
    {
        if (rows.Count == 0) return 0;
        if (mode == "updateOnly") return await UpdateAsync(rows, ct).ConfigureAwait(false);
        if (!forceStatements && UsesBulk)
        {
            switch (dialect.Dialect)
            {
                case Core.Models.Dialect.TSql: await SqlBulkAsync(rows, ct).ConfigureAwait(false); return rows.Count;
                case Core.Models.Dialect.PgSql: await PgCopyAsync(rows, ct).ConfigureAwait(false); return rows.Count;
                case Core.Models.Dialect.ClickHouse: await ClickHouseBulkAsync(rows, ct).ConfigureAwait(false); return rows.Count; }
        }
        if (dialect.Dialect == Core.Models.Dialect.ClickHouse && forceStatements) await ClickHouseBulkAsync(rows, ct).ConfigureAwait(false);
        else if (dialect.ArrayBinding) await OracleArrayAsync(rows, mode == "upsert", ct).ConfigureAwait(false);
        else await StatementsAsync(rows, mode == "upsert", ct).ConfigureAwait(false);
        return rows.Count;
    }

    private IReadOnlyList<string> Names => columns.Select(c => c.Name).ToList();

    private async Task StatementsAsync(IReadOnlyList<object?[]> rows, bool upsert, CancellationToken ct)
    {
        var per = dialect.RowsPerStatement(columns.Count);
        for (var start = 0; start < rows.Count; start += per)
        {
            var n = Math.Min(per, rows.Count - start);
            var sql = upsert ? dialect.UpsertSql(qualifiedTable, Names, keys, n) : dialect.InsertSql(qualifiedTable, Names, n);
            await using var cmd = NewCommand(sql);
            var p = 0;
            for (var r = 0; r < n; r++)
                for (var c = 0; c < columns.Count; c++)
                    ParamFactory.Add(cmd, dialect, p++, rows[start + r][c], columns[c]);
            if (dialect.Dialect == Core.Models.Dialect.Snowflake) cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    private async Task OracleArrayAsync(IReadOnlyList<object?[]> rows, bool upsert, CancellationToken ct)
    {
        var sql = upsert ? dialect.UpsertSql(qualifiedTable, Names, keys, 1) : dialect.InsertSql(qualifiedTable, Names, 1);
        await using var cmd = (OracleCommand)NewCommand(sql);
        cmd.ArrayBindCount = rows.Count;
        for (var c = 0; c < columns.Count; c++) ParamFactory.AddOracleArray(cmd, dialect, c, rows, c, columns[c]);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private async Task<long> UpdateAsync(IReadOnlyList<object?[]> rows, CancellationToken ct)
    {
        var keyIdx = keys.Select(k => IndexOf(k)).ToList();
        var setIdx = Enumerable.Range(0, columns.Count).Where(i => !keyIdx.Contains(i)).ToList();
        var order = setIdx.Concat(keyIdx).ToList();
        if (setIdx.Count == 0) throw new ArgumentException("Update-only import needs at least one column besides the key columns.");
        var sql = dialect.UpdateSql(qualifiedTable, setIdx.Select(i => columns[i].Name).ToList(), keys);
        if (dialect.ArrayBinding)
        {
            // Array binding reports one total; matched rows are counted by the driver as the sum of affected rows.
            await using var acmd = (OracleCommand)NewCommand(sql);
            acmd.ArrayBindCount = rows.Count;
            for (var p = 0; p < order.Count; p++) ParamFactory.AddOracleArray(acmd, dialect, p, rows, order[p], columns[order[p]]);
            return await acmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        long matched = 0;
        await using var cmd = NewCommand(sql);
        foreach (var row in rows)
        {
            cmd.Parameters.Clear();
            for (var p = 0; p < order.Count; p++) ParamFactory.Add(cmd, dialect, p, row[order[p]], columns[order[p]]);
            matched += await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0 ? 1 : 0;
        }
        return matched;
    }

    private int IndexOf(string name)
    {
        for (var i = 0; i < columns.Count; i++) if (string.Equals(columns[i].Name, name, StringComparison.OrdinalIgnoreCase)) return i;
        throw new ArgumentException($"Key column '{name}' is not part of the mapped columns.");
    }

    private static Type ClrType(string kind) => kind switch
    {
        Kinds.Bool => typeof(bool),
        Kinds.Int or Kinds.BigInt => typeof(long),
        Kinds.Decimal => typeof(decimal),
        Kinds.Float => typeof(double),
        Kinds.Date or Kinds.DateTime => typeof(DateTime),
        Kinds.Time => typeof(TimeSpan),
        Kinds.Guid => typeof(Guid),
        Kinds.Binary => typeof(byte[]),
        _ => typeof(string),
    };

    private async Task SqlBulkAsync(IReadOnlyList<object?[]> rows, CancellationToken ct)
    {
        var table = new DataTable();
        foreach (var c in columns) table.Columns.Add(c.Name, ClrType(c.Kind));
        table.BeginLoadData();
        var values = new object[columns.Count];
        foreach (var row in rows)
        {
            for (var i = 0; i < values.Length; i++) values[i] = row[i] ?? DBNull.Value;
            table.Rows.Add(values);
        }
        var options = SqlBulkCopyOptions.CheckConstraints | SqlBulkCopyOptions.FireTriggers;
        if (columns.Any(c => c.IsIdentity)) options |= SqlBulkCopyOptions.KeepIdentity;
        using var bc = new SqlBulkCopy((SqlConnection)Db, options, (SqlTransaction?)_tx)
        {
            DestinationTableName = qualifiedTable,
            BulkCopyTimeout = 0,
            BatchSize = rows.Count,
        };
        for (var i = 0; i < columns.Count; i++) bc.ColumnMappings.Add(i, columns[i].Name);
        await bc.WriteToServerAsync(table, ct).ConfigureAwait(false);
    }

    private async Task PgCopyAsync(IReadOnlyList<object?[]> rows, CancellationToken ct)
    {
        var conn = (NpgsqlConnection)Db;
        var sql = $"COPY {qualifiedTable} ({string.Join(", ", columns.Select(c => dialect.Quote(c.Name)))}) FROM STDIN (FORMAT csv, NULL '\\N')";
        var writer = await conn.BeginTextImportAsync(sql, ct).ConfigureAwait(false);
        try
        {
            var sb = new StringBuilder();
            foreach (var row in rows)
            {
                sb.Clear();
                for (var i = 0; i < columns.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    var v = row[i];
                    if (v is null) { sb.Append("\\N"); continue; }
                    sb.Append('"').Append(CopyText(v, columns[i]).Replace("\"", "\"\"", StringComparison.Ordinal)).Append('"');
                }
                sb.Append('\n');
                await writer.WriteAsync(sb.ToString().AsMemory(), ct).ConfigureAwait(false);
            }
        }
        catch
        {
            try { await writer.DisposeAsync().ConfigureAwait(false); } catch (Exception) { /* the COPY failed anyway */ }
            throw;
        }
        await writer.DisposeAsync().ConfigureAwait(false);
    }

    internal static string CopyText(object v, TargetCol col) => v switch
    {
        string s => s,
        bool b => b ? "t" : "f",
        DateTime dt when col.Kind == Kinds.Date => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime dt => dt.ToString("yyyy-MM-dd HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture),
        TimeSpan ts => ts.ToString(@"hh\:mm\:ss\.FFFFFF", CultureInfo.InvariantCulture),
        decimal m => m.ToString(CultureInfo.InvariantCulture),
        double d => d.ToString("R", CultureInfo.InvariantCulture),
        Guid g => g.ToString(),
        byte[] bytes => "\\x" + Convert.ToHexString(bytes),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };

    private async Task ClickHouseBulkAsync(IReadOnlyList<object?[]> rows, CancellationToken ct)
    {
        var conn = (ClickHouse.Driver.ADO.ClickHouseConnection)Db;
        using var bc = new ClickHouse.Driver.Copy.ClickHouseBulkCopy(conn)
        {
            DestinationTableName = qualifiedTable,
            ColumnNames = columns.Select(c => c.Name).ToList(),
            BatchSize = Math.Max(1, rows.Count),
            MaxDegreeOfParallelism = 1,
        };
        await bc.InitAsync().ConfigureAwait(false);
        await bc.WriteToServerAsync(rows.Select(r => (object[])r.Select(v => v!).ToArray()), ct).ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        await RollbackAsync().ConfigureAwait(false);
        await connection.DisposeAsync().ConfigureAwait(false);
    }
}
