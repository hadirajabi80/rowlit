// DuckDB dialect spec: the SQL of a linked database (plan-links WP-D), loaded lazily by dialect/registry.ts (D7).
// Rules for this chunk (and every file only it imports: format/rules/duckdb, data/duckdb-*.json):
// - no runtime import from the shell / intel / format modules (type imports are fine): use the kit arguments instead
//   (DialectKit here, FormatKit in the rules factory), else the initial bundle re-partitions;
// - lazy-only shared helpers are fine: ./ansi (ANSI base), ../lexer/traits (traitLexer);
// - export `define` (DialectDefine).
//
// A linked database runs DuckDB SQL over the mounted tables of its members: a table is `alias.table` (the alias is the
// DuckDB schema, so the catalog's schemas are the member aliases and completion needs nothing special for them). What
// is DuckDB-specific: FROM-first queries, GROUP BY ALL / ORDER BY ALL, QUALIFY, SELECT * EXCLUDE / REPLACE / COLUMNS(),
// ASOF / SEMI / ANTI / POSITIONAL joins, PIVOT / UNPIVOT / SUMMARIZE / DESCRIBE, list / struct / map literals and
// lambdas, `::` casts, `$name` / `$1` / `?` parameters (the filter and builder binds are `$fp1`…), dollar-quoted strings.
import type { CompletionItem, StatementKind, Token } from '../types';
import type { CursorContext } from '../context/context';
import type { CompleteEnv, ExtraCompletionSource } from '../complete/completer';
import type { LexHook } from '../lexer/lexer';
import type { DialectDefine, DialectSpec, FunctionCatalogJson, LexTraits } from './spec';
import catalog from './data/duckdb-functions.json';
import { ansiInit } from './ansi';
import { traitLexer } from '../lexer/traits';
import { duckdbRules } from '../../format/rules/duckdb';

// `$1` / `$$…$$` / `?` come from the traits; `$name` is added by the hook below (traits.ts lexes only `$1`).
const LEX: LexTraits = { dollarQuotes: true, dollarParams: true, paramPrefixes: '?', stringPrefixes: 'EXB' };

const base = traitLexer(LEX);
const DOLLAR = 36;

/**
 * `$name` is a named parameter, except when it opens a `$tag$ … $tag$` string: the identifier right after the `$` is then
 * closed by another `$`. A lone `$` (no identifier) and `$1` / `$$` stay with the trait lexer.
 */
export const duckdbLexHook: LexHook = (lx, start, c, c1) => {
  if (c === DOLLAR && c1 !== DOLLAR && lx.isIdentStart(c1)) {
    const t = lx.text;
    let p = start + 1;
    while (p < t.length && lx.isIdentPart(t.charCodeAt(p)) && t.charCodeAt(p) !== DOLLAR) p++;
    if (t.charCodeAt(p) !== DOLLAR) {
      lx.pos = p;
      return lx.make('param', start, p);
    }
  }
  return base(lx, start, c, c1);
};

// Reserved words (DuckDB's parser keywords that cannot be names) plus the statement heads.
const KEYWORDS = `
  ALL ALTER ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC BOTH BY EXCLUDE REPLACE CASE CAST CHECK COLLATE COLUMN CONSTRAINT CREATE CROSS
  DEFAULT DEFERRABLE DELETE DESC DESCRIBE DISTINCT DO DROP ELSE END EXCEPT EXISTS FALSE FETCH FOR FOREIGN FROM FULL GROUP
  HAVING IN INITIALLY INNER INSERT INTERSECT INTO IS JOIN LATERAL LEADING LEFT LIKE LIMIT NATURAL NOT NULL OFFSET ON ONLY
  OR ORDER OUTER PIVOT PLACING PRIMARY QUALIFY REFERENCES RETURNING RIGHT SELECT SET SHOW SOME SUMMARIZE SYMMETRIC TABLE
  THEN TO TRAILING TRUE UNION UNIQUE UNPIVOT UPDATE USING VARIADIC WHEN WHERE WINDOW WITH ILIKE GLOB SIMILAR ISNULL NOTNULL`;

