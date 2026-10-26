namespace DbStudio.Federation.Endpoints;

// WP-B fills this: the /links routes of Contracts/LinkApi.cs (validate, catalog, compile, parse, plan, views CRUD,
// materialize preview/start, native-script, refresh-sources), mapped from FederationModule.MapEndpoints (block LINKS-WPB)
// on the "/links" group. Request bodies are null-checked (400 VALIDATION), results serialized with CoreJson.Options.
// Everything goes through ILinkRuntime (WP-A), so these endpoints can be tested with a fake runtime before WP-A lands.
internal static class LinkEndpointsPlaceholder;
