namespace DbStudio.Federation.Provider;

// WP-A fills this (plan-links 2): ICatalogReader of a link. ListDatabasesAsync → [] (no database level), ListSchemasAsync →
// the member aliases (SchemaInfo with the table count), GetDefaultSchemaAsync → the first alias, LoadSchemaAsync(alias) →
// the mounted tables as CatalogObjects (type table, or view for mounted views) with the mapped columns (TypeText = the
// engine type, e.g. VARCHAR / DECIMAL(18,2)), primary key, same-source foreign keys (renamed to link names) and the
// virtual relations as ForeignKeyRefs; GetObjectDetailsAsync / GetDdlAsync from the same data. Reads through
// ILinkRuntime.CatalogAsync (cached), so the explorer, Ctrl+P, the Objects tab and IntelliSense see the link like any schema.
internal static class LinkCatalogReaderPlaceholder;
