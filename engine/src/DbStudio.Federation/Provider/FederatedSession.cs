using System.Data.Common;
using DbStudio.Core.Models;
using DbStudio.Core.Params;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Engine;
using DbStudio.Federation.Runtime;
using DuckDB.NET.Data;
using ColumnInfo = DbStudio.Core.Models.ColumnInfo;

namespace DbStudio.Federation.Provider;

/// <summary>
/// The console session of a linked database (plan-links 2): query-only. Each batch is analysed, the mounted tables it
/// reads are fetched (in parallel, cached for the session until "Refresh sources") into the session's federation engine,
/// then the SQL runs there and streams like any session (AdoSessionBase: row frames, max rows, cancel). Messages: one
/// Info per source ("crm.customers: 1,204 rows from SQL Server in 120 ms."), the plan's warnings (row cap, fallback…).
/// <list type="bullet">
/// <item>Read-only, always: a batch that is not a pure query is refused with READ_ONLY (even when the user confirmed writes).</item>
/// <item>No transactions (<see cref="IDbSession.SetTransactionModeAsync"/> Manual → NotSupportedException), no database or
/// schema switch, no EXPLAIN (the UI hides them: providerLevels <c>linked</c>).</item>
/// <item>Cancel: the running fetches' driver commands are cancelled and the engine query interrupted.</item>
/// <item>Releasing the session (resources policy) only drops the fetched copies: the next run fetches again.</item>
/// </list>
/// </summary>
internal sealed class FederatedSession : AdoSessionBase, IDbSession
{
    private readonly FederationContext _context;
    private readonly string _linkName;

    public FederatedSession(FederationContext context, ConnectionProfile profile, SessionOptions options, ServerInfo server)
        : base(context.Internals.QueryConnection, profile, options with { TxMode = TransactionMode.Auto }, Dialect.DuckDb, server)
    {
        _context = context;
        _linkName = profile.Name;
        CurrentDatabase = null;
    }

    internal FederationContext Context => _context;

    protected override IParamBinder? ParamBinder => _context.Engine.Name == "duckdb" ? DuckDbParamBinder.Instance : SqliteFallbackBinder.Instance;

    protected override bool RejectUnboundParameters => true;

    protected override string PingSql => "SELECT 1";

    protected override ErrorInfo? ValidateBatch(SqlBatch batch, BatchContext context)
    {
        var c = context.Classification;
        if (c.IsQueryOnly && c.Statements.All(s => s.Category is Core.Sql.StatementCategory.Query or Core.Sql.StatementCategory.Session)) return null;
        var kind = c.Statements.FirstOrDefault(s => s.Category is not (Core.Sql.StatementCategory.Query or Core.Sql.StatementCategory.Session))?.Kind
                   ?? c.PrimaryKind ?? "statement";
        return new ErrorInfo(ErrorCodes.ReadOnly, $"The linked database '{_linkName}' is read-only: {kind} is not allowed.", FirstCodeLine(batch, Dialect.DuckDb));
    }

    protected override async Task<DbDataReader> ExecuteReaderAsync(DbCommand command, BatchContext context, CancellationToken ct)
    {
        if (command is DuckDBCommand duck) duck.UseStreamingMode = true;
        var sql = context.Batch.Sql;
        var (_, statement) = await _context.PrepareStatementAsync(sql, false, null, null, Message, ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        // crm.sales.orders → crm."sales.orders" (wide members); the batch text is unchanged otherwise
        if (!ReferenceEquals(statement, sql) && statement != sql) command.CommandText = statement;
        try
        {
            return await RunAsync(command, ct).ConfigureAwait(false);
        }
        catch (Exception e) when (_context.Internals.IsMissingColumnError(e) && !ct.IsCancellationRequested)
        {
            // The projection missed a column the statement uses: read the whole tables once more and retry.
            await _context.PrepareAsync(sql, true, null, null, null, ct).ConfigureAwait(false);
            return await RunAsync(command, ct).ConfigureAwait(false);
        }
    }

    private async Task<DbDataReader> RunAsync(DbCommand command, CancellationToken ct)
    {
        using var tracking = _context.Internals.Track(command);
        // DuckDB.NET runs synchronously; Cancel() (CancelCommand) interrupts it from another thread.
        return await Task.Run(() => command.ExecuteReader(), CancellationToken.None).ConfigureAwait(false);
    }

    private ValueTask Message(MessageSeverity severity, string text) => EmitMessageAsync(severity, text, null, null, MessageSource.Engine);

    protected override void CancelCommand(DbCommand command)
    {
        try { command.Cancel(); } catch { /* best effort */ }
        try { _context.Engine.Interrupt(); } catch { /* best effort */ }
    }

    protected override bool IsCancellationException(Exception exception) =>
        _context.Internals.IsInterrupt(exception) || exception is OperationCanceledException
        || exception.InnerException is OperationCanceledException;

    protected override ErrorInfo MapException(Exception exception, SqlBatch batch) => exception switch
    {
        FetchException f => new ErrorInfo(ErrorCodes.ProviderError, f.Message, FirstCodeLine(batch, Dialect.DuckDb), Detail: f.InnerException?.GetType().Name),
        EngineException ee => new ErrorInfo(ee.Code, ee.Message, FirstCodeLine(batch, Dialect.DuckDb)),
        DuckDBException d => new ErrorInfo("DUCKDB", d.Message, FirstCodeLine(batch, Dialect.DuckDb)),
        _ => base.MapException(exception, batch),
    };

    protected override ColumnInfo[] DescribeColumns(DbDataReader reader, BatchContext context) => ResultValues.Describe(reader);

    protected override object? ReadValue(DbDataReader reader, int ordinal, ColumnInfo column) => ResultValues.Read(reader, ordinal, column);

    protected override async ValueTask DisposeCoreAsync()
    {
        await _context.DisposeAsync().ConfigureAwait(false);
    }

    // ---- no transactions: a link only reads (interface re-implementation over AdoSessionBase's public methods)

    Task IDbSession.SetTransactionModeAsync(TransactionMode mode, CancellationToken ct) =>
        mode == TransactionMode.Auto
            ? Task.CompletedTask
            : throw new NotSupportedException("Linked databases are read-only and have no transactions.");

    Task IDbSession.CommitAsync(CancellationToken ct) => Task.CompletedTask;

    Task IDbSession.RollbackAsync(CancellationToken ct) => Task.CompletedTask;

    Task IDbSession.ChangeDatabaseAsync(string database, CancellationToken ct) =>
        throw new NotSupportedException("A linked database has no databases to switch to; its schemas are the member aliases.");
}