const CONTEXTUAL = `
  ABORT ACTION ADD AFTER AGGREGATE ATTACH AT BEGIN BETWEEN BY CALL CASCADE CATALOG CHECKPOINT CLOSE COMMENT COMMIT COMMITTED
  CONFLICT COPY CUBE CURRENT CURRENT_CATALOG CURRENT_DATE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DATA
  DATABASE DAY DAYS DEALLOCATE DECLARE DEFERRED DEPENDS DETACH DICTIONARY DOMAIN DOUBLE EACH ENCODING ENUM ESCAPE
  EXCLUDING EXECUTE EXPLAIN EXPORT EXTENSION EXTERNAL FILTER FIRST FOLLOWING FORCE FORWARD FUNCTION GENERATED GLOBAL GRANT
  GROUPING GROUPS HOUR HOURS IDENTITY IF IGNORE IMMEDIATE IMPORT INCLUDE INCLUDING INDEX INHERITS INSTALL INSTEAD INTERVAL
  ISOLATION KEY LAMBDA LANGUAGE LAST LEVEL LISTEN LOAD LOCAL LOCK MACRO MAP MATCH MATERIALIZED MAXVALUE METHOD MICROSECOND
  MICROSECONDS MILLISECOND MILLISECONDS MINUTE MINUTES MINVALUE MONTH MONTHS NAME NAMES NEXT NO NOTHING NULLS OBJECT OF
  OFF OIDS OPTION OPTIONS ORDINALITY OTHERS OVER OVERRIDING OWNED OWNER PARTITION PASSING PASSWORD PERCENT PLANS PRAGMA
  PRECEDING PREPARE PRESERVE PRIOR PRIVILEGES PROCEDURE QUARTER QUARTERS RANGE READ RECHECK RECURSIVE REF REFERENCING
  REINDEX RELATIVE RELEASE RENAME REPEATABLE RESET RESPECT RESTART RESTRICT ROLE ROLLBACK ROLLUP ROW ROWS RULE
  SAMPLE SAVEPOINT SCHEMA SCHEMAS SCOPE SCROLL SECOND SECONDS SECRET SEQUENCE SEQUENCES SERIALIZABLE SERVER SESSION SETOF
  SETS SHARE SIMPLE SKIP SNAPSHOT STABLE STANDALONE START STATEMENT STATISTICS STDIN STDOUT STORAGE STORED STRICT STRUCT
  SYSID SYSTEM TABLES TABLESAMPLE TEMP TEMPLATE TEMPORARY TRANSACTION TRANSFORM TREAT TRIGGER TRUNCATE TRUSTED TRY_CAST
  TYPE TYPES UNBOUNDED UNCOMMITTED UNENCRYPTED UNION_BY_NAME UNKNOWN UNLISTEN UNLOGGED UNTIL USE USER VACUUM VALID VALIDATE
  VALIDATOR VALUE VALUES VARYING VERSION VIEW VIEWS VIRTUAL VOLATILE WEEK WEEKS WHITESPACE WITHIN WITHOUT WORK WRAPPER WRITE
  XML YEAR YEARS YES ZONE ASOF SEMI ANTI POSITIONAL`;

const STATEMENT_STARTS = `
  SELECT FROM WITH VALUES TABLE PIVOT UNPIVOT SUMMARIZE DESCRIBE SHOW EXPLAIN INSERT UPDATE DELETE CREATE ALTER DROP COPY
  EXPORT IMPORT ATTACH DETACH INSTALL LOAD USE SET RESET PRAGMA CALL CHECKPOINT BEGIN COMMIT ROLLBACK PREPARE EXECUTE
  TRUNCATE VACUUM ANALYZE COMMENT FORCE`;

