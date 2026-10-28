using System.Data;
using System.Diagnostics;
using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Import.Run;
using Microsoft.Extensions.Logging;

namespace DbStudio.Import.Generate;

/// <summary>
/// The generate job: opens the target through the import's connection builders, builds the row factory, writes batches
/// with <see cref="TargetWriter"/> (isolating rows the server rejects when asked to), reports progress and commits or rolls back.
/// </summary>
internal static class GenerateRunner
{
    private sealed class StopException(string message) : Exception(message);

    private sealed record Pending(object?[] Values, long Row);

    public static async Task<GenerateSummary> RunAsync(GenerateService svc, GenerateRequest req, IServiceProvider services, ILogger log, JobContext job, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var r = await svc.ResolveAsync(req.ConnectionId, ct).ConfigureAwait(false);
        var d = r.Dialect;
        var details = await svc.ReadDetailsAsync(req.ConnectionId, req.Database, req.Schema, req.Table, ct).ConfigureAwait(false);
        var table = d.Qualify(string.IsNullOrWhiteSpace(req.Database) ? null : req.Database, string.IsNullOrWhiteSpace(req.Schema) ? null : req.Schema, details.Ref.Name);

        await using var conn = await ImportConnections.OpenAsync(r.Provider, r.Profile, r.Password, req.Database, services, ct).ConfigureAwait(false);
        var prep = await svc.PrepareAsync(req, r, details, conn, ct).ConfigureAwait(false);
        var factory = prep.Factory;
        var cols = factory.Columns.ToList();
        var total = prep.Rows;

        var batchSize = Math.Max(1, req.BatchSize ?? d.DefaultBatchSize);
        if (d.Savepoint("x") is null && d.Transactional) batchSize = Math.Min(batchSize, d.RowsPerStatement(cols.Count));
        var wholeTx = req.Transaction && d.Transactional;
        var onErrorSkip = string.Equals(req.OnError, "skip", StringComparison.OrdinalIgnoreCase);
        var maxErrors = req.MaxErrors ?? 1000;

        long generated = 0, written = 0, skipped = 0, errors = 0;
        var sample = new List<ImportRowError>();
        using var report = new ErrorReport(svc.ReportDirectory, job.JobId, cols.Select(c => c.Name).ToList());
        ErrorReport.Cleanup(svc.ReportDirectory, TimeSpan.FromDays(7));
        string? failure = null;
        var committed = false;
        var rolledBack = false;
        var cancelled = false;
        var truncated = false;
        var phase = "preparing";
        var lastReport = Stopwatch.GetTimestamp();
        long lastRows = 0;
        double rate = 0;

        void Progress(bool force = false)
        {
            var now = Stopwatch.GetTimestamp();
            var dt = Stopwatch.GetElapsedTime(lastReport, now).TotalSeconds;
            if (!force && dt < 0.25) return;
            if (dt > 0)
            {
                var inst = (generated - lastRows) / dt;
                rate = rate == 0 ? inst : rate * 0.6 + inst * 0.4;
            }
            lastReport = now;
            lastRows = generated;
            var p = new GenerateProgress(phase, generated, total, written, skipped, errors, Math.Round(rate, 1));
            job.Report(generated, total, JsonSerializer.Serialize(p, CoreJson.Options), force);
        }

        void AddError(long row, string message, object?[] values)
        {
            errors++;
            skipped++;
            var texts = values.Select(GenerateService.Display).ToList();
            report.Add(row, null, message, texts);
            if (sample.Count < 50) sample.Add(new ImportRowError(row, null, message, texts));
        }

        await using var writer = new TargetWriter(conn, d, table, cols, [], req.TruncateFirst ? "truncateInsert" : "append", true);
        var loadMethod = writer.LoadMethod;
        var identityInsert = d.Dialect == Dialect.TSql && cols.Any(c => c.IsIdentity);

        try
        {
            if (identityInsert) await writer.ExecuteAsync($"SET IDENTITY_INSERT {table} ON", ct).ConfigureAwait(false);
            if (d is PgImportDialect pg && cols.Any(c => c.IsIdentity)) pg.OverrideIdentity = true;
            if (wholeTx) await writer.BeginAsync(ct).ConfigureAwait(false);
            if (req.TruncateFirst)
            {
                phase = "truncating";
                Progress(true);
                await writer.ClearAsync(ct).ConfigureAwait(false);
                truncated = true;
            }
            phase = "generating";
            Progress(true);

            var batch = new List<Pending>(batchSize);
            for (long row = 0; row < total; row++)
            {
                ct.ThrowIfCancellationRequested();
                batch.Add(new Pending(factory.Row(row), row + 1));
                generated++;
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
            committed = written > 0 || truncated;

            async Task FlushAsync()
            {
                if (!wholeTx) await writer.BeginAsync(ct).ConfigureAwait(false);
                var rows = batch.Select(p => p.Values).ToList();
                var sp = await writer.SavepointAsync(ct).ConfigureAwait(false);
                var stop = false;
                try
                {
                    var n = await writer.WriteAsync(rows, false, ct).ConfigureAwait(false);
                    await writer.ReleaseAsync(sp, ct).ConfigureAwait(false);
                    written += n;
                }
                catch (Exception ex) when (ex is not OperationCanceledException and not GenerateExhaustedException && conn.Db.State == ConnectionState.Open)
                {
                    log.LogDebug(ex, "Generated batch failed; isolating rows");
                    await writer.RollbackToAsync(sp).ConfigureAwait(false);
                    if (!onErrorSkip)
                    {
                        // Report the first offending row so the message names it, then stop.
                        foreach (var p in batch)
                        {
                            ct.ThrowIfCancellationRequested();
                            var rsp = await writer.SavepointAsync(ct).ConfigureAwait(false);
                            try
                            {
                                await writer.WriteAsync([p.Values], true, ct).ConfigureAwait(false);
                                await writer.ReleaseAsync(rsp, ct).ConfigureAwait(false);
                                written++;
                            }
                            catch (Exception rowEx) when (rowEx is not OperationCanceledException && conn.Db.State == ConnectionState.Open)
                            {
                                await writer.RollbackToAsync(rsp).ConfigureAwait(false);
                                var msg = FirstLine(rowEx.Message);
                                AddError(p.Row, msg, p.Values);
                                failure = $"Row {p.Row:N0}: {msg}";
                                stop = true;
                                break;
                            }
                        }
                        if (!stop) failure = FirstLine(ex.Message);
                        stop = true;
                    }
                    else
                    {
                        foreach (var p in batch)
                        {
                            ct.ThrowIfCancellationRequested();
                            var rsp = await writer.SavepointAsync(ct).ConfigureAwait(false);
                            try
                            {
                                await writer.WriteAsync([p.Values], true, ct).ConfigureAwait(false);
                                await writer.ReleaseAsync(rsp, ct).ConfigureAwait(false);
                                written++;
                            }
                            catch (Exception rowEx) when (rowEx is not OperationCanceledException && conn.Db.State == ConnectionState.Open)
                            {
                                await writer.RollbackToAsync(rsp).ConfigureAwait(false);
                                AddError(p.Row, FirstLine(rowEx.Message), p.Values);
                                if (maxErrors > 0 && errors >= maxErrors) { failure = $"Stopped after {errors:N0} rejected rows."; stop = true; break; }
                            }
                        }
                    }
                }
                if (!wholeTx) await writer.CommitAsync(ct).ConfigureAwait(false);
                if (stop) throw new StopException(failure ?? "Stopped.");
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            cancelled = true;
        }
        catch (StopException ex)
        {
            failure = ex.Message;
        }
        catch (GenerateExhaustedException ex)
        {
            failure = ex.Message;
        }
        catch (Exception ex) when (ex is not EngineException)
        {
            log.LogWarning(ex, "Generate {JobId} failed", job.JobId);
            failure = FirstLine(ex.Message);
        }

        var unsuccessful = cancelled || failure is not null;
        if (unsuccessful)
        {
            await writer.RollbackAsync().ConfigureAwait(false);
            if (wholeTx)
            {
                rolledBack = true;
                committed = false;
            }
            else
            {
                committed = written > 0 || truncated;
            }
        }
        if (identityInsert)
        {
            try { await writer.ExecuteAsync($"SET IDENTITY_INSERT {table} OFF", CancellationToken.None).ConfigureAwait(false); }
            catch (Exception) { /* the connection closes anyway */ }
        }
        if (rolledBack) { written = 0; truncated = false; }
        report.Dispose();

        phase = "done";
        Progress(true);
        var outcome = cancelled ? "cancelled" : failure is not null ? "failed" : errors > 0 ? "completedWithErrors" : "completed";
        var elapsed = sw.ElapsedMilliseconds;
        return new GenerateSummary(outcome, failure, total, generated, written, skipped, errors, elapsed, elapsed > 0 ? Math.Round(generated * 1000.0 / elapsed, 1) : generated,
            committed, rolledBack, truncated, sample, report.Count > 0, loadMethod, prep.Seed, prep.Warnings);
    }

    private static string FirstLine(string message)
    {
        var i = message.IndexOfAny(['\r', '\n']);
        var s = i > 0 ? message[..i] : message;
        return s.Length > 500 ? s[..500] : s;
    }
}
