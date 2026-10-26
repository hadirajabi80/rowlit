namespace DbStudio.Federation.Builder;

// WP-B fills this: BuilderModel → canonical DuckDB SQL + bind params (header of Contracts/BuilderModel.cs), byte-identical
// to the UI's components/Links/builder/compile.ts (WP-C). Filters follow ui/src/filter/sql.ts for dialect duckdb (ILIKE,
// `||`, ESCAPE '\', TRUE/FALSE, $fpN binds). Shared goldens: tests/DbStudio.Federation.Tests/Goldens/Builder/*.json.
internal static class BuilderCompilerPlaceholder;