const DATA_TYPES = `
  BOOLEAN BOOL TINYINT INT1 SMALLINT INT2 SHORT INTEGER INT INT4 SIGNED BIGINT INT8 LONG HUGEINT UTINYINT USMALLINT UINTEGER
  UBIGINT UHUGEINT FLOAT FLOAT4 REAL DOUBLE FLOAT8 DECIMAL NUMERIC VARCHAR CHAR BPCHAR TEXT STRING BLOB BYTEA BINARY
  VARBINARY BIT BITSTRING DATE TIME TIMETZ TIMESTAMP DATETIME TIMESTAMPTZ TIMESTAMP_S TIMESTAMP_MS TIMESTAMP_NS INTERVAL
  UUID JSON LIST STRUCT MAP ARRAY UNION ENUM VARINT BIGNUM GEOMETRY`;

/** Table functions offered in FROM / JOIN (a FROM-position name that takes arguments). */
const FROM_FUNCTIONS: [string, string, string][] = [
  ['range', 'range(${1:0}, ${2:10})', 'One row per value from start to stop (exclusive): range(0, 10).'],
  ['generate_series', 'generate_series(${1:1}, ${2:10})', 'One row per value from start to stop (inclusive).'],
  ['unnest', 'unnest(${1:list})', 'One row per list element.'],
];

const hasSource = (c: CursorContext) => c.afterSource || c.aliasTyping;

function score(prefix: string, label: string): number {
  if (!prefix) return 0;
  const p = prefix.toLowerCase();
  const l = label.toLowerCase();
  if (l === p) return 100;
  if (l.startsWith(p)) return 90 - Math.min(5, Math.floor((l.length - p.length) / 3));
  if (l.split('_').some((s) => s.startsWith(p))) return 60;
  if (l.includes(p)) return 50;
  return -1;
}
const sortText = (s: number) => Math.max(0, Math.min(9999999, 9999999 - Math.round(s * 100))).toString().padStart(7, '0');

/**
 * Table functions in a FROM / JOIN position (`FROM range(10)`, `FROM duckdb_tables()`): the shared completer offers them
 * only for T-SQL / SQLite / PostgreSQL, so DuckDB brings its own (DialectSpec.complete).
 */
export const duckdbComplete: ExtraCompletionSource = (c: CursorContext, env: CompleteEnv): CompletionItem[] | null => {
  if (c.qualifier || hasSource(c) || c.atStatementStart) return null;
  if (c.clause !== 'from' && c.clause !== 'join') return null;
  const out: CompletionItem[] = [];
  const add = (name: string, insert: string, detail: string, doc: string | undefined) => {
    const ms = score(c.prefixText, name);
    if (c.prefixText && ms < 0) return;
    const s = 3000 + ms;
    out.push({
      label: name, kind: 'function', detail, documentation: doc, insertText: insert, isSnippet: true, command: 'signatureHelp',
      sortText: sortText(s), filterText: name, score: s, usageKey: `duck:from:${name}`,
    });
  };
  for (const [name, body, doc] of FROM_FUNCTIONS) add(name, body, 'table function', doc);
  for (const f of env.spec.functions) {
    if (f.kind !== 'table') continue;
    add(f.name, f.name + '($0)', 'table function', f.doc + (f.columns ? ' Columns: ' + f.columns.join(', ') + '.' : ''));
  }
  return out;
};

const head = (toks: Token[], i: number, k: number) => toks[i + k]?.upper ?? '';

/** FROM-first queries, DESCRIBE / SUMMARIZE / SHOW / PIVOT are queries; COPY / EXPORT / IMPORT / INSTALL / LOAD are not. */
function classifyDuckDb(toks: Token[], i: number): StatementKind | undefined {
  switch (head(toks, i, 0)) {
    case 'FROM': case 'DESCRIBE': case 'SUMMARIZE': case 'SHOW': case 'PIVOT': case 'UNPIVOT': return 'select';
    case 'COPY': case 'EXPORT': case 'IMPORT': case 'INSTALL': case 'LOAD': case 'CHECKPOINT': return 'other';
    case 'BEGIN': {
      const n = head(toks, i, 1);
      return !n || n === ';' || n === 'TRANSACTION' || n === 'WORK' ? 'tx' : 'block';
    }
    case 'START': return head(toks, i, 1) === 'TRANSACTION' ? 'tx' : undefined;
    default: return undefined;
  }
}

