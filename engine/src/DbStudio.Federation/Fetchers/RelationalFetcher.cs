using System.Data.Common;
using System.Diagnostics;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Pushdown;
using DbStudio.Import.Run;

namespace DbStudio.Federation.Fetchers;

/// <summary>
/// <see cref="ISourceFetcher"/> of every relational provider (plan-links 2): the catalog comes from the provider's
/// catalog reader (<c>LoadSchemaAsync</c> of the member's database/schema); a fetch opens a dedicated connection
/// (<see cref="ImportConnections.OpenAsync"/>, the same builders sessions use; Cassandra through a provider session),
/// runs the <see cref="PushdownSql"/> query and streams the reader into the engine appender: at most
/// <see cref="FetchRequest.MaxRows"/> rows plus one to detect truncation. Cancellation cancels the driver command.
/// Stateless and thread-safe.
/// </summary>
public sealed class RelationalFetcher : ISourceFetcher
{
    /// <summary>Provider ids this fetcher is registered for.</summary>
    public static readonly IReadOnlyList<string> ProviderIds =
        ["sqlserver", "oracle", "postgresql", "mysql", "mariadb", "sqlite", "clickhouse", "snowflake", "cassandra"];

    private const int ProgressEvery = 5_000;

    private static IDbProvider ProviderOf(SourceContext context) =>
        context.Provider ?? throw new FetchException(context.Member.Alias, "*", "The member is not a relational connection.");

    private static ConnectionProfile ProfileOf(SourceContext context) =>
        context.Profile ?? throw new FetchException(context.Member.Alias, "*", "The member has no connection.");

    public async Task<SourceCatalog> LoadCatalogAsync(SourceContext context, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(context);
        var provider = ProviderOf(context);
        var profile = ProfileOf(context);
        var member = context.Member;
        var dialect = provider.Dialect;
        await using var reader = await provider.OpenCatalogReaderAsync(profile, context.Password, ct).ConfigureAwait(false);
        string? database = null;
        if (DialectInfo.HasDatabases(dialect))
            database = string.IsNullOrWhiteSpace(member.Database) ? await reader.GetCurrentDatabaseAsync(ct).ConfigureAwait(false) : member.Database;
        var schema = string.IsNullOrWhiteSpace(member.Schema) ? await reader.GetDefaultSchemaAsync(database, ct).ConfigureAwait(false) : member.Schema!;
        var catalog = await reader.LoadSchemaAsync(database, schema, ct).ConfigureAwait(false);
        return BuildCatalog(member, dialect, catalog);
    }

    /// <summary>The member's mounted tables out of one schema snapshot (explicit list, or every table and view with overrides).</summary>
    internal static SourceCatalog BuildCatalog(LinkMember member, Dialect dialect, SchemaCatalog catalog)
    {
        var warnings = new List<string>();
        var objects = catalog.Objects.Where(o => o.Type is ObjectTypes.Table or ObjectTypes.View or ObjectTypes.MView).ToList();
        CatalogObject? Find(string name) =>
            objects.FirstOrDefault(o => string.Equals(o.Name, name, StringComparison.Ordinal))
            ?? objects.FirstOrDefault(o => string.Equals(o.Name, name, StringComparison.OrdinalIgnoreCase));

        var mounted = new List<(CatalogObject Obj, MountedTable Mount)>();
        if (member.AllTables)
        {
            foreach (var o in objects.OrderBy(o => o.Name, StringComparer.OrdinalIgnoreCase))
            {
                var over = member.Tables.FirstOrDefault(t => string.Equals(t.Name, o.Name, StringComparison.OrdinalIgnoreCase));
                mounted.Add((o, over ?? new MountedTable { Name = o.Name, Type = o.Type }));
            }
        }
        else
        {
            foreach (var t in member.Tables)
            {
                if (Find(t.Name) is { } o) mounted.Add((o, t));
                else warnings.Add($"{member.Alias}.{t.LinkName}: the table '{t.Name}' was not found in {catalog.Name}.");
            }
        }

        var mountedNames = new HashSet<string>(mounted.Select(m => m.Obj.Name), StringComparer.OrdinalIgnoreCase);
        var tables = new List<SourceTable>();
        foreach (var (o, m) in mounted)
        {
            var columns = o.Columns.Select(c =>
            {
                var (p, s) = TypeMap.PrecisionScale(c.TypeText);
                return new SourceColumn(c.Name, c.TypeText, TypeMap.KindOf(c.TypeText, dialect), c.Nullable, c.IsPk || o.PrimaryKey.Contains(c.Name),
                    Precision: p, Scale: s);
            }).ToList();
            var fks = o.ForeignKeys.Where(fk => mountedNames.Contains(fk.RefTable)
                                                && (fk.RefSchema is null || string.Equals(fk.RefSchema, catalog.Name, StringComparison.OrdinalIgnoreCase))).ToList();
            var options = m.Options?.DeepClone().AsObject();
            if (dialect == Dialect.Cql)
            {
                var partition = o.Columns.Where(c => c.Comment?.StartsWith("partition key", StringComparison.OrdinalIgnoreCase) == true).Select(c => c.Name).ToList();
                if (partition.Count > 0)
                {
                    options ??= new JsonObject();
                    options[PushdownSql.PartitionKeyOption] = new JsonArray(partition.Select(p => (JsonNode?)JsonValue.Create(p)).ToArray());
                }
            }
            tables.Add(new SourceTable(o.Name, m.LinkName, catalog.Database, catalog.Name, o.Type, columns, o.PrimaryKey.ToList(), fks,
                Options: options, Comment: o.Comment));
        }
        return new SourceCatalog(tables, warnings);
    }

