// WP-C fills this: BuilderModel → canonical DuckDB SQL + bind params, byte-identical to the engine's
// DbStudio.Federation/Builder/BuilderCompiler.cs (WP-B). The canonical layout is the header of
// engine/src/DbStudio.Federation/Contracts/BuilderModel.cs; identifiers through quoteIdent(name, 'duckdb') (lib/sql.ts),
// filters through buildPredicate(…, 'duckdb', { paramPrefix: 'fp', columnRef }) (filter/sql.ts). Shared goldens:
// engine/tests/DbStudio.Federation.Tests/Goldens/Builder/*.json (see __tests__/goldens.test.ts).
// Lazy: imported by the builder tab chunk only.
import type { BuilderModel, CompileResult } from '../../../api/links';
import type { ColumnInfo } from '../../../api/types';

/** Columns of the mounted tables the model uses, keyed "alias.table" (kinds drive the filter SQL). */
export type BuilderCatalog = Record<string, readonly Pick<ColumnInfo, 'name' | 'kind' | 'dbType'>[]>;

/** WP0 stub signature; WP-C implements it. */
export function compileBuilder(model: BuilderModel, catalog: BuilderCatalog): CompileResult {
  void model;
  void catalog;
  throw new Error('compileBuilder: not implemented yet (plan-links WP-C)');
}
