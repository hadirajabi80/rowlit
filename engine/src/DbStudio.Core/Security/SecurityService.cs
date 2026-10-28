using System.Diagnostics;
using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Core.Security;

public sealed class SecurityService(ITransferEnvironment env)
{
    public async Task<SecurityPrincipalsResult> ListAsync(string connectionId, string? database, CancellationToken ct)
    {
        var c = Resolve(connectionId);
        var notes = new List<string>();
        var principals = new List<SecurityPrincipal>();
        await using var session = await OpenAsync(c, database, ct).ConfigureAwait(false);
        var succeeded = false;
        foreach (var sql in SecuritySql.List(c.Provider.Id))
        {
            try
            {
                var result = await QueryAsync(session, sql, ct).ConfigureAwait(false);
                succeeded = true;
                principals.AddRange(result.Rows.Select(r => Principal(c.Provider.Id, result.Columns, r)));
            }
            catch (SecurityStatementException ex) { notes.Add(ex.Message); }
        }
        if (!succeeded && notes.Count > 0) throw EngineException.Privilege("The server did not allow security catalog access. " + notes[0], SecurityNeed(c.Provider.Id));
        var unique = principals.GroupBy(p => $"{p.Kind}\0{p.Name}\0{p.Host}", StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(p => p.Kind == SecurityKinds.Role ? 1 : 0).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
        if (c.Provider.Id is "oracle" or "clickhouse" or "snowflake") notes.Insert(0, $"{c.Provider.DisplayName} security is available for inspection only.");
        return new(c.Provider.Id, SecuritySql.WritableProviders.Contains(c.Provider.Id) && !c.Profile.ReadOnly, unique, notes);
    }

    public async Task<SecurityPrincipalDetail> DetailAsync(string connectionId, string? database, string? name, string? kind, string? host, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(name)) throw EngineException.Validation("name is required.", new { field = "name" });
        if (!SecurityKinds.Valid(kind)) throw EngineException.Validation("kind must be user, login or role.", new { field = "kind" });
        var c = Resolve(connectionId);
        var list = await ListAsync(connectionId, database, ct).ConfigureAwait(false);
        var principal = list.Principals.FirstOrDefault(p => p.Kind == kind && string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)
            && (host is null || string.Equals(p.Host, host, StringComparison.OrdinalIgnoreCase)))
            ?? new SecurityPrincipal(name.Trim(), kind!, host, kind != SecurityKinds.Role, false, false);
        var attributes = new Dictionary<string, string?> { ["Provider"] = c.Provider.DisplayName, ["Kind"] = principal.Kind, ["Host"] = principal.Host };
        var members = new List<string>(); var memberOf = new List<string>(); var grants = new List<SecurityGrant>(); var notes = new List<string>();
        await using var session = await OpenAsync(c, database, ct).ConfigureAwait(false);
        foreach (var sql in SecuritySql.Detail(c.Provider.Id, kind!, name.Trim(), host))
        {
            try
            {
                var q = await QueryAsync(session, sql, ct).ConfigureAwait(false);
                foreach (var row in q.Rows)
                {
                    var d = Dict(q.Columns, row);
                    if (Get(d, "member_of") is { } parent) memberOf.Add(parent);
                    else if (Get(d, "member") is { } child) members.Add(child);
                    else if (Get(d, "object", "name_on", "granted_on") is { } obj)
                        grants.Add(new(obj, Get(d, "privilege_type", "permission_name", "privilege") ?? "GRANT", Yes(Get(d, "is_grantable", "grantable")), Get(d, "grantor"), Get(d, "scope", "class_desc"), Get(d, "state_desc")));
                    else
                    {
                        var text = row.Select(String).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
                        if (text is not null) grants.Add(new("*", text, false, null));
                    }
                }
            }
            catch (SecurityStatementException ex) { notes.Add(ex.Message); }
        }
        var create = CreatePreview(c.Provider.Id, principal);
        return new(principal, attributes, members.Distinct(StringComparer.OrdinalIgnoreCase).ToList(), memberOf.Distinct(StringComparer.OrdinalIgnoreCase).ToList(), grants, create, notes);
    }

    public SecurityScriptResult Script(string connectionId, SecurityChangeRequest? request)
    {
        var c = Resolve(connectionId);
        if (c.Profile.ReadOnly) throw EngineException.ReadOnly(c.Profile.Name, "security changes");
        return SecuritySql.Script(c.Provider.Id, request);
    }

    public async Task<SecurityApplyResult> ApplyAsync(string connectionId, string? database, SecurityChangeRequest? request, CancellationToken ct)
    {
        var c = Resolve(connectionId);
        if (c.Profile.ReadOnly) throw EngineException.ReadOnly(c.Profile.Name, "security changes");
        var script = SecuritySql.Script(c.Provider.Id, request);
        var sw = Stopwatch.StartNew();
        await using var session = await OpenAsync(c, database, ct).ConfigureAwait(false);
        var sink = new CollectSink();
        var batches = script.Statements.Select(s => new SqlBatch(s, 1, 1)).ToList();
        var summary = await session.ExecuteAsync(new ExecuteRequest(batches, 0, true, false, "security", null, true), sink, ct).ConfigureAwait(false);
        if (sink.Failure is { } e) throw new EngineException(400, ErrorCodes.ProviderError, e.Message, new { providerError = e });
        if (summary.Status == ExecutionStatus.Cancelled) throw new OperationCanceledException(ct);
        if (summary.Status == ExecutionStatus.Error) throw new EngineException(400, ErrorCodes.ProviderError, "The security statement failed.");
        return new(true, script.Statements.Count, sw.ElapsedMilliseconds);
    }

    private TransferConnection Resolve(string id)
    {
        var c = env.Resolve(id);
        if (!SecuritySql.Providers.Contains(c.Provider.Id)) throw EngineException.Validation($"Security inspection is not available for {c.Provider.DisplayName}.");
        return c;
    }

    private static Task<IDbSession> OpenAsync(TransferConnection c, string? database, CancellationToken ct) =>
        c.Provider.OpenSessionAsync(c.Profile, c.Password, new SessionOptions(Ids.New("s"), string.IsNullOrWhiteSpace(database) ? null : database, TransactionMode.Auto, false), ct);

    private static async Task<QueryResult> QueryAsync(IDbSession session, string sql, CancellationToken ct)
    {
        var sink = new CollectSink();
        var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 10_000, true, false, "security-catalog"), sink, ct).ConfigureAwait(false);
        if (sink.Failure is { } e) throw new SecurityStatementException(e.Message);
        if (summary.Status == ExecutionStatus.Cancelled) throw new OperationCanceledException(ct);
        if (summary.Status == ExecutionStatus.Error) throw new SecurityStatementException("A security catalog query failed.");
        return new(sink.Columns, sink.Collected);
    }

    private static SecurityPrincipal Principal(string provider, IReadOnlyList<string> columns, object?[] row)
    {
        var d = Dict(columns, row); var name = Get(d, "name", "username", "user", "role") ?? "(unknown)";
        var kind = Get(d, "kind")?.ToLowerInvariant();
        if (!SecurityKinds.Valid(kind)) kind = provider == "sqlserver" && (Get(d, "type_desc")?.Contains("LOGIN", StringComparison.OrdinalIgnoreCase) ?? false) ? SecurityKinds.Login : SecurityKinds.User;
        var disabled = Yes(Get(d, "is_disabled", "account_locked")) || (Get(d, "account_status")?.Contains("LOCK", StringComparison.OrdinalIgnoreCase) ?? false);
        return new(name, kind!, Get(d, "host"), kind != SecurityKinds.Role, disabled, IsSystem(provider, name), Get(d, "type_desc", "plugin", "auth_type", "account_status"));
    }

    private static bool IsSystem(string provider, string name) => provider switch
    {
        "postgresql" => name.StartsWith("pg_", StringComparison.OrdinalIgnoreCase),
        "sqlserver" => name is "sa" or "public" or "guest" or "dbo" || name.StartsWith("##", StringComparison.Ordinal),
        "oracle" => name is "SYS" or "SYSTEM",
        _ => false
    };
    private static IReadOnlyList<string> CreatePreview(string provider, SecurityPrincipal p) => provider switch
    {
        "postgresql" => [$"CREATE {(p.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {SecuritySql.PgId(p.Name)}{(p.Kind == SecurityKinds.Role ? "" : " LOGIN PASSWORD '********'")};"],
        "mysql" or "mariadb" => [$"CREATE {(p.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {SecuritySql.MyAccount(p.Name, p.Host)}{(p.Kind == SecurityKinds.Role ? "" : " IDENTIFIED BY '********'")};"],
        "sqlserver" => [$"CREATE {(p.Kind == SecurityKinds.Login ? "LOGIN" : p.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {SecuritySql.MsId(p.Name)}{(p.Kind == SecurityKinds.Role ? "" : " WITH PASSWORD = N'********'")};"],
        _ => [$"-- {provider}: creation is read-only in Rowlit"]
    };
    private static string SecurityNeed(string provider) => provider switch { "postgresql" => "pg_roles and information_schema grants", "mysql" or "mariadb" => "SELECT on mysql.user or SHOW GRANTS", "sqlserver" => "VIEW DEFINITION", _ => "access to the provider security catalog" };
    private static Dictionary<string, string?> Dict(IReadOnlyList<string> columns, object?[] row) => columns.Select((c, i) => (c, v: i < row.Length ? String(row[i]) : null)).ToDictionary(x => x.c.ToLowerInvariant(), x => x.v, StringComparer.OrdinalIgnoreCase);
    private static string? Get(IReadOnlyDictionary<string, string?> d, params string[] keys) { foreach (var k in keys) if (d.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v)) return v; return null; }
    private static string? String(object? value) => value switch { null => null, DateTime d => d.ToString("O", CultureInfo.InvariantCulture), IFormattable f => f.ToString(null, CultureInfo.InvariantCulture), _ => value.ToString() };
    private static bool Yes(string? value) => value is not null && (value.Equals("true", StringComparison.OrdinalIgnoreCase) || value is "1" or "YES" or "Y" or "GRANT_WITH_GRANT_OPTION");
    private sealed record QueryResult(IReadOnlyList<string> Columns, IReadOnlyList<object?[]> Rows);
    private sealed class SecurityStatementException(string message) : Exception(message);

    private sealed class CollectSink : IExecutionSink
    {
        public List<string> Columns { get; } = []; public List<object?[]> Collected { get; } = []; public ErrorInfo? Failure { get; private set; }
        public ValueTask BatchStarted(int batchIndex) => ValueTask.CompletedTask;
        public ValueTask ResultSetStarted(int resultSetId, int batchIndex, ColumnInfo[] columns) { if (Columns.Count == 0) Columns.AddRange(columns.OrderBy(c => c.Ordinal).Select(c => c.Name)); return ValueTask.CompletedTask; }
        public ValueTask Rows(int resultSetId, IReadOnlyList<object?[]> rows) { Collected.AddRange(rows); return ValueTask.CompletedTask; }
        public ValueTask ResultSetEnded(int resultSetId, long rowCount, bool truncated, long elapsedMs) => ValueTask.CompletedTask;
        public ValueTask RowsAffected(int batchIndex, long count, string? statementKind) => ValueTask.CompletedTask;
        public ValueTask Message(int batchIndex, MessageSeverity severity, string text, int? line, int? code, MessageSource source) => ValueTask.CompletedTask;
        public ValueTask Error(int batchIndex, ErrorInfo error) { Failure ??= error; return ValueTask.CompletedTask; }
        public ValueTask BatchEnded(int batchIndex, long elapsedMs, BatchStatus status) => ValueTask.CompletedTask;
    }
}
