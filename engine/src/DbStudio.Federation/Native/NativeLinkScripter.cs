namespace DbStudio.Federation.Native;

// WP-B fills this (plan-links 1, "Native links"): scripts that make a target server reach a member natively (SQL Server
// linked servers, postgres_fdw / mysql_fdw / oracle_fdw / tds_fdw + IMPORT FOREIGN SCHEMA, Oracle DATABASE LINK, MySQL
// FEDERATED, ClickHouse ENGINE = PostgreSQL / MySQL), secrets as <password> placeholders. Never executed by the engine:
// the UI opens the script in a console on the target connection.
internal static class NativeLinkScripterPlaceholder;
