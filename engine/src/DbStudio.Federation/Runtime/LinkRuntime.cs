namespace DbStudio.Federation.Runtime;

// WP-A fills this: the real ILinkRuntime (Contracts/ILinkRuntime.cs): definitions from ConnectionStore (members resolved
// with ConnectionStore.WithSecrets + GetPassword, never sent to the UI), validation (LinkRules + fetchers), the cached
// link catalog, plans (QueryAnalyzer + ISourceFetcher.Accept/Describe), OpenQueryAsync for materialize, the per-session
// source cache and RefreshSourcesAsync. Registered in FederationModule (block LINKS-WPA) instead of UnavailableLinkRuntime.
internal static class LinkRuntimePlaceholder;
