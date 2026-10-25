using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using DbStudio.Core.Catalog;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Import.Parsing;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import.Run;

internal sealed class ImportStopException(string message) : Exception(message);

/// <summary>Everything one import run needs (resolved by <see cref="ImportService"/>).</summary>
internal sealed record ImportRunContext(ImportRequest Request, string ConnectionId, ConnectionProfile Profile, IDbProvider Provider, string? Password,
    ImportDialect Dialect, IServiceProvider Services, CatalogService Catalog, string ReportDirectory, ILogger Log);

/// <summary>
/// The import pipeline: streams the source, converts every row to the target column types, writes batches (isolating bad
/// rows when a batch fails), reports progress, and rolls back or commits according to the options.
/// </summary>
internal static class ImportRunner
{
    private sealed record Pending(object?[] Values, long Row, object?[] Raw);

    public static async Task<ImportSummary> RunAsync(ImportRunContext rc, JobContext job, CancellationToken ct)
    {
        var req = rc.Request;
        var d = rc.Dialect;
        var sw = Stopwatch.StartNew();
        var mode = req.Mode;
        if (!d.Modes.Contains(mode)) throw EngineException.Validation($"Import mode '{mode}' is not supported for {rc.Provider.DisplayName}.", new { field = "mode" });
        if (req.Columns.Count == 0) throw EngineException.Validation("No columns are mapped.", new { field = "columns" });
        if (string.IsNullOrWhiteSpace(req.Target.Table)) throw EngineException.Validation("The target table is required.", new { field = "target.table" });

        var srcOptions = RowSources.Resolve(req.Path, req.Source);
        using var source = RowSources.Open(req.Path, srcOptions);
        var parser = new ValueParser(srcOptions);
        var converter = new CellConverter(parser);

        // ---- target columns
        var create = req.Target.Create;
        var tableName = create ? d.Fold(req.Target.Table) : req.Target.Table;
        var table = d.Qualify(req.Target.Database, req.Target.Schema, tableName);
        var cols = new List<TargetCol>();
        List<NewColumnSpec>? newColumns = null;
        List<string> primaryKey = [];
        if (create)
        {
            newColumns = [];
            var pk = new HashSet<string>((req.PrimaryKey ?? []).Select(d.Fold), StringComparer.OrdinalIgnoreCase);
            foreach (var m in req.Columns)
            {
                var name = d.Fold(m.Target);
                var sqlType = string.IsNullOrWhiteSpace(m.SqlType) ? d.SqlType(m.Inferred ?? new InferredType(Kinds.Text, 255)) : m.SqlType!.Trim();
                var nullable = (m.Nullable ?? true) && !pk.Contains(name);
                var kind = d.Classify(sqlType, out var max);
                cols.Add(new TargetCol(name, kind, sqlType, max, nullable, false, false));
                newColumns.Add(new NewColumnSpec(name, sqlType, nullable));
            }
            primaryKey = cols.Where(c => pk.Contains(c.Name)).Select(c => c.Name).ToList();
        }
        else
        {
            var (info, existing) = await TargetInfoReader.ReadAsync(rc.Catalog, rc.ConnectionId, d, req.Target.Database, req.Target.Schema, req.Target.Table, ct).ConfigureAwait(false);
            if (!info.Exists) throw EngineException.NotFound($"Table '{req.Target.Table}'");
            foreach (var m in req.Columns)
            {
                var i = existing.FindIndex(c => string.Equals(c.Name, m.Target, StringComparison.OrdinalIgnoreCase));
                if (i < 0) throw EngineException.Validation($"The table has no column '{m.Target}'.", new { field = "columns", column = m.Target });
                if (info.Columns[i].IsComputed) throw EngineException.Validation($"Column '{m.Target}' is computed and cannot be written.", new { field = "columns", column = m.Target });
                cols.Add(existing[i]);
            }
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in cols) if (!seen.Add(c.Name)) throw EngineException.Validation($"Column '{c.Name}' is mapped twice.", new { field = "columns", column = c.Name });
        for (var i = 0; i < req.Columns.Count; i++)
        {
            var f = req.Columns[i].From;
            if (f.Kind == "source" && (f.Index is null || f.Index < 0 || f.Index >= source.Columns.Count))
                throw EngineException.Validation($"Column '{req.Columns[i].Target}' maps from source column {f.Index}, which does not exist.", new { field = "columns" });
        }

        var keys = new List<string>();
        if (mode is "upsert" or "updateOnly")
        {
            if (req.KeyColumns is not { Count: > 0 }) throw EngineException.Validation("Key columns are required for this import mode.", new { field = "keyColumns" });
            foreach (var k in req.KeyColumns)
            {
                var c = cols.FirstOrDefault(x => string.Equals(x.Name, create ? d.Fold(k) : k, StringComparison.OrdinalIgnoreCase))
                        ?? throw EngineException.Validation($"Key column '{k}' is not among the mapped columns.", new { field = "keyColumns" });
                keys.Add(c.Name);
            }
        }

        var sourceColumns = source.Columns.ToList();
        var batchSize = Math.Max(1, req.BatchSize ?? d.DefaultBatchSize);
        if (d.Savepoint("x") is null && d.Transactional)
            batchSize = Math.Min(batchSize, d.RowsPerStatement(cols.Count)); // no savepoints: a batch must be one atomic statement
        var wholeTx = req.Transaction && d.Transactional;
        var onErrorSkip = string.Equals(req.OnError, "skip", StringComparison.OrdinalIgnoreCase);
        var maxErrors = req.MaxErrors ?? 1000;
        var limit = req.Limit ?? 0;

        // ---- state
        long read = 0, written = 0, skipped = 0, errors = 0;
        var sample = new List<ImportRowError>();
        using var report = new ErrorReport(rc.ReportDirectory, job.JobId, sourceColumns);
        ErrorReport.Cleanup(rc.ReportDirectory, TimeSpan.FromDays(7));
        string? createdTable = null, ddl = null, failure = null;
        var committed = false;
        var rolledBack = false;
        var cancelled = false;
        var loadMethod = "";
        var lastReport = Stopwatch.GetTimestamp();
        long lastReportRows = 0;
        double rate = 0;
        var phase = "preparing";

        void Progress(bool force = false)
        {
            var now = Stopwatch.GetTimestamp();
            var dt = Stopwatch.GetElapsedTime(lastReport, now).TotalSeconds;
            if (!force && dt < 0.25) return;
            if (dt > 0)
            {
                var inst = (read - lastReportRows) / dt;
                rate = rate == 0 ? inst : rate * 0.6 + inst * 0.4;
            }
            lastReport = now;
            lastReportRows = read;
            var p = new ImportProgress(phase, read, written, skipped, errors, Math.Round(rate, 1), source.Position, source.Length);
            job.Report(read, null, JsonSerializer.Serialize(p, CoreJson.Options), force);
        }

        void AddError(long row, string? column, string message, object?[] raw)
        {
            errors++;
            skipped++;
            var values = raw.Select(v => v is null ? null : Trunc(CellConverter.Text(v))).ToList();
            report.Add(row, column, message, values);
            if (sample.Count < 50) sample.Add(new ImportRowError(row, column, message, values));
        }

        await using var conn = await ImportConnections.OpenAsync(rc.Provider, rc.Profile, rc.Password, req.Target.Database, rc.Services, ct).ConfigureAwait(false);
        await using var writer = new TargetWriter(conn, d, table, cols, keys, mode, req.UseBulk ?? true);
        loadMethod = writer.LoadMethod;

        try
        {
            if (create)
            {
                ddl = d.CreateTable(table, newColumns!, primaryKey);
                await writer.ExecuteAsync(ddl, ct).ConfigureAwait(false);
                createdTable = table;
            }

            var identityInsert = d.Dialect == Dialect.TSql && cols.Any(c => c.IsIdentity);
            if (identityInsert) await writer.ExecuteAsync($"SET IDENTITY_INSERT {table} ON", ct).ConfigureAwait(false);
            if (d is PgImportDialect pg && cols.Any(c => c.IsIdentity)) pg.OverrideIdentity = true;

            if (wholeTx) await writer.BeginAsync(ct).ConfigureAwait(false);
            if (mode == "truncateInsert")
            {
                phase = "truncating";
                Progress(true);
                await writer.ClearAsync(ct).ConfigureAwait(false);
            }
            phase = "importing";
            Progress(true);

            var batch = new List<Pending>(batchSize);
            var rowCount = req.Columns.Count;

            while (source.Read())
            {
                ct.ThrowIfCancellationRequested();
                if (limit > 0 && read >= limit) break;
                read++;
                var raw = source.Current;
                var values = new object?[rowCount];
                string? badColumn = null, badMessage = null;
                for (var j = 0; j < rowCount; j++)
                {
                    var m = req.Columns[j];
                    var col = cols[j];
                    try
                    {
                        var rawValue = m.From.Kind switch
                        {
                            "constant" => m.From.Value,
                            "expression" => Expression(m.From.Name, source.RowNumber, req.Path),
                            _ => raw[m.From.Index!.Value],
                        };
                        var v = rawValue is Guid g && col.Kind == Kinds.Guid ? g : converter.Convert(rawValue, col.Kind);
                        if (v is null && !col.Nullable && !col.IsIdentity)
                            throw new ValueConversionException(col.HasDefault
                                ? $"Column '{col.Name}' does not allow NULL and the source value is empty (a column default is not used for empty values; leave the column unmapped to use it)."
                                : $"Column '{col.Name}' does not allow NULL and the source value is empty.");
                        if (v is string s && col.MaxLength is { } max && d.Dialect != Dialect.PlSql && s.Length > max)
                            throw new ValueConversionException($"Text is too long for column '{col.Name}' ({s.Length} characters, maximum {max}).");
                        values[j] = v;
                    }
                    catch (ValueConversionException ex)
                    {
                        badColumn = col.Name;
                        badMessage = ex.Message;
                        break;
                    }
                }
                if (badMessage is not null)
                {
                    AddError(source.RowNumber, badColumn, badMessage, raw);
                    if (!onErrorSkip) throw new ImportStopException($"Row {source.RowNumber}: {badMessage}");
                    if (maxErrors > 0 && errors >= maxErrors) throw new ImportStopException($"Stopped after {errors} bad rows.");
                    continue;
                }
                batch.Add(new Pending(values, source.RowNumber, raw));
                if (batch.Count >= batchSize)
                {
                    await FlushAsync().ConfigureAwait(false);
                    batch.Clear();
                }
                Progress();
            }
            if (batch.Count > 0) await FlushAsync().ConfigureAwait(false);

            phase = "committing";
            Progress(true);
            if (wholeTx) await writer.CommitAsync(ct).ConfigureAwait(false);
            committed = written > 0 || create;

            async Task FlushAsync()
            {
                if (!wholeTx) await writer.BeginAsync(ct).ConfigureAwait(false);
                var rows = batch.Select(p => p.Values).ToList();
                var sp = await writer.SavepointAsync(ct).ConfigureAwait(false);
                bool stop = false;
                try
                {
                    var matched = await writer.WriteAsync(rows, false, ct).ConfigureAwait(false);
                    await writer.ReleaseAsync(sp, ct).ConfigureAwait(false);
                    written += matched;
                    skipped += rows.Count - matched;
                }
                catch (Exception ex) when (ex is not OperationCanceledException && conn.Db.State == ConnectionState.Open)
                {
                    rc.Log.LogDebug(ex, "Import batch failed; isolating rows");
                    await writer.RollbackToAsync(sp).ConfigureAwait(false);
                    foreach (var p in batch)
                    {
                        ct.ThrowIfCancellationRequested();
                        var rsp = await writer.SavepointAsync(ct).ConfigureAwait(false);
                        try
                        {
                            var matched = await writer.WriteAsync([p.Values], true, ct).ConfigureAwait(false);
                            await writer.ReleaseAsync(rsp, ct).ConfigureAwait(false);
                            written += matched;
                            skipped += 1 - matched;
                        }
                        catch (Exception rowEx) when (rowEx is not OperationCanceledException && conn.Db.State == ConnectionState.Open)
                        {
                            await writer.RollbackToAsync(rsp).ConfigureAwait(false);
                            var msg = FirstLine(rowEx.Message);
                            AddError(p.Row, null, msg, p.Raw);
                            if (!onErrorSkip) { stop = true; failure = $"Row {p.Row}: {msg}"; break; }
                            if (maxErrors > 0 && errors >= maxErrors) { stop = true; failure = $"Stopped after {errors} bad rows."; break; }
                        }
                    }
                }
                if (!wholeTx) await writer.CommitAsync(ct).ConfigureAwait(false);
                if (stop) throw new ImportStopException(failure!);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            cancelled = true;
        }
        catch (ImportStopException ex)
        {
            failure = ex.Message;
        }
        catch (Exception ex) when (ex is not EngineException)
        {
            rc.Log.LogWarning(ex, "Import {JobId} failed", job.JobId);
            failure = FirstLine(ex.Message);
        }

        // ---- finish: rollback / cleanup
        var unsuccessful = cancelled || failure is not null;
        if (unsuccessful)
        {
            if (wholeTx)
            {
                await writer.RollbackAsync().ConfigureAwait(false);
                rolledBack = true;
                committed = false;
            }
            else
            {
                await writer.RollbackAsync().ConfigureAwait(false); // the batch in flight
                committed = written > 0 || createdTable is not null;
            }
        }
        if (createdTable is not null && unsuccessful && wholeTx)
        {
            try
            {
                await writer.ExecuteAsync(d.DropTable(createdTable), CancellationToken.None).ConfigureAwait(false);
                createdTable = null;
                ddl = null;
            }
            catch (Exception ex)
            {
                rc.Log.LogWarning(ex, "Could not drop the table created by the failed import {JobId}", job.JobId);
            }
        }
        if (d.Dialect == Dialect.TSql && cols.Any(c => c.IsIdentity))
        {
            try { await writer.ExecuteAsync($"SET IDENTITY_INSERT {table} OFF", CancellationToken.None).ConfigureAwait(false); }
            catch (Exception) { /* connection closes anyway */ }
        }
        if (rolledBack) written = 0;
        report.Dispose();

        phase = "done";
        Progress(true);
        if (createdTable is not null)
        {
            try
            {
                await rc.Catalog.RefreshAsync(rc.ConnectionId, string.IsNullOrWhiteSpace(req.Target.Database) ? null : req.Target.Database,
                    string.IsNullOrWhiteSpace(req.Target.Schema) ? null : [req.Target.Schema], CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                rc.Log.LogDebug(ex, "Catalog refresh after import failed");
            }
        }

        var outcome = cancelled ? "cancelled" : failure is not null ? "failed" : errors > 0 ? "completedWithErrors" : "completed";
        var elapsed = sw.ElapsedMilliseconds;
        return new ImportSummary(outcome, failure, read, written, skipped, errors, elapsed, elapsed > 0 ? Math.Round(read * 1000.0 / elapsed, 1) : read,
            committed, rolledBack, createdTable, ddl, sample, report.Count > 0, loadMethod);
    }

    private static object? Expression(string? name, long row, string path) => name switch
    {
        "now" => DateTime.SpecifyKind(DateTime.Now, DateTimeKind.Unspecified),
        "utcNow" => DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified),
        "uuid" => Guid.NewGuid(),
        "rowNumber" => row,
        "fileName" => Path.GetFileName(path),
        _ => throw new ValueConversionException($"Unknown expression '{name}'."),
    };

    private static string FirstLine(string message)
    {
        var i = message.IndexOfAny(['\r', '\n']);
        var s = i > 0 ? message[..i] : message;
        return s.Length > 500 ? s[..500] : s;
    }

    private static string Trunc(string s) => s.Length > 1000 ? s[..1000] : s;
}