    public FetchRequest Accept(SourceContext context, FetchRequest proposed)
    {
        ArgumentNullException.ThrowIfNull(context);
        return PushdownSql.Accept(ProviderOf(context).Dialect, proposed);
    }

    public string Describe(SourceContext context, FetchRequest request) =>
        PushdownSql.Render(ProviderOf(context).Dialect, NameOf(request.Table), request);

    private static SourceObjectName NameOf(SourceTable table) => new(null, table.Schema, table.Name);

    /// <summary>Database the fetch connection opens on: the table's database (SQL Server, PostgreSQL, Snowflake) or, for
    /// MySQL / MariaDB / ClickHouse, its schema (= database).</summary>
    private static string? ConnectionDatabase(IDbProvider provider, SourceContext context, SourceTable table) => provider.Id switch
    {
        "mysql" or "mariadb" or "clickhouse" => table.Schema ?? context.Member.Schema,
        _ when DialectInfo.HasDatabases(provider.Dialect) => table.Database ?? context.Member.Database,
        _ => null,
    };

    public async Task<FetchResult> FetchAsync(SourceContext context, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(target);
        var provider = ProviderOf(context);
        var profile = ProfileOf(context);
        var sql = PushdownSql.Render(provider.Dialect, NameOf(request.Table), request);
        var sw = Stopwatch.StartNew();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (request.Timeout > TimeSpan.Zero && request.Timeout < TimeSpan.FromDays(1)) timeout.CancelAfter(request.Timeout);
        try
        {
            var (rows, truncated, readFailures) = provider.Id == "cassandra"
                ? await FetchThroughSessionAsync(provider, profile, context, sql, request, target, progress, timeout.Token).ConfigureAwait(false)
                : await FetchThroughConnectionAsync(provider, profile, context, sql, request, target, progress, timeout.Token).ConfigureAwait(false);
            return new FetchResult(rows, truncated, sql, sw.ElapsedMilliseconds, target.ConversionFailures + readFailures);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new FetchException(context.Member.Alias, request.Table.LinkName,
                $"the source did not answer within {request.Timeout.TotalSeconds:0} s (links.fetchTimeoutSeconds).");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (FetchException)
        {
            throw;
        }
        catch (Exception e) when (ct.IsCancellationRequested)
        {
            // a driver error caused by our cancel (SqlException "Operation cancelled by user", ORA-01013…)
            throw new OperationCanceledException("The fetch was cancelled.", e, ct);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            throw new FetchException(context.Member.Alias, request.Table.LinkName, e.Message, e);
        }
    }

    private static async Task<(long Rows, bool Truncated, long ReadFailures)> FetchThroughConnectionAsync(IDbProvider provider, ConnectionProfile profile,
        SourceContext context, string sql, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct)
    {
        await using var connection = await ImportConnections.OpenAsync(provider, profile, context.Password,
            ConnectionDatabase(provider, context, request.Table), context.Services, ct).ConfigureAwait(false);
        await using var cmd = connection.Db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = request.Timeout > TimeSpan.Zero ? (int)Math.Min(int.MaxValue, Math.Ceiling(request.Timeout.TotalSeconds)) : 0;
        await using var registration = ct.Register(() =>
        {
            try { cmd.Cancel(); } catch { /* best effort */ }
            // Microsoft.Data.Sqlite's Cancel does not stop a running step: interrupt the connection.
            if (connection.Db is Microsoft.Data.Sqlite.SqliteConnection { Handle: { IsInvalid: false } handle })
            {
                try { SQLitePCL.raw.sqlite3_interrupt(handle); } catch { /* best effort */ }
            }
        });
        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        var n = request.Columns.Count;
        if (reader.FieldCount < n) throw new InvalidOperationException($"The source returned {reader.FieldCount} columns, {n} were asked.");
        var values = new object?[n];
        long rows = 0, failures = 0;
        var truncated = false;
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            if (rows >= request.MaxRows)
            {
                // The SQL asks for MaxRows + 1 rows (PushdownSql.Render), so nothing big is left to drain.
                truncated = true;
                break;
            }
            for (var i = 0; i < n; i++)
            {
                if (reader.IsDBNull(i))
                {
                    values[i] = null;
                    continue;
                }
                try
                {
                    values[i] = reader.GetValue(i);
                }
                catch (Exception e) when (e is InvalidCastException or OverflowException or FormatException or InvalidOperationException or ArgumentException
                                              or NotSupportedException or DbException or FileNotFoundException)
                {
                    values[i] = ReadFallback(reader, i);
                    if (values[i] is null) failures++;
                }
            }
            target.AppendRow(values);
            rows++;
            if (rows % ProgressEvery == 0) progress?.Report(rows);
        }
        progress?.Report(rows);
        return (rows, truncated, failures);
    }

