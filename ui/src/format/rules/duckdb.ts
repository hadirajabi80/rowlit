// DuckDB formatter tables (plan-links WP-D). Part of the lazy duckdb chunk (DialectSpec.formatRules, built by
// format/layout.ts rulesFor): no runtime imports, build from the FormatKit. WP0 stub: the SQLite tables under this id.
import type { FormatRulesFactory } from '../../intel/dialect/spec';

export const duckdbRules: FormatRulesFactory = (kit) => ({ ...kit.sqliteRules, dialect: 'duckdb' });
