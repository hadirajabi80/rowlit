// DuckDB formatter tables (plan-links WP-D). Part of the lazy duckdb chunk (DialectSpec.formatRules, built by
// format/layout.ts rulesFor): no runtime imports, build from the FormatKit. Statements end at `;`; `$$` bodies are single
// string tokens. QUALIFY is a clause line of its own that breaks its condition at AND/OR like WHERE; ASOF / SEMI / ANTI /
// POSITIONAL extend the JOIN phrases; COLUMNS / UNNEST / STRUCT / MAP are called like functions.
import type { FormatRulesFactory } from '../../intel/dialect/spec';

export const duckdbRules: FormatRulesFactory = (kit) => ({
  ...kit.sqliteRules,
  dialect: 'duckdb',
  statementStarts: kit.set(`
    SELECT FROM WITH VALUES TABLE PIVOT UNPIVOT SUMMARIZE DESCRIBE SHOW EXPLAIN INSERT UPDATE DELETE CREATE ALTER DROP COPY
    EXPORT IMPORT ATTACH DETACH INSTALL LOAD USE SET RESET PRAGMA CALL CHECKPOINT BEGIN COMMIT ROLLBACK PREPARE EXECUTE
    TRUNCATE VACUUM ANALYZE COMMENT`),
  incomplete: kit.set(`
    SELECT FROM WHERE AND OR NOT ON JOIN AS BY SET INTO VALUES THEN ELSE WHEN CASE IN IS LATERAL USING DISTINCT OVER
    PARTITION QUALIFY PIVOT UNPIVOT SAMPLE TABLESAMPLE ILIKE GLOB EXCLUDE ASOF SEMI ANTI POSITIONAL`),
  functionKeywords: kit.set(`
    CAST TRY_CAST COALESCE NULLIF GREATEST LEAST EXTRACT POSITION SUBSTRING TRIM OVERLAY COLUMNS UNNEST ANY STRUCT MAP LIST ARRAY
    DECIMAL NUMERIC`),
  operandKeywords: new Set([...kit.OPERAND_KEYWORDS_COMMON, ...kit.set('CURRENT_CATALOG CURRENT_SCHEMA LOCALTIME LOCALTIMESTAMP')]),
  conditionClauses: new Set([...kit.CONDITION_CLAUSES, 'QUALIFY']),
  extraClauses: { QUALIFY: 'where' },
  joinWords: kit.set('ASOF SEMI ANTI POSITIONAL'),
});
