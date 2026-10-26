namespace DbStudio.Federation.Provider;

// WP-A fills this (plan-links 2): IDbProvider (+ IObjectBrowserProvider) Id "linked" (LinkIds.ProviderId), DisplayName
// "Linked databases", Dialect.DuckDb, FormSpec with no fields (the UI has its own link editor), BuildConnectionString ""
// (not used), TestAsync = validate + ping every member, OpenSessionAsync → FederatedSession, OpenCatalogReaderAsync →
// LinkCatalogReader, DdlGenerator = CREATE TABLE text of the mapped columns, Diagnostics = DuckDB parse errors (optional),
// Identifiers = DuckDB rules (LinkSql). Register it in FederationModule (block LINKS-WPA): only then does GET /providers
// list "linked" and the UI's "Linked databases" entry open the real editor.
internal static class LinkedProviderPlaceholder;
