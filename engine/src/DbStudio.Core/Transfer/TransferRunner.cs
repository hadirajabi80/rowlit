using System.Diagnostics;
using System.Text;
using System.Threading.Channels;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace DbStudio.Core.Transfer;

/// <summary>A statement the target refused.</summary>
internal sealed class TransferSqlException(string message, string sql) : Exception(message)
{
    public string Sql { get; } = sql;
}

/// <summary>Where statements go: a live session or a .sql file.</summary>
internal abstract class TransferTargetWriter : IAsyncDisposable
{
    public abstract bool IsFile { get; }

    /// <summary>Runs (or writes) the statements in order; a refused statement throws <see cref="TransferSqlException"/>.</summary>
    public abstract Task RunAsync(IReadOnlyList<string> statements, CancellationToken ct);

    public virtual Task CommentAsync(string text) => Task.CompletedTask;

    public virtual ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

internal sealed class LiveTarget(IDbSession session) : TransferTargetWriter
{
    public override bool IsFile => false;

    public override async Task RunAsync(IReadOnlyList<string> statements, CancellationToken ct)
    {
        if (statements.Count == 0) return;
        var batches = statements.Select(s => new SqlBatch(s, 1, 1)).ToList();
        var sink = new ErrorSink();
        var summary = await session.ExecuteAsync(new ExecuteRequest(batches, 0, true, false, "transfer", null, true), sink, ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        if (sink.Failure is { } f)
            throw new TransferSqlException(f.Error.Message, f.Batch >= 0 && f.Batch < statements.Count ? statements[f.Batch] : statements[0]);
        if (summary.Status == ExecutionStatus.Error)
            throw new TransferSqlException("The target reported an error.", statements[0]);
    }

    public override ValueTask DisposeAsync() => session.DisposeAsync();

    /// <summary>Collects the first error; ignores result sets and counts.</summary>
    internal sealed class ErrorSink : IExecutionSink
    {
        public (int Batch, ErrorInfo Error)? Failure { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows) => ValueTask.CompletedTask;
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error)
        {
            Failure ??= (batchIndex, error);
            return ValueTask.CompletedTask;
        }
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }
}

/// <summary>Writes the script of a "Dump SQL file" transfer.</summary>
internal sealed class FileTarget(Stream stream, Dialect dialect) : TransferTargetWriter
{
    private readonly StreamWriter _writer = new(stream, new UTF8Encoding(false), 64 * 1024, leaveOpen: true) { NewLine = "\n" };

    public override bool IsFile => true;

    public override async Task RunAsync(IReadOnlyList<string> statements, CancellationToken ct)
    {
        foreach (var s in statements)
        {
            ct.ThrowIfCancellationRequested();
            var text = s.Trim();
            if (text.Length == 0) continue;
            await _writer.WriteAsync(text).ConfigureAwait(false);
            if (dialect == Dialect.TSql) await _writer.WriteAsync("\nGO\n").ConfigureAwait(false);
            else await _writer.WriteAsync(text.EndsWith(';') ? "\n" : ";\n").ConfigureAwait(false);
        }
    }

    public override async Task CommentAsync(string text)
    {
        foreach (var line in text.Split('\n')) await _writer.WriteLineAsync("-- " + line.TrimEnd('\r')).ConfigureAwait(false);
    }

    public async Task BlankAsync() => await _writer.WriteLineAsync().ConfigureAwait(false);

