using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.Security;

/// <summary>Catalog queries and deliberately small, validated DDL generators for the security workspace.</summary>
public static class SecuritySql
{
    public static readonly IReadOnlySet<string> Providers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "postgresql", "mysql", "mariadb", "sqlserver", "oracle", "clickhouse", "snowflake" };
    public static readonly IReadOnlySet<string> WritableProviders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "postgresql", "mysql", "mariadb", "sqlserver" };

    public static IReadOnlyList<string> List(string providerId) => providerId switch
    {
        "postgresql" => ["SELECT rolname AS name, CASE WHEN rolcanlogin THEN 'user' ELSE 'role' END AS kind, rolcanlogin, NOT rolcanlogin AS disabled, rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_catalog.pg_roles ORDER BY rolname"],
        "mysql" or "mariadb" => ["SELECT User AS name, Host AS host, CASE WHEN account_locked = 'Y' AND (authentication_string IS NULL OR authentication_string = '') THEN 'role' ELSE 'user' END AS kind, account_locked, plugin FROM mysql.user ORDER BY User, Host"],
        "sqlserver" => [
            "SELECT name, CASE WHEN type = 'R' THEN 'role' ELSE 'login' END AS kind, is_disabled, type_desc, default_database_name FROM sys.server_principals WHERE type IN ('S','U','G','R','E','X') AND name NOT LIKE '##%' ORDER BY name",
            "SELECT name, CASE WHEN type = 'R' THEN 'role' ELSE 'user' END AS kind, CAST(0 AS bit) AS is_disabled, type_desc, default_schema_name FROM sys.database_principals WHERE type IN ('S','U','G','R','E','X') AND principal_id > 4 ORDER BY name"],
        "oracle" => ["SELECT username AS name, 'user' AS kind, account_status, default_tablespace FROM all_users ORDER BY username", "SELECT role AS name, 'role' AS kind FROM session_roles ORDER BY role"],
        "clickhouse" => ["SELECT name, 'user' AS kind, auth_type FROM system.users ORDER BY name", "SELECT name, 'role' AS kind FROM system.roles ORDER BY name"],
        "snowflake" => ["SHOW USERS", "SHOW ROLES"],
        _ => []
    };

    public static IReadOnlyList<string> Detail(string providerId, string kind, string name, string? host) => providerId switch
    {
        "postgresql" => [
            $"SELECT r.rolname AS member_of FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname={Lit(name)} ORDER BY r.rolname",
            $"SELECT u.rolname AS member FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname={Lit(name)} ORDER BY u.rolname",
            $"SELECT table_schema || '.' || table_name AS object, privilege_type, is_grantable, grantor FROM information_schema.role_table_grants WHERE grantee={Lit(name)} ORDER BY table_schema, table_name, privilege_type"],
        "mysql" or "mariadb" => [$"SHOW GRANTS FOR {MyAccount(name, host)}"],
        "sqlserver" => kind == SecurityKinds.Login ? [
            $"SELECT r.name AS member_of FROM sys.server_role_members m JOIN sys.server_principals r ON r.principal_id=m.role_principal_id JOIN sys.server_principals u ON u.principal_id=m.member_principal_id WHERE u.name={Lit(name)} ORDER BY r.name",
            $"SELECT permission_name, state_desc, class_desc FROM sys.server_permissions p JOIN sys.server_principals u ON u.principal_id=p.grantee_principal_id WHERE u.name={Lit(name)} ORDER BY permission_name"] : [
            $"SELECT r.name AS member_of FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id JOIN sys.database_principals u ON u.principal_id=m.member_principal_id WHERE u.name={Lit(name)} ORDER BY r.name",
            $"SELECT r.name AS member FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id JOIN sys.database_principals u ON u.principal_id=m.member_principal_id WHERE r.name={Lit(name)} ORDER BY u.name",
            $"SELECT COALESCE(OBJECT_SCHEMA_NAME(major_id)+'.'+OBJECT_NAME(major_id), class_desc) AS object, permission_name, state_desc, grantor.name AS grantor FROM sys.database_permissions p JOIN sys.database_principals grantee ON grantee.principal_id=p.grantee_principal_id LEFT JOIN sys.database_principals grantor ON grantor.principal_id=p.grantor_principal_id WHERE grantee.name={Lit(name)} ORDER BY object, permission_name"],
        "oracle" => [
            $"SELECT granted_role AS member_of FROM user_role_privs WHERE username={Lit(name.ToUpperInvariant())}",
            $"SELECT owner || '.' || table_name AS object, privilege, grantable, grantor FROM all_tab_privs WHERE grantee={Lit(name.ToUpperInvariant())} ORDER BY owner, table_name, privilege"],
        "clickhouse" => [$"SHOW GRANTS FOR {Ch(name)}"],
        "snowflake" => [$"SHOW GRANTS TO {(kind == SecurityKinds.Role ? "ROLE" : "USER")} {Sf(name)}"],
        _ => []
    };

    public static SecurityScriptResult Script(string providerId, SecurityChangeRequest? raw)
    {
        var r = Validate(raw);
        if (!WritableProviders.Contains(providerId)) throw EngineException.Validation($"Security changes are read-only for {providerId}.");
        var sql = providerId switch
        {
            "postgresql" => Pg(r),
            "mysql" or "mariadb" => My(r),
            "sqlserver" => Ms(r),
            _ => throw EngineException.Validation($"Security changes are not supported for {providerId}.")
        };
        var masked = string.IsNullOrEmpty(r.Password) ? sql : sql.Select(x => x.Replace(SqlString(r.Password), "'********'", StringComparison.Ordinal)).ToList();
        return new(sql, masked, providerId == "postgresql", []);
    }

    private static SecurityChangeRequest Validate(SecurityChangeRequest? r)
    {
        if (r is null) throw EngineException.Validation("A request body is required.");
        if (!SecurityActions.Valid(r.Action)) throw EngineException.Validation("action must be create, drop, password, grant, revoke or membership.", new { field = "action" });
        if (!SecurityKinds.Valid(r.Kind)) throw EngineException.Validation("kind must be user, login or role.", new { field = "kind" });
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 128 || r.Name.Any(char.IsControl)) throw EngineException.Validation("A valid principal name is required.", new { field = "name" });
        if (r.Action is SecurityActions.Create or SecurityActions.Password && r.Kind != SecurityKinds.Role && string.IsNullOrEmpty(r.Password))
            throw EngineException.Validation("password is required.", new { field = "password" });
        if (r.Action == SecurityActions.Membership && string.IsNullOrWhiteSpace(r.Role)) throw EngineException.Validation("role is required.", new { field = "role" });
        if (r.Action is SecurityActions.Grant or SecurityActions.Revoke && (r.Privileges is null || r.Privileges.Count == 0))
            throw EngineException.Validation("Pick at least one privilege.", new { field = "privileges" });
        return r with { Action = r.Action!.ToLowerInvariant(), Kind = r.Kind!.ToLowerInvariant(), Name = r.Name.Trim(), Host = string.IsNullOrWhiteSpace(r.Host) ? "%" : r.Host.Trim() };
    }

    private static List<string> Pg(SecurityChangeRequest r)
    {
        var n = PgId(r.Name!); var role = PgId(r.Role ?? "");
        return r.Action switch
        {
            SecurityActions.Create => [$"CREATE {(r.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {n}{(r.Kind == SecurityKinds.Role ? "" : $" LOGIN PASSWORD {SqlString(r.Password!)}")}"],
            SecurityActions.Drop => [$"DROP {(r.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {n}"],
            SecurityActions.Password => [$"ALTER ROLE {n} PASSWORD {SqlString(r.Password!)}"],
            SecurityActions.Membership => [$"{(r.Remove ? "REVOKE" : "GRANT")} {role} {(r.Remove ? "FROM" : "TO")} {n}"],
            SecurityActions.Grant or SecurityActions.Revoke => [$"{r.Action.ToUpperInvariant()} {Privs(r)} ON {PgTarget(r)} {(r.Action == SecurityActions.Grant ? "TO" : "FROM")} {n}{(r.Grantable && r.Action == SecurityActions.Grant ? " WITH GRANT OPTION" : "")}"],
            _ => []
        };
    }

    private static List<string> My(SecurityChangeRequest r)
    {
        var n = MyAccount(r.Name!, r.Host); var role = MyAccount(r.Role ?? "", "%");
        return r.Action switch
        {
            SecurityActions.Create => [$"CREATE {(r.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {n}{(r.Kind == SecurityKinds.Role ? "" : $" IDENTIFIED BY {SqlString(r.Password!)}")}"],
            SecurityActions.Drop => [$"DROP {(r.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {n}"],
            SecurityActions.Password => [$"ALTER USER {n} IDENTIFIED BY {SqlString(r.Password!)}"],
            SecurityActions.Membership => [$"{(r.Remove ? "REVOKE" : "GRANT")} {role} {(r.Remove ? "FROM" : "TO")} {n}"],
            SecurityActions.Grant or SecurityActions.Revoke => [$"{r.Action.ToUpperInvariant()} {Privs(r)} ON {MyTarget(r)} {(r.Action == SecurityActions.Grant ? "TO" : "FROM")} {n}{(r.Grantable && r.Action == SecurityActions.Grant ? " WITH GRANT OPTION" : "")}"],
            _ => []
        };
    }

    private static List<string> Ms(SecurityChangeRequest r)
    {
        var n = MsId(r.Name!); var role = MsId(r.Role ?? "");
        return r.Action switch
        {
            SecurityActions.Create when r.Kind == SecurityKinds.Login => [$"CREATE LOGIN {n} WITH PASSWORD = {NString(r.Password!)}"],
            SecurityActions.Create when r.Kind == SecurityKinds.User => [$"CREATE USER {n} WITH PASSWORD = {NString(r.Password!)}"],
            SecurityActions.Create => [$"CREATE ROLE {n}"],
            SecurityActions.Drop => [$"DROP {(r.Kind == SecurityKinds.Login ? "LOGIN" : r.Kind == SecurityKinds.Role ? "ROLE" : "USER")} {n}"],
            SecurityActions.Password when r.Kind == SecurityKinds.Login => [$"ALTER LOGIN {n} WITH PASSWORD = {NString(r.Password!)}"],
            SecurityActions.Password => [$"ALTER USER {n} WITH PASSWORD = {NString(r.Password!)}"],
            SecurityActions.Membership => [$"ALTER ROLE {role} {(r.Remove ? "DROP" : "ADD")} MEMBER {n}"],
            SecurityActions.Grant or SecurityActions.Revoke => [$"{(r.Deny && r.Action == SecurityActions.Grant ? "DENY" : r.Action.ToUpperInvariant())} {Privs(r)} ON {MsTarget(r)} {(r.Action == SecurityActions.Grant ? "TO" : "FROM")} {n}{(r.Grantable && r.Action == SecurityActions.Grant ? " WITH GRANT OPTION" : "")}"],
            _ => []
        };
    }

    private static string Privs(SecurityChangeRequest r) => string.Join(", ", r.Privileges!.Select(p =>
    {
        var v = p.Trim().ToUpperInvariant();
        if (v.Length is < 2 or > 40 || v.Any(c => !char.IsLetter(c) && c != ' ')) throw EngineException.Validation($"Invalid privilege '{p}'.", new { field = "privileges" });
        return v;
    }));
    private static string PgTarget(SecurityChangeRequest r) => (r.ObjectType ?? "table").ToUpperInvariant() switch
    {
        "DATABASE" => "DATABASE " + PgId(Need(r.Database, "database")),
        "SCHEMA" => "SCHEMA " + PgId(Need(r.Schema, "schema")),
        _ => "TABLE " + PgId(Need(r.Schema, "schema")) + "." + PgId(Need(r.Object, "object"))
    };
    private static string MyTarget(SecurityChangeRequest r) => r.ObjectType?.ToLowerInvariant() switch
    {
        "global" => "*.*",
        "database" => MyId(Need(r.Database, "database")) + ".*",
        _ => MyId(Need(r.Database, "database")) + "." + MyId(Need(r.Object, "object"))
    };
    private static string MsTarget(SecurityChangeRequest r) => r.ObjectType?.ToLowerInvariant() switch
    {
        "database" => "DATABASE::" + MsId(Need(r.Database, "database")),
        "schema" => "SCHEMA::" + MsId(Need(r.Schema, "schema")),
        _ => "OBJECT::" + MsId(Need(r.Schema, "schema")) + "." + MsId(Need(r.Object, "object"))
    };
    private static string Need(string? value, string field) => !string.IsNullOrWhiteSpace(value) ? value.Trim() : throw EngineException.Validation($"{field} is required.", new { field });
    internal static string PgId(string s) => '"' + s.Replace("\"", "\"\"") + '"';
    internal static string MyId(string s) => '`' + s.Replace("`", "``") + '`';
    internal static string MsId(string s) => '[' + s.Replace("]", "]]" ) + ']';
    internal static string Sf(string s) => PgId(s);
    internal static string Ch(string s) => PgId(s);
    internal static string SqlString(string s) => '\'' + s.Replace("'", "''") + '\'';
    internal static string NString(string s) => "N" + SqlString(s);
    internal static string Lit(string s) => SqlString(s);
    internal static string MyAccount(string name, string? host) => SqlString(name) + "@" + SqlString(string.IsNullOrWhiteSpace(host) ? "%" : host);
}