    /// <summary>A value the driver cannot map to a CLR type (Oracle NUMBER beyond decimal, SQL Server UDTs): its provider-specific text.</summary>
    private static object? ReadFallback(DbDataReader reader, int ordinal)
    {
        try
        {
            return reader.GetProviderSpecificValue(ordinal)?.ToString();
        }
        catch (Exception)
        {
            try { return reader.GetString(ordinal); } catch (Exception) { return null; }
        }
    }

    private static async Task<(long Rows, bool Truncated, long ReadFailures)> FetchThroughSessionAsync(IDbProvider provider, ConnectionProfile profile,
        SourceContext context, string sql, FetchRequest request, IFederationAppender target, IProgress<long>? progress, CancellationToken ct)
    {
        var options = new SessionOptions(Ids.New("f"), request.Table.Schema ?? context.Member.Schema, TransactionMode.Auto, false);
        await using var session = await provider.OpenSessionAsync(profile, context.Password, options, ct).ConfigureAwait(false);
        var sink = new AppendingSink(target, request.MaxRows, progress, session);
        await using var registration = ct.Register(session.Cancel);
        var maxRows = (int)Math.Min(int.MaxValue, request.MaxRows == long.MaxValue ? 0 : request.MaxRows + 1);
        var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], maxRows, true, false, "statement"), sink, ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();
        if (summary.Status == ExecutionStatus.Cancelled && !sink.Truncated) throw new OperationCanceledException(ct);
        if (sink.FirstError is { } error) throw new InvalidOperationException(error.Message);
        progress?.Report(sink.Count);
        return (sink.Count, sink.Truncated, 0);
    }

    /// <summary>Receives a provider session's rows (wire values) and appends them, stopping at the cap.</summary>
    private sealed class AppendingSink(IFederationAppender target, long maxRows, IProgress<long>? progress, IDbSession session) : IExecutionSink
    {
        public long Count { get; private set; }
        public bool Truncated { get; private set; }
        public ErrorInfo? FirstError { get; private set; }

        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) => ValueTask.CompletedTask;

        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows)
        {
            foreach (var row in rows)
            {
                if (Truncated) break;
                if (Count >= maxRows)
                {
                    Truncated = true;
                    session.Cancel();
                    break;
                }
                target.AppendRow(row);
                Count++;
                if (Count % ProgressEvery == 0) progress?.Report(Count);
            }
            return ValueTask.CompletedTask;
        }

        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs)
        {
            if (truncated) Truncated = true;
            return ValueTask.CompletedTask;
        }

        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;

        public ValueTask Error(int batchIndex, ErrorInfo error)
        {
            if (!Truncated) FirstError ??= error;
            return ValueTask.CompletedTask;
        }

        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }
}
