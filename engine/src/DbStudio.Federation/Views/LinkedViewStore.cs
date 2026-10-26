namespace DbStudio.Federation.Views;

// WP-B fills this (plan-links 2): linked views. SQL in the SavedQueryStore (connection = the link, schema =
// LinkIds.ViewsSchema, so the explorer's Queries node lists them), the builder model and metadata in
// <DataDir>/linked-views.json (atomic writes, AtomicFile), keyed by the saved query id. Deleting the link deletes its views.
internal static class LinkedViewStorePlaceholder;
