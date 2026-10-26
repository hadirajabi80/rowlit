namespace DbStudio.Federation.Fetchers;

// WP-B fills this (P3): ISourceFetcher "mongodb": catalog = the member database's collections with top-level fields
// inferred from a sample (MountedTable.Options.sampleSize); fetch = find/aggregate with $project (projection), $match
// (pushable predicates on top-level fields), $limit; nested documents/arrays as JSON. Uses the Sources.Mongo client
// (SourceClientManager), never a second connection pool.
internal static class MongoFetcherPlaceholder;