export const define: DialectDefine = (kit) => {
  const spec: DialectSpec = kit.buildSpec({
    ...ansiInit('duckdb'),
    keywords: KEYWORDS,
    contextual: CONTEXTUAL,
    notAlias: 'QUALIFY ASOF SEMI ANTI POSITIONAL PIVOT UNPIVOT USING SAMPLE TABLESAMPLE WINDOW LATERAL',
    statementStarts: STATEMENT_STARTS,
    dataTypes: DATA_TYPES,
    catalog: catalog as unknown as FunctionCatalogJson,
    caseFolding: 'insensitive',
    quote: ['"', '"'],
    batchSeparator: null,
    identExtra: '$',
    snippets: [
      { prefix: 'sel', label: 'sel', body: 'SELECT ${1:*}\nFROM ${2:alias.table}$0', doc: 'SELECT ... FROM alias.table' },
      { prefix: 'fromfirst', label: 'fromfirst', body: 'FROM ${1:alias.table}\nSELECT ${2:*}$0', doc: 'FROM-first query' },
      { prefix: 'gba', label: 'gba', body: 'SELECT ${1:key}, COUNT(*) AS n\nFROM ${2:alias.table}\nGROUP BY ALL\nORDER BY n DESC$0', doc: 'GROUP BY ALL' },
      { prefix: 'qual', label: 'qual', body: 'SELECT *\nFROM ${1:alias.table}\nQUALIFY ROW_NUMBER() OVER (PARTITION BY ${2:key} ORDER BY ${3:ts} DESC) = 1$0', doc: 'Latest row per key (QUALIFY)' },
    ],
    selectKeywords: 'DISTINCT, DISTINCT ON (, ALL, CASE, CAST, TRY_CAST, NULL, EXISTS, NOT, COLUMNS(, * EXCLUDE (, * REPLACE (, INTERVAL',
    afterSourceKeywords: `
      WHERE, INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL JOIN, CROSS JOIN, JOIN, NATURAL JOIN, ASOF JOIN, ASOF LEFT JOIN,
      POSITIONAL JOIN, LEFT SEMI JOIN, LEFT ANTI JOIN, SEMI JOIN, ANTI JOIN, LATERAL, GROUP BY, GROUP BY ALL, ORDER BY,
      ORDER BY ALL, HAVING, QUALIFY, WINDOW, LIMIT, OFFSET, USING SAMPLE, TABLESAMPLE, PIVOT, UNPIVOT, UNION, UNION ALL,
      UNION BY NAME, UNION ALL BY NAME, EXCEPT, INTERSECT, AS`,
    afterExprKeywords: `
      AND, OR, NOT, IN, IS NULL, IS NOT NULL, IS DISTINCT FROM, IS NOT DISTINCT FROM, LIKE, ILIKE, NOT LIKE, GLOB, SIMILAR TO,
      BETWEEN, GROUP BY, GROUP BY ALL, ORDER BY, ORDER BY ALL, HAVING, QUALIFY, LIMIT, OFFSET, UNION, UNION ALL, EXCEPT,
      INTERSECT, OVER (, FILTER (`,
    startKeywords: `
      SELECT, FROM, WITH, VALUES, SUMMARIZE, DESCRIBE, SHOW TABLES, SHOW ALL TABLES, PIVOT, UNPIVOT, EXPLAIN, EXPLAIN ANALYZE,
      INSERT INTO, UPDATE, DELETE FROM, CREATE TABLE, CREATE OR REPLACE TABLE, CREATE VIEW, CREATE MACRO, DROP TABLE, SET`,
    ops2: ['<>', '!=', '<=', '>=', '||', '::', '->', '=>', '**', '//', '~~', '^@', '<<', '>>', '&&', '@>', '<@', '!~', ':='],
    ops3: ['->>', '!~~', '~~*'],
    lex: LEX,
    lexHook: duckdbLexHook,
    formatRules: duckdbRules,
    classify: classifyDuckDb,
  });
  spec.complete = duckdbComplete; // read by intel/index.ts (DialectSpec.complete)
  return spec;
};
