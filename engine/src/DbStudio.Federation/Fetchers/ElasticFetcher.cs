namespace DbStudio.Federation.Fetchers;

// WP-B fills this (P3): ISourceFetcher "elasticsearch": catalog = mounted indices with fields from the mapping (top-level
// and dotted object paths); fetch = _search with _source filtering, a bool/filter query for pushable predicates, size /
// search_after (or PIT) paging up to the cap. Uses the Sources.Elasticsearch client.
internal static class ElasticFetcherPlaceholder;
