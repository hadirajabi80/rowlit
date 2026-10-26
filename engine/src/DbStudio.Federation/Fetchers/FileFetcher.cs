namespace DbStudio.Federation.Fetchers;

// WP-B fills this (P3): ISourceFetcher FetcherKeys.Files: members of kind "files", MountedTable.Name = absolute path,
// Options.format csv | tsv | json | ndjson | xlsx | parquet. Reads through Import's row sources (Parsing/RowSources,
// JsonRowSource, XlsxRowSource + type inference) and appends: the federation DuckDB runs with enable_external_access =
// false (DuckDbProbe.LockdownStatements), so read_csv_auto / read_parquet are not available on it (see wp0.md, deviation 3).
internal static class FileFetcherPlaceholder;
