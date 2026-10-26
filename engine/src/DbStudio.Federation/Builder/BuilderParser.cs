namespace DbStudio.Federation.Builder;

// WP-B fills this: SQL → BuilderModel ("Back to builder", POST /links/{cid}/parse) from ILinkRuntime.SerializeSqlAsync's
// AST. Returns null (ParseResult.Reason) for anything outside the builder subset (CTEs, subqueries, UNION, window
// functions, non-equi joins the model cannot hold, …). Round trip: compile(parse(compile(m))) == compile(m).
internal static class BuilderParserPlaceholder;
