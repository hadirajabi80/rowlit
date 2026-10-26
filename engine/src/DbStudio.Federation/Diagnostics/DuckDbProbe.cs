using DbStudio.Federation.Contracts;
using DuckDB.NET.Data;

namespace DbStudio.Federation.Diagnostics;

/// <summary>
/// WP0: loads libduckdb once and checks that it works (version, <c>json_serialize_sql</c>). Backs <c>GET /links/engine</c>
/// (the native smoke test, scripts/ci/kafka-native-smoke.mjs) and <see cref="Runtime.UnavailableLinkRuntime"/>'s parser.
/// WP-A's DuckDbEngine factory may reuse it for <see cref="IFederationEngineFactory.Probe"/>.
/// </summary>
public static class DuckDbProbe
{
    /// <summary>
    /// In-memory database with no extension auto-install/auto-load and no external access (phase 1: every row comes in
    /// through Rowlit's drivers). The JSON functions are statically linked into libduckdb.
    /// </summary>
    public const string InMemoryConnectionString = "DataSource=:memory:";

    /// <summary>Settings applied to every DuckDB connection the federation opens (before anything else runs).</summary>
    public static readonly IReadOnlyList<string> LockdownStatements =
    [
        "SET autoinstall_known_extensions = false",
        "SET autoload_known_extensions = false",
        "SET enable_external_access = false",
    ];

    private static readonly Lazy<FederationEngineInfo> Cached = new(ProbeNow, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>The probe result (computed once per process).</summary>
    public static FederationEngineInfo Info => Cached.Value;

    /// <summary>Opens an in-memory DuckDB with <see cref="LockdownStatements"/> applied.</summary>
    public static DuckDBConnection OpenInMemory()
    {
        var c = new DuckDBConnection(InMemoryConnectionString);
        try
        {
            c.Open();
            foreach (var sql in LockdownStatements)
            {
                using var cmd = c.CreateCommand();
                cmd.CommandText = sql;
                cmd.ExecuteNonQuery();
            }
            return c;
        }
        catch
        {
            c.Dispose();
            throw;
        }
    }

    /// <summary><c>SELECT json_serialize_sql($sql)</c> on <paramref name="connection"/>.</summary>
    public static SqlAst SerializeSql(DuckDBConnection connection, string sql)
    {
        using var cmd = connection.CreateCommand();
        // The cast types the parameter (json_serialize_sql has overloads, so an untyped parameter does not bind).
        cmd.CommandText = "SELECT json_serialize_sql(CAST($sql AS VARCHAR))";
        cmd.Parameters.Add(new DuckDBParameter("sql", sql));
        var json = cmd.ExecuteScalar() as string;
        if (json is null) return new SqlAst(true, false, null, "json_serialize_sql returned nothing.");
        // json_serialize_sql reports parse errors in the JSON itself: {"error":true,"error_type":"parser","error_message":"…"}.
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("error", out var err) && err.ValueKind == System.Text.Json.JsonValueKind.True)
        {
            var message = doc.RootElement.TryGetProperty("error_message", out var m) ? m.GetString() : "Parser error.";
            return new SqlAst(true, false, json, message);
        }
        return new SqlAst(true, true, json);
    }

    /// <summary>Parses <paramref name="sql"/> on a short-lived in-memory database.</summary>
    public static SqlAst SerializeSql(string sql)
    {
        using var c = OpenInMemory();
        return SerializeSql(c, sql);
    }

    private static FederationEngineInfo ProbeNow()
    {
        try
        {
            using var c = OpenInMemory();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT version()";
            var version = cmd.ExecuteScalar() as string ?? "";
            var ast = SerializeSql(c, "select 1");
            return new FederationEngineInfo("duckdb", version, ast.Ok, ast.Ok ? null : ast.Error);
        }
        catch (Exception e) when (e is DllNotFoundException or BadImageFormatException or EntryPointNotFoundException or TypeInitializationException or DuckDBException)
        {
            // The fallback engine is SQLite (WP-A Engine/SqliteFederationEngine.cs).
            return new FederationEngineInfo("sqlite", SqliteVersion(), false, $"DuckDB is not available: {e.GetBaseException().Message}");
        }
    }

    private static string SqliteVersion()
    {
        try
        {
            using var c = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
            c.Open();
            return c.ServerVersion;
        }
        catch (Exception)
        {
            return "";
        }
    }
}