    public override async ValueTask DisposeAsync()
    {
        await _writer.FlushAsync().ConfigureAwait(false);
        await _writer.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>Runs a prepared plan: structure first, rows streamed in batches, indexes and foreign keys last.</summary>
internal sealed class TransferRunner(ITransferEnvironment env, ILogger? log = null)
{
    private const int MaxErrors = 200;
    private const long MaxBatchBytes = 8L * 1024 * 1024;
    private readonly ILogger _log = log ?? NullLogger.Instance;

    private sealed class TableState
    {
        public string Status = TransferStatus.Skipped;
        public long Rows;
        public long ErrorRows;
        public string? Error;
        public bool Created;
        public long ElapsedMs;
        public long? Total;
    }

    public async Task<TransferResult> RunAsync(PreparedPlan plan, TransferSpec spec, Action<TransferProgress, long, long?>? progress, CancellationToken ct)
    {
        var opts = plan.Options;
        var td = plan.TargetDialect;
        var total = Stopwatch.StartNew();
        var errors = new List<TransferError>();
        var states = plan.Tables.ToDictionary(t => t, _ => new TableState());
        var overallDone = 0L;
        long? overallTotal = null;
        var status = TransferStatus.Ok;
        string? filePath = null;
        long? fileBytes = null;
        FileStream? file = null;
        var targetClosed = false;

        void AddError(string table, string phase, string message, string? sql)
        {
            if (errors.Count < MaxErrors) errors.Add(new TransferError(table, phase, message, sql is { Length: > 600 } ? sql[..600] + " …" : sql));
        }

        TransferTargetWriter? target = null;
        IDbSession? source = null;
        try
        {
            // ---- open target
            if (spec.Target.IsFile)
            {
                filePath = Path.GetFullPath(spec.Target.FilePath!);
                var dir = Path.GetDirectoryName(filePath);
                if (dir is null || !Directory.Exists(dir)) throw EngineException.Validation($"Directory does not exist: {dir}", new { field = "target.filePath" });
                file = new FileStream(filePath + ".partial", FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true);
                var ft = new FileTarget(file, td);
                target = ft;
                await ft.CommentAsync($"Rowlit data transfer\nGenerated {DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}\nSource: {spec.Source.ConnectionId} ({plan.Wire.SourceProvider})\nTarget dialect: {plan.Wire.TargetProvider}").ConfigureAwait(false);
                await ft.BlankAsync().ConfigureAwait(false);
            }
            else
            {
                var tc = env.Resolve(spec.Target.ConnectionId!);
                var session = await tc.Provider.OpenSessionAsync(tc.Profile, tc.Password,
                    new SessionOptions(Ids.New("s"), string.IsNullOrWhiteSpace(spec.Target.Database) ? null : spec.Target.Database, TransactionMode.Auto, false), ct).ConfigureAwait(false);
                target = new LiveTarget(session);
            }

            var wantsData = opts.DataMode != DataModes.None;
            var runnable = plan.Tables.Where(t => t.Planned.Error is null).ToList();
            foreach (var bad in plan.Tables.Where(t => t.Planned.Error is not null))
            {
                states[bad].Status = TransferStatus.Error;
                states[bad].Error = bad.Planned.Error;
                AddError(bad.SourceName, "plan", bad.Planned.Error!, null);
                status = TransferStatus.Partial;
            }

            if (wantsData && runnable.Count > 0)
            {
                var sc = env.Resolve(spec.Source.ConnectionId);
                source = await sc.Provider.OpenSessionAsync(sc.Profile, sc.Password,
                    new SessionOptions(Ids.New("s"), string.IsNullOrWhiteSpace(spec.Source.Database) ? null : spec.Source.Database, TransactionMode.Auto, false), ct).ConfigureAwait(false);
            }

            // ---- counts (for progress)
            if (wantsData && source is not null)
            {
                progress?.Invoke(new TransferProgress("counting", null, 0, runnable.Count, 0, null, 0, "Counting rows"), 0, null);
                long sum = 0;
                var all = true;
                foreach (var t in runnable)
                {
                    ct.ThrowIfCancellationRequested();
                    var c = await CountAsync(source, plan, t, ct).ConfigureAwait(false);
                    states[t].Total = c;
                    if (c is null) all = false; else sum += c.Value;
                }
                overallTotal = all ? sum : null;
            }

            // ---- schema + drops
            var schemaStatements = plan.Wire.SchemaStatements;
            if (schemaStatements.Count > 0 && runnable.Any(t => t.CreateTable))
            {
                progress?.Invoke(new TransferProgress("schema", null, 0, runnable.Count, 0, null, 0, "Creating schema"), 0, overallTotal);
                try { await target.RunAsync(schemaStatements, ct).ConfigureAwait(false); }
                catch (TransferSqlException ex) { AddError("(schema)", "schema", ex.Message, ex.Sql); status = TransferStatus.Partial; }
            }

            var failedTables = new HashSet<PreparedTable>();
            foreach (var t in Enumerable.Reverse(runnable).Where(t => t.DropFirst))
            {
                ct.ThrowIfCancellationRequested();
                var name = TransferSql.Qualified(td, plan.TargetSchema, t.Planned.TargetName);
                try
                {
                    await target.RunAsync([target.IsFile ? DropIfExists(td, name) : TransferSql.DropTable(td, name)], ct).ConfigureAwait(false);
                }
                catch (TransferSqlException ex)
                {
                    Fail(t, "drop", ex);
                    if (!opts.ContinueOnError) return await FinishAsync(TransferStatus.Error);
                }
            }

            // ---- structure + data
            var index = 0;
            foreach (var t in runnable)
            {
                ct.ThrowIfCancellationRequested();
                index++;
                if (failedTables.Contains(t)) continue;
                var st = states[t];
                var sw = Stopwatch.StartNew();
                var label = t.Planned.SourceName;
                var qtarget = TransferSql.Qualified(td, plan.TargetSchema, t.Planned.TargetName);
                try
                {
                    progress?.Invoke(new TransferProgress("structure", label, index, runnable.Count, 0, st.Total, 0, $"Creating {label}"), overallDone, overallTotal);
                    if (t.CreateTable && t.Planned.CreateStatements.Count > 0)
                    {
                        if (target.IsFile) await target.CommentAsync($"Table {t.Planned.TargetSchema}.{t.Planned.TargetName}").ConfigureAwait(false);
                        await target.RunAsync(t.Planned.CreateStatements, ct).ConfigureAwait(false);
                        st.Created = true;
                    }
                    if (wantsData && source is not null)
                    {
                        if (opts.DataMode == DataModes.Truncate && !st.Created)
                        {
                            try { await target.RunAsync([TransferSql.Truncate(td, qtarget)], ct).ConfigureAwait(false); }
                            catch (TransferSqlException) when (td != Dialect.Sqlite && !target.IsFile)
                            {
                                await target.RunAsync([TransferSql.DeleteAll(qtarget)], ct).ConfigureAwait(false);
                            }
                        }
                        var rows = await CopyTableAsync(source, target, plan, t, st, index, runnable.Count, () => overallDone, v => overallDone = v, overallTotal,
                            progress, errors, ct).ConfigureAwait(false);
                        st.Rows = rows;
                    }
                    st.Status = st.ErrorRows > 0 ? TransferStatus.Partial : TransferStatus.Ok;
                    if (st.Status == TransferStatus.Partial) status = TransferStatus.Partial;
                }
                catch (TransferSqlException ex)
                {
                    Fail(t, wantsData && st.Created ? "data" : "structure", ex);
                    if (!opts.ContinueOnError) return await FinishAsync(TransferStatus.Error);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    Fail(t, "data", new TransferSqlException(ex.Message, ""));
                    if (!opts.ContinueOnError) return await FinishAsync(TransferStatus.Error);
                }
                finally
                {
                    st.ElapsedMs = sw.ElapsedMilliseconds;
                }
            }

            // ---- indexes, keys, sequences
            index = 0;
            foreach (var t in runnable)
            {
                ct.ThrowIfCancellationRequested();
                index++;
                var st = states[t];
                if (failedTables.Contains(t) || st.Status is TransferStatus.Error || !st.Created || t.Planned.PostStatements.Count == 0) continue;
                progress?.Invoke(new TransferProgress("keys", t.Planned.SourceName, index, runnable.Count, 0, null, 0, $"Indexes and keys of {t.Planned.SourceName}"), overallDone, overallTotal);
                foreach (var stmt in t.Planned.PostStatements)
                {
                    try { await target.RunAsync([stmt], ct).ConfigureAwait(false); }
                    catch (TransferSqlException ex)
                    {
                        AddError(t.Planned.SourceName, "keys", ex.Message, ex.Sql);
                        status = TransferStatus.Partial;
                        st.Error ??= "Some indexes or foreign keys could not be created: " + ex.Message;
                        if (!opts.ContinueOnError) return await FinishAsync(TransferStatus.Partial);
                    }
                }
            }
            foreach (var t in runnable)
            {
                var st = states[t];
                if (t.IdentityColumn is null || st.Rows == 0 || st.Status is TransferStatus.Error) continue;
                var reset = TransferSql.ResetIdentity(td, plan.TargetSchema, t.Planned.TargetName, t.IdentityColumn);
                if (reset is null) continue;
                try { await target.RunAsync([reset], ct).ConfigureAwait(false); }
                catch (TransferSqlException ex) { AddError(t.Planned.SourceName, "identity", ex.Message, ex.Sql); }
            }

            if (status == TransferStatus.Ok && states.Values.Any(s => s.Status == TransferStatus.Error)) status = TransferStatus.Partial;
            return await FinishAsync(status);

            void Fail(PreparedTable t, string phase, TransferSqlException ex)
            {
                var st = states[t];
                st.Status = TransferStatus.Error;
                st.Error = ex.Message;
                failedTables.Add(t);
                AddError(t.SourceName, phase, ex.Message, ex.Sql);
                status = TransferStatus.Partial;
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return await FinishAsync(TransferStatus.Cancelled);
        }
        catch (Exception ex) when (ex is not EngineException)
        {
            _log.LogWarning(ex, "Data transfer failed");
            AddError("", "run", ex.Message, null);
            return await FinishAsync(TransferStatus.Error);
        }
        finally
        {
            if (source is not null) await source.DisposeAsync().ConfigureAwait(false);
            if (!targetClosed && target is not null) await target.DisposeAsync().ConfigureAwait(false);
            if (!targetClosed && file is not null) await file.DisposeAsync().ConfigureAwait(false);
        }

        // Closes the target, settles the dump file and builds the result.
        async Task<TransferResult> FinishAsync(string finalStatus)
        {
            status = finalStatus;
            if (!targetClosed)
            {
                targetClosed = true;
                try
                {
                    if (target is not null) await target.DisposeAsync().ConfigureAwait(false);
                    if (file is not null) await file.DisposeAsync().ConfigureAwait(false);
                }
                catch (IOException ex) { AddError("", "file", ex.Message, null); }
            }
            if (file is not null && filePath is not null)
            {
                var partial = filePath + ".partial";
                try
                {
                    if (finalStatus == TransferStatus.Cancelled || finalStatus == TransferStatus.Error && errors.Count > 0 && states.Values.All(s => s.Status != TransferStatus.Ok))
                    {
                        if (File.Exists(partial)) File.Delete(partial);
                        filePath = null;
                    }
                    else if (File.Exists(partial))
                    {
                        File.Move(partial, filePath, overwrite: true);
                        fileBytes = new FileInfo(filePath).Length;
                    }
                }
                catch (IOException ex) { AddError("", "file", ex.Message, null); }
            }
            var tables = plan.Tables.Select(t =>
            {
                var s = states[t];
                return new TransferTableResult(t.Planned.SourceName, t.Planned.TargetName, s.Status, s.Rows, s.ErrorRows, s.ElapsedMs, s.Error, s.Created);
            }).ToList();
            return new TransferResult(finalStatus, states.Values.Sum(x => x.Rows), total.ElapsedMilliseconds, tables, errors, filePath, fileBytes);
        }
    }

    private static string DropIfExists(Dialect d, string table) => d == Dialect.PlSql ? $"DROP TABLE {table} PURGE" : $"DROP TABLE IF EXISTS {table}";

    private static void CheckWhere(string? where)
    {
        if (string.IsNullOrWhiteSpace(where)) return;
        var inQuote = false;
        for (var i = 0; i < where.Length; i++)
        {
            var c = where[i];
            if (c == '\'') inQuote = !inQuote;
            else if (!inQuote && (c == ';' || (c == '-' && i + 1 < where.Length && where[i + 1] == '-') || (c == '/' && i + 1 < where.Length && where[i + 1] == '*')))
                throw EngineException.Validation("The WHERE filter must be a single condition (no ';' or comments).", new { field = "tables.where" });
        }
    }

    private static string SelectSql(PreparedPlan plan, PreparedTable t, bool count)
    {
        CheckWhere(t.Where);
        var sd = plan.SourceDialect;
        var from = TransferSql.Qualified(sd, t.SourceSchema, t.SourceName);
        var where = string.IsNullOrWhiteSpace(t.Where) ? "" : " WHERE " + t.Where!.Trim();
        return count
            ? $"SELECT COUNT(*) FROM {from}{where}"
            : $"SELECT {string.Join(", ", t.Columns.Select(c => c.SelectItem))} FROM {from}{where}";
    }

    private static async Task<long?> CountAsync(IDbSession source, PreparedPlan plan, PreparedTable t, CancellationToken ct)
    {
        try
        {
            var sink = new CountSink();
            await source.ExecuteAsync(new ExecuteRequest([new SqlBatch(SelectSql(plan, t, true), 1, 1)], 0, true, false, "transfer"), sink, ct).ConfigureAwait(false);
            return sink.Value;
        }
        catch (EngineException) { throw; }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    private sealed class CountSink : IExecutionSink
    {
        public long? Value { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows)
        {
            if (Value is null && rows.Count > 0 && rows[0].Length > 0)
            {
                var v = rows[0][0];
                Value = v switch { long l => l, int i => i, string s when long.TryParse(s, out var p) => p, double d => (long)d, _ => null };
            }
            return ValueTask.CompletedTask;
        }
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error) => ValueTask.CompletedTask;
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }

    // ------------------------------------------------------------------ rows

    private async Task<long> CopyTableAsync(IDbSession source, TransferTargetWriter target, PreparedPlan plan, PreparedTable t, TableState st, int index, int count,
        Func<long> overall, Action<long> setOverall, long? overallTotal, Action<TransferProgress, long, long?>? progress, List<TransferError> errors, CancellationToken ct)
    {
        var td = plan.TargetDialect;
        var opts = plan.Options;
        var cols = t.Columns.Select(c => c.Target).ToList();
        var qtarget = TransferSql.Qualified(td, plan.TargetSchema, t.Planned.TargetName);
        var upsert = opts.DataMode == DataModes.Upsert && t.KeyColumnsTarget.Count > 0 && td is not (Dialect.ClickHouse or Dialect.Snowflake or Dialect.Cql);
        var identityInsert = t.IdentityInsert && t.IdentityColumn is not null && cols.Any(c => string.Equals(c.Name, t.IdentityColumn, StringComparison.OrdinalIgnoreCase));
        var mode = new InsertMode(identityInsert, upsert);
        var perInsert = Math.Max(1, Math.Min(opts.BatchSize, TransferSql.MaxRowsPerInsert(td)));
        var label = t.Planned.SourceName;
        var sw = Stopwatch.StartNew();
        long written = 0;
        var lastReport = Stopwatch.GetTimestamp();

        void Report(bool force)
        {
            if (progress is null) return;
            if (!force && Stopwatch.GetElapsedTime(lastReport) < TimeSpan.FromMilliseconds(150)) return;
            lastReport = Stopwatch.GetTimestamp();
            var secs = Math.Max(0.001, sw.Elapsed.TotalSeconds);
            progress(new TransferProgress("data", label, index, count, written, st.Total, (long)(written / secs), null), overall(), overallTotal);
        }

        async Task WriteBatchAsync(List<object?[]> batch)
        {
            for (var i = 0; i < batch.Count; i += perInsert)
            {
                ct.ThrowIfCancellationRequested();
                var chunk = batch.Count - i <= perInsert ? (i == 0 ? batch : batch.GetRange(i, batch.Count - i)) : batch.GetRange(i, perInsert);
                var statements = TransferSql.BuildInsert(td, qtarget, cols, chunk, mode);
                try
                {
                    await target.RunAsync(statements, ct).ConfigureAwait(false);
                    written += chunk.Count;
                    setOverall(overall() + chunk.Count);
                }
                catch (TransferSqlException ex) when (opts.ContinueOnError)
                {
                    // find the rows that fail one by one
                    foreach (var row in chunk)
                    {
                        ct.ThrowIfCancellationRequested();
                        try
                        {
                            await target.RunAsync(TransferSql.BuildInsert(td, qtarget, cols, [row], mode), ct).ConfigureAwait(false);
                            written++;
                            setOverall(overall() + 1);
                        }
                        catch (TransferSqlException rowEx)
                        {
                            st.ErrorRows++;
                            if (errors.Count < MaxErrors) errors.Add(new TransferError(label, "data", rowEx.Message, rowEx.Sql.Length > 400 ? rowEx.Sql[..400] + " …" : rowEx.Sql));
                        }
                    }
                    _ = ex;
                }
                Report(false);
            }
        }

        var sameSqlite = plan.SameLocation && plan.SourceDialect == Dialect.Sqlite;
        var channel = Channel.CreateBounded<List<object?[]>>(new BoundedChannelOptions(sameSqlite ? 1_000_000 : 4) { SingleReader = true, SingleWriter = true });
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        Exception? writerFailure = null;
        Task consumer = Task.CompletedTask;
        if (!sameSqlite)
        {
            consumer = Task.Run(async () =>
            {
                try
                {
                    await foreach (var batch in channel.Reader.ReadAllAsync(cts.Token).ConfigureAwait(false)) await WriteBatchAsync(batch).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    writerFailure = ex;
                    await cts.CancelAsync().ConfigureAwait(false);
                }
            }, CancellationToken.None);
        }

        var sink = new CopySink(channel.Writer, opts.BatchSize, cts.Token);
        ExecutionSummary summary;
        try
        {
            summary = await source.ExecuteAsync(new ExecuteRequest([new SqlBatch(SelectSql(plan, t, false), 1, 1)], 0, true, false, "transfer"), sink, cts.Token)
                .ConfigureAwait(false);
            await sink.FlushAsync().ConfigureAwait(false);
        }
        catch (Exception) when (writerFailure is not null)
        {
            summary = new ExecutionSummary(ExecutionStatus.Cancelled, 0, 0, 0);
        }
        finally
        {
            channel.Writer.TryComplete();
        }

        if (sameSqlite)
        {
            // a SQLite file cannot be read and written at once: the rows were buffered, now write them
            channel.Writer.TryComplete();
            await foreach (var batch in channel.Reader.ReadAllAsync(ct).ConfigureAwait(false)) await WriteBatchAsync(batch).ConfigureAwait(false);
        }
        else
        {
            await consumer.ConfigureAwait(false);
        }

        if (writerFailure is not null)
        {
            if (writerFailure is OperationCanceledException && ct.IsCancellationRequested) throw writerFailure;
            if (writerFailure is TransferSqlException tse) throw tse;
            throw new TransferSqlException(writerFailure.Message, "");
        }
        ct.ThrowIfCancellationRequested();
        if (sink.Failure is { } f) throw new TransferSqlException("Reading the source failed: " + f.Message, SelectSql(plan, t, false));
        if (summary.Status == ExecutionStatus.Error) throw new TransferSqlException("Reading the source failed.", SelectSql(plan, t, false));
        Report(true);
        return written;
    }

    /// <summary>Hands the rows of the source to the writer in batches of ~<c>batchSize</c> rows / ~8 MB.</summary>
    private sealed class CopySink(ChannelWriter<List<object?[]>> writer, int batchSize, CancellationToken ct) : IExecutionSink
    {
        private List<object?[]> _buffer = new(batchSize);
        private long _bytes;

        public ErrorInfo? Failure { get; private set; }

        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;

        public ValueTask Error(int batchIndex, ErrorInfo error)
        {
            Failure ??= error;
            return ValueTask.CompletedTask;
        }

        public async ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows)
        {
            foreach (var row in rows)
            {
                _buffer.Add(row);
                foreach (var v in row) _bytes += v is string s ? 2L * s.Length : v is BinaryValue b ? b.Full.LongLength : v is TruncatedValue tv ? 2L * tv.Full.Length : 8;
                if (_buffer.Count >= batchSize || _bytes >= MaxBatchBytes) await FlushAsync().ConfigureAwait(false);
            }
        }

        public async ValueTask FlushAsync()
        {
            if (_buffer.Count == 0) return;
            var batch = _buffer;
            _buffer = new List<object?[]>(batchSize);
            _bytes = 0;
            await writer.WriteAsync(batch, ct).ConfigureAwait(false);
        }
    }
}
