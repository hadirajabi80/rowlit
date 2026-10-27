using System.Globalization;
using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Native;

/// <summary>Where a native link points: the member's connection as the target server should reach it.</summary>
/// <param name="ProviderId">Member provider id (sqlserver, postgresql, mysql, mariadb, oracle, clickhouse, …).</param>
/// <param name="Profile">The member connection (no secrets: only host, port, database, user are read).</param>
/// <param name="Tables">Mounted tables with their source columns (null when the catalog could not load).</param>
public sealed record NativeLinkSource(string Alias, string ProviderId, ConnectionProfile Profile, string? Database, string? Schema, bool AllTables,
    IReadOnlyList<MountedTable> Mounted, IReadOnlyList<SourceTable>? Tables);

/// <summary>
/// Scripts that make a target server reach a link member natively (plan-links 1, "Native links"): SQL Server linked
/// servers, PostgreSQL foreign servers (postgres_fdw / mysql_fdw / oracle_fdw / tds_fdw + IMPORT FOREIGN SCHEMA), Oracle
/// DATABASE LINKs, MySQL/MariaDB FEDERATED tables and ClickHouse PostgreSQL/MySQL database engines. Secrets are
/// <c>&lt;password&gt;</c> placeholders, never real values; the engine never runs the scripts (the UI opens them in a
/// console on the target connection). Pure text generation.
/// </summary>
public static class NativeLinkScripter
{
    /// <summary>A name PostgreSQL leaves alone when unquoted (it folds anything else to lower case).</summary>
    private static readonly System.Text.RegularExpressions.Regex PgPlain = new("^[a-z_][a-z0-9_$]*$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    public const string PasswordPlaceholder = "<password>";
    public const string UserPlaceholder = "<user>";

    /// <summary>Kinds a target dialect can create for a member provider (first = default); empty = not possible.</summary>
    public static IReadOnlyList<string> KindsFor(Dialect target, string targetProviderId, string memberProviderId) => target switch
    {
        Dialect.TSql when IsRelational(memberProviderId) => [NativeLinkKinds.LinkedServer],
        Dialect.PgSql when memberProviderId is "postgresql" or "mysql" or "mariadb" or "oracle" or "sqlserver" => [NativeLinkKinds.Fdw],
        Dialect.PlSql when IsRelational(memberProviderId) => [NativeLinkKinds.DatabaseLink],
        Dialect.MySql when memberProviderId is "mysql" or "mariadb" => [NativeLinkKinds.Federated],
        Dialect.ClickHouse when memberProviderId is "postgresql" or "mysql" or "mariadb" => [NativeLinkKinds.ClickHouseEngine],
        _ => [],
    };

    private static bool IsRelational(string id) => id is "sqlserver" or "postgresql" or "mysql" or "mariadb" or "oracle" or "clickhouse" or "snowflake" or "sqlite";

    public static NativeScriptResult Script(Dialect target, string targetProviderId, NativeLinkSource member, string? kind, string? name)
    {
        var kinds = KindsFor(target, targetProviderId, member.ProviderId);
        if (kinds.Count == 0)
            throw EngineException.Validation($"A {targetProviderId} server cannot link to a {member.ProviderId} member natively.", new { field = "targetConnectionId" });
        var k = string.IsNullOrEmpty(kind) ? kinds[0] : kind;
        if (!kinds.Contains(k)) throw EngineException.Validation($"Native link kind '{kind}' is not available here (available: {string.Join(", ", kinds)}).", new { field = "kind" });
        var linkName = string.IsNullOrWhiteSpace(name) ? member.Alias : name.Trim();
        if (linkName.Any(c => char.IsControl(c) || c is '\'' or '"' or ']' or '`' or ';'))
            throw EngineException.Validation("The native link name cannot contain quotes, brackets, ';' or control characters.", new { field = "name" });
        var s = new ScriptBuilder(member);
        switch (k)
        {
            case NativeLinkKinds.LinkedServer: LinkedServer(s, linkName); break;
            case NativeLinkKinds.Fdw: Fdw(s, linkName); break;
            case NativeLinkKinds.DatabaseLink: DbLink(s, linkName); break;
            case NativeLinkKinds.Federated: Federated(s, linkName, targetProviderId); break;
            default: ClickHouse(s, linkName); break;
        }
        if (s.Host is "localhost" or "127.0.0.1" or "::1")
            s.Note($"The member's host is '{s.Host}' as Rowlit reaches it; from the target server (another machine, a container) it is probably a different address.");
        return new NativeScriptResult(target, k, s.Text.ToString().TrimEnd() + "\n", s.Placeholders.ToList(), s.Notes, kinds);
    }

    // ---------------------------------------------------------------- shared

    private sealed class ScriptBuilder(NativeLinkSource member)
    {
        public NativeLinkSource Member { get; } = member;
        public StringBuilder Text { get; } = new();
        public List<string> Notes { get; } = [];
        public SortedSet<string> Placeholders { get; } = new(StringComparer.Ordinal);

        public string Password { get { Placeholders.Add(PasswordPlaceholder); return PasswordPlaceholder; } }

        public string User
        {
            get
            {
                var u = Member.Profile.GetString("user")?.Trim();
                if (string.IsNullOrEmpty(u) || (Member.ProviderId == "sqlserver" && (Member.Profile.GetString("auth") ?? "sql").Trim().ToLowerInvariant() != "sql"))
                {
                    Placeholders.Add(UserPlaceholder);
                    return UserPlaceholder;
                }
                return u;
            }
        }

        public string Host => Member.ProviderId == "sqlserver" ? SqlServerHost().Host : Member.Profile.GetString("host")?.Trim() is { Length: > 0 } h ? h : "localhost";

        public int Port => Member.ProviderId switch
        {
            "sqlserver" => SqlServerHost().Port ?? 1433,
            "postgresql" => Member.Profile.GetInt("port", 5432),
            "mysql" or "mariadb" => Member.Profile.GetInt("port", 3306),
            "oracle" => Member.Profile.GetInt("port", 1521),
            "clickhouse" => Member.Profile.GetInt("port", 8123),
            _ => Member.Profile.GetInt("port", 0),
        };

        public string? Database => Member.Database is { Length: > 0 } d ? d : Member.Profile.GetString("database")?.Trim() is { Length: > 0 } pd ? pd : null;

        /// <summary>SQL Server "server" = host, host,port or host\instance.</summary>
        public (string Host, int? Port, string DataSource) SqlServerHost()
        {
            var server = Member.Profile.GetString("server")?.Trim();
            if (string.IsNullOrEmpty(server)) server = "localhost";
            var comma = server.IndexOf(',');
            if (comma > 0 && int.TryParse(server[(comma + 1)..].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var p))
                return (server[..comma].Trim(), p, server);
            var slash = server.IndexOf('\\');
            return (slash > 0 ? server[..slash] : server, null, server);
        }

        /// <summary>Oracle Easy Connect / descriptor of the member.</summary>
        public string OracleConnect()
        {
            var service = Member.Profile.GetString("serviceName")?.Trim();
            var sid = Member.Profile.GetString("sid")?.Trim();
            var tns = Member.Profile.GetString("tnsAlias")?.Trim();
            var descriptor = Member.Profile.GetString("descriptor")?.Trim();
            if (!string.IsNullOrEmpty(descriptor)) return descriptor;
            if (!string.IsNullOrEmpty(tns)) return tns;
            var data = !string.IsNullOrEmpty(service) ? $"(SERVICE_NAME={service})" : !string.IsNullOrEmpty(sid) ? $"(SID={sid})" : "(SERVICE_NAME=<service>)";
            if (data.Contains("<service>", StringComparison.Ordinal)) Placeholders.Add("<service>");
            return $"(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST={Host})(PORT={Port}))(CONNECT_DATA={data}))";
        }

        public string OracleEasyConnect()
        {
            var service = Member.Profile.GetString("serviceName")?.Trim();
            if (string.IsNullOrEmpty(service))
            {
                Placeholders.Add("<service>");
                service = "<service>";
            }
            return $"//{Host}:{Port}/{service}";
        }

        /// <summary>The remote schema of the member (connection default when the member names none).</summary>
        public string RemoteSchema(string fallback) => Member.Schema is { Length: > 0 } s ? s : fallback;

        public IEnumerable<string> TableNames => Member.Tables?.Select(t => t.Name) ?? Member.Mounted.Select(t => t.Name);

        public void Line(string s = "") => Text.Append(s).Append('\n');

        public void Note(string s) => Notes.Add(s);
    }

    private static string Sq(string s) => "'" + s.Replace("'", "''", StringComparison.Ordinal) + "'";
    private static string NSq(string s) => "N" + Sq(s);
    private static string Br(string s) => "[" + s.Replace("]", "]]", StringComparison.Ordinal) + "]";
    private static string Dq(string s) => "\"" + s.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    private static string Bt(string s) => "`" + s.Replace("`", "``", StringComparison.Ordinal) + "`";

    private static string Inv(int n) => n.ToString(CultureInfo.InvariantCulture);

    // ---------------------------------------------------------------- SQL Server linked server

    private static void LinkedServer(ScriptBuilder s, string name)
    {
        var m = s.Member;
        s.Line($"-- Linked server {name} → {m.ProviderId} member '{m.Alias}' ({m.Profile.Name})");
        s.Line("-- Run as a login with ALTER ANY LINKED SERVER. Replace the placeholders before running.");
        switch (m.ProviderId)
        {
            case "sqlserver":
            {
                var (_, _, dataSource) = s.SqlServerHost();
                s.Line($"EXEC master.dbo.sp_addlinkedserver @server = {NSq(name)}, @srvproduct = N'', @provider = N'MSOLEDBSQL', @datasrc = {NSq(dataSource)}{(s.Database is { } db ? $", @catalog = {NSq(db)}" : "")};");
                s.Note("Uses the Microsoft OLE DB Driver for SQL Server (MSOLEDBSQL) on the target server; older servers can use SQLNCLI11.");
                break;
            }
            case "oracle":
                s.Line($"EXEC master.dbo.sp_addlinkedserver @server = {NSq(name)}, @srvproduct = N'Oracle', @provider = N'OraOLEDB.Oracle', @datasrc = {NSq(s.OracleEasyConnect())};");
                s.Note("Needs the Oracle OLE DB provider (OraOLEDB.Oracle) installed on the SQL Server machine, with 'Allow inprocess' enabled.");
                break;
            default:
            {
                var (driver, extra) = m.ProviderId switch
                {
                    "postgresql" => ("PostgreSQL Unicode(x64)", $"Database={s.Database ?? "postgres"};"),
                    "mysql" or "mariadb" => ("MySQL ODBC 8.0 Unicode Driver", s.Database is { } d ? $"Database={d};" : ""),
                    "clickhouse" => ("ClickHouse ODBC Driver (Unicode)", s.Database is { } d2 ? $"Database={d2};" : ""),
                    "snowflake" => ("SnowflakeDSIIDriver", s.Database is { } d3 ? $"Database={d3};" : ""),
                    _ => ("<odbc driver>", ""),
                };
                if (driver.StartsWith('<')) s.Placeholders.Add(driver);
                s.Line($"EXEC master.dbo.sp_addlinkedserver @server = {NSq(name)}, @srvproduct = N'{m.ProviderId}', @provider = N'MSDASQL',");
                s.Line($"    @provstr = {NSq($"Driver={{{driver}}};Server={s.Host};Port={Inv(s.Port)};{extra}")};");
                s.Note($"Goes through ODBC (MSDASQL): install the '{driver}' ODBC driver on the SQL Server machine (or point @provstr at a system DSN).");
                break;
            }
        }
        s.Line($"EXEC master.dbo.sp_addlinkedsrvlogin @rmtsrvname = {NSq(name)}, @useself = N'False', @locallogin = NULL, @rmtuser = {NSq(s.User)}, @rmtpassword = {NSq(s.Password)};");
        s.Line($"EXEC master.dbo.sp_serveroption @server = {NSq(name)}, @optname = N'rpc out', @optvalue = N'true';");
        s.Line();
        s.Line("-- Examples");
        foreach (var t in s.TableNames.Take(5))
        {
            if (m.ProviderId == "sqlserver")
                s.Line($"SELECT TOP (100) * FROM {Br(name)}.{Br(s.Database ?? "master")}.{Br(s.RemoteSchema("dbo"))}.{Br(t)};");
            else
            {
                var remote = m.ProviderId == "oracle" ? $"SELECT * FROM {Dq(s.RemoteSchema(s.User).ToUpperInvariant())}.{Dq(t)}" : m.ProviderId is "mysql" or "mariadb" ? $"SELECT * FROM {Bt(t)}" : $"SELECT * FROM {Dq(s.RemoteSchema("public"))}.{Dq(t)}";
                s.Line($"SELECT TOP (100) * FROM OPENQUERY({Br(name)}, {NSq(remote)});");
            }
        }
        s.Line($"-- Remove: EXEC master.dbo.sp_dropserver @server = {NSq(name)}, @droplogins = 'droplogins';");
    }

    // ---------------------------------------------------------------- PostgreSQL foreign data wrappers

    private static void Fdw(ScriptBuilder s, string name)
    {
        var m = s.Member;
        var server = LinkSql.QuoteIdent(name.ToLowerInvariant());
        var localSchema = LinkSql.QuoteIdent(name.ToLowerInvariant());
        string wrapper, serverOptions, mappingOptions, remoteSchema;
        switch (m.ProviderId)
        {
            case "postgresql":
                wrapper = "postgres_fdw";
                serverOptions = $"host {Sq(s.Host)}, port {Sq(Inv(s.Port))}, dbname {Sq(s.Database ?? "postgres")}";
                mappingOptions = $"user {Sq(s.User)}, password {Sq(s.Password)}";
                remoteSchema = s.RemoteSchema("public");
                s.Note("postgres_fdw ships with PostgreSQL (contrib); creating the extension needs superuser or the pg_database_owner role.");
                break;
            case "mysql" or "mariadb":
                wrapper = "mysql_fdw";
                serverOptions = $"host {Sq(s.Host)}, port {Sq(Inv(s.Port))}";
                mappingOptions = $"username {Sq(s.User)}, password {Sq(s.Password)}";
                remoteSchema = m.Schema ?? s.Database ?? "<database>";
                if (remoteSchema == "<database>") s.Placeholders.Add("<database>");
                s.Note("mysql_fdw is not part of PostgreSQL: install it on the PostgreSQL server (e.g. the postgresql-NN-mysql-fdw package) together with the MySQL client library.");
                break;
            case "oracle":
                wrapper = "oracle_fdw";
                serverOptions = $"dbserver {Sq(s.OracleEasyConnect())}";
                mappingOptions = $"user {Sq(s.User)}, password {Sq(s.Password)}";
                remoteSchema = (m.Schema ?? s.User).ToUpperInvariant();
                s.Note("oracle_fdw must be installed on the PostgreSQL server with the Oracle Instant Client; Oracle schema names are upper case.");
                break;
            default: // sqlserver
            {
                wrapper = "tds_fdw";
                var (host, port, _) = s.SqlServerHost();
                serverOptions = $"servername {Sq(host)}, port {Sq(Inv(port ?? 1433))}, database {Sq(s.Database ?? "master")}";
                mappingOptions = $"username {Sq(s.User)}, password {Sq(s.Password)}";
                remoteSchema = s.RemoteSchema("dbo");
                s.Note("tds_fdw (FreeTDS) must be installed on the PostgreSQL server.");
                break;
            }
        }
        s.Line($"-- Foreign server {name} → {m.ProviderId} member '{m.Alias}' ({m.Profile.Name})");
        s.Line("-- Replace the placeholders before running.");
        s.Line($"CREATE EXTENSION IF NOT EXISTS {wrapper};");
        s.Line($"CREATE SERVER {server} FOREIGN DATA WRAPPER {wrapper} OPTIONS ({serverOptions});");
        s.Line($"CREATE USER MAPPING FOR CURRENT_USER SERVER {server} OPTIONS ({mappingOptions});");
        s.Line($"CREATE SCHEMA IF NOT EXISTS {localSchema};");
        // The foreign tables keep the remote names (oracle_fdw lower-cases them), and PostgreSQL folds an unquoted name to
        // lower case: a SQL Server table "Orders" must be written "Orders" in LIMIT TO and in the examples.
        string Tn(string t) => m.ProviderId == "oracle" || (PgPlain.IsMatch(t) && !LinkSql.NeedsQuoting(t)) ? LinkSql.QuoteIdent(t) : "\"" + t.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
        var limit = m.AllTables ? "" : " LIMIT TO (" + string.Join(", ", s.TableNames.Select(Tn)) + ")";
        if (!m.AllTables && !s.TableNames.Any()) limit = "";
        s.Line($"IMPORT FOREIGN SCHEMA {Dq(remoteSchema)}{limit} FROM SERVER {server} INTO {localSchema};");
        s.Line();
        s.Line("-- Examples");
        foreach (var t in s.TableNames.Take(5)) s.Line($"SELECT * FROM {localSchema}.{Tn(t)} LIMIT 100;");
        s.Line($"-- Remove: DROP SCHEMA {localSchema} CASCADE; DROP SERVER {server} CASCADE;");
    }

    // ---------------------------------------------------------------- Oracle database link

    private static void DbLink(ScriptBuilder s, string name)
    {
        var m = s.Member;
        var link = name.ToUpperInvariant();
        s.Line($"-- Database link {link} → {m.ProviderId} member '{m.Alias}' ({m.Profile.Name})");
        s.Line("-- Needs the CREATE DATABASE LINK privilege. Replace the placeholders before running.");
        if (m.ProviderId == "oracle")
        {
            s.Line($"CREATE DATABASE LINK {Dq(link)} CONNECT TO {Dq(s.User.ToUpperInvariant())} IDENTIFIED BY {Dq(s.Password)}");
            s.Line($"    USING {Sq(s.OracleConnect())};");
            s.Line();
            s.Line("-- Examples");
            foreach (var t in s.TableNames.Take(5))
                s.Line($"SELECT * FROM {Dq(s.RemoteSchema(s.User).ToUpperInvariant())}.{Dq(t)}@{Dq(link)} FETCH FIRST 100 ROWS ONLY;");
        }
        else
        {
            s.Placeholders.Add("<gateway_tns_alias>");
            s.Line($"CREATE DATABASE LINK {Dq(link)} CONNECT TO {Dq(s.User)} IDENTIFIED BY {Dq(s.Password)}");
            s.Line("    USING '<gateway_tns_alias>';");
            s.Note($"A non-Oracle member goes through Oracle Database Gateway for ODBC (DG4ODBC): configure an ODBC DSN for the {m.ProviderId} server ({s.Host}:{Inv(s.Port)}), an init<sid>.ora with HS_FDS_CONNECT_INFO, a listener SID_DESC with PROGRAM=dg4odbc and a tnsnames.ora entry with (HS=OK); <gateway_tns_alias> is that entry.");
            s.Line();
            s.Line("-- Examples (remote names in the member's own case, quoted)");
            foreach (var t in s.TableNames.Take(5)) s.Line($"SELECT * FROM {Dq(t)}@{Dq(link)};");
        }
        s.Line($"-- Remove: DROP DATABASE LINK {Dq(link)};");
    }

    // ---------------------------------------------------------------- MySQL / MariaDB FEDERATED

    private static void Federated(ScriptBuilder s, string name, string targetProviderId)
    {
        var m = s.Member;
        var db = m.Schema ?? s.Database;
        if (db is null)
        {
            s.Placeholders.Add("<database>");
            db = "<database>";
        }
        s.Line($"-- FEDERATED tables over server {name} → {m.ProviderId} member '{m.Alias}' ({m.Profile.Name})");
        s.Line("-- Replace the placeholders before running.");
        s.Line($"CREATE SERVER {Bt(name)} FOREIGN DATA WRAPPER mysql OPTIONS (HOST {Sq(s.Host)}, PORT {Inv(s.Port)}, DATABASE {Sq(db)}, USER {Sq(s.User)}, PASSWORD {Sq(s.Password)});");
        s.Line();
        var tables = s.Member.Tables;
        var names = s.TableNames.ToList();
        foreach (var t in names)
        {
            var local = name + "_" + t;
            var source = tables?.FirstOrDefault(x => x.Name == t);
            if (source is { Columns.Count: > 0 })
            {
                s.Line($"CREATE TABLE {Bt(local)} (");
                var lines = source.Columns.Select(c => $"    {Bt(c.Name)} {c.SourceType}{(c.Nullable ? "" : " NOT NULL")}").ToList();
                if (source.PrimaryKey.Count > 0) lines.Add($"    PRIMARY KEY ({string.Join(", ", source.PrimaryKey.Select(Bt))})");
                s.Line(string.Join(",\n", lines));
                s.Line($") ENGINE = FEDERATED CONNECTION = {Sq(name + "/" + t)};");
            }
            else
            {
                s.Line($"-- {t}: copy its column list from SHOW CREATE TABLE on the member server");
                s.Line($"CREATE TABLE {Bt(local)} ( /* columns of {db}.{t} */ ) ENGINE = FEDERATED CONNECTION = {Sq(name + "/" + t)};");
            }
            s.Line();
        }
        if (names.Count == 0) s.Line("-- (the member mounts no explicit tables: add one CREATE TABLE … ENGINE = FEDERATED per remote table)");
        s.Note(targetProviderId == "mariadb"
            ? "MariaDB: FEDERATEDX must be loaded (INSTALL SONAME 'ha_federatedx'); the column list must match the remote table."
            : "MySQL: the FEDERATED engine is disabled by default; start the server with --federated (or federated=ON in my.cnf). The column list must match the remote table.");
        s.Line($"-- Remove: DROP TABLE … ; DROP SERVER {Bt(name)};");
    }

    // ---------------------------------------------------------------- ClickHouse database engines

    private static void ClickHouse(ScriptBuilder s, string name)
    {
        var m = s.Member;
        var hostPort = $"{s.Host}:{Inv(s.Port)}";
        s.Line($"-- Database {name} → {m.ProviderId} member '{m.Alias}' ({m.Profile.Name}), read live through the {(m.ProviderId == "postgresql" ? "PostgreSQL" : "MySQL")} database engine");
        s.Line("-- Replace the placeholders before running.");
        if (m.ProviderId == "postgresql")
        {
            var schema = s.RemoteSchema("public");
            s.Line($"CREATE DATABASE IF NOT EXISTS {Bt(name)} ENGINE = PostgreSQL({Sq(hostPort)}, {Sq(s.Database ?? "postgres")}, {Sq(s.User)}, {Sq(s.Password)}, {Sq(schema)});");
        }
        else
        {
            var db = m.Schema ?? s.Database;
            if (db is null)
            {
                s.Placeholders.Add("<database>");
                db = "<database>";
            }
            s.Line($"CREATE DATABASE IF NOT EXISTS {Bt(name)} ENGINE = MySQL({Sq(hostPort)}, {Sq(db)}, {Sq(s.User)}, {Sq(s.Password)});");
        }
        s.Line();
        s.Line("-- Examples");
        foreach (var t in s.TableNames.Take(5)) s.Line($"SELECT * FROM {Bt(name)}.{Bt(t)} LIMIT 100;");
        s.Note("The database engine maps every table of the remote database/schema; ClickHouse reads them on each query (no copy).");
        s.Line($"-- Remove: DROP DATABASE {Bt(name)};");
    }
}
