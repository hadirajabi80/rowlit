// DuckDB dialect spec: the SQL of a linked database (plan-links WP-D), loaded lazily by dialect/registry.ts (D7).
// Rules for this chunk (and every file only it imports: format/rules/duckdb, data/duckdb-*.json):
// - no runtime import from the shell / intel / format modules (type imports are fine): use the kit arguments instead
//   (DialectKit here, SplitKit in a splitter, FormatKit in the rules factory), else the initial bundle re-partitions;
// - lazy-only shared helpers are fine: ./ansi (ANSI base), ../lexer/traits (traitLexer);
// - export `define` (DialectDefine).
// WP0 stub: the ANSI base, PostgreSQL-style operators and `$$` strings / `$1` / `?` parameters. WP-D owns this file and
// adds the DuckDB keywords, functions (data/duckdb-functions.json), FROM-first / GROUP BY ALL / QUALIFY / PIVOT, and a
// LexHook for `$name` parameters (the filter and builder binds are `$fp1`…: traits.ts lexes only `$1`).
import type { DialectDefine, FunctionCatalogJson, LexTraits } from './spec';
import catalog from './data/duckdb-functions.json';
import { ansiInit } from './ansi';
import { traitLexer } from '../lexer/traits';
import { duckdbRules } from '../../format/rules/duckdb';

const LEX: LexTraits = { dollarQuotes: true, dollarParams: true, paramPrefixes: '?' };

export const define: DialectDefine = (kit) =>
  kit.buildSpec({
    ...ansiInit('duckdb'),
    catalog: catalog as FunctionCatalogJson,
    caseFolding: 'insensitive',
    lex: LEX,
    lexHook: traitLexer(LEX),
    ops2: ['<>', '!=', '<=', '>=', '||', '::', '->', '=>', '**', '//', '~~', '^@'],
    ops3: ['->>', '!~~'],
    formatRules: duckdbRules,
  });
