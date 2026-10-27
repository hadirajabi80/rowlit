// plan-batch3 WP-SF: the Snowflake dialect (lazy chunk): VARIANT paths vs binds, $$ bodies, scripting blocks, statement
// kinds, upper-case folding, functions and system schemas, formatter rules.
import { beforeAll, describe, expect, it } from 'vitest';
import { getSpec } from '../dialect';
import { ensureDialect } from '../dialect/registry';
import { tokenize } from '../lexer/lexer';
import { createIntel } from '../index';
import { rulesFor } from '../../format/layout';
import { formatSql } from '../../format';
import type { CatalogSnapshot } from '../../api/types';
import { doc, fixtures, labels } from './helpers';

const kinds = (s: string) => tokenize(s, getSpec('snowflake')).filter((t) => t.kind !== 'eof' && t.kind !== 'ws').map((t) => `${t.kind}:${t.text}`);

beforeAll(async () => {
  await ensureDialect('snowflake');
});

describe('Snowflake lexer', () => {
  it('a colon after a value is the VARIANT path operator, not a bind', () => {
    expect(kinds('SELECT v:customer.name, t.v:items[0]::STRING FROM t WHERE id = :id AND x = ?')).toEqual([
      'keyword:SELECT', 'ident:v', 'op::', 'ident:customer', 'punct:.', 'ident:name', 'punct:,', 'ident:t', 'punct:.', 'ident:v', 'op::',
      'ident:items', 'op:[', 'number:0', 'op:]', 'op:::', 'ident:STRING', 'keyword:FROM', 'ident:t', 'keyword:WHERE', 'ident:id', 'op:=',
      'param::id', 'keyword:AND', 'ident:x', 'op:=', 'param:?',
    ]);
  });

  it('staged-file columns with a path are identifiers; $$ bodies and backslash escapes are strings', () => {
    expect(kinds('SELECT $1:sku FROM @stage')).toEqual(['keyword:SELECT', 'ident:$1', 'op::', 'ident:sku', 'keyword:FROM', 'op:@', 'ident:stage']);
    expect(kinds("SELECT 'it\\'s', $$a;b$$")).toEqual(['keyword:SELECT', "string:'it\\'s'", 'punct:,', 'string:$$a;b$$']);
  });

  it('// starts a line comment (as -- does): quotes and semicolons inside it are text', () => {
    expect(kinds("SELECT 1 // it's; not 'a string\n, 2")).toEqual(['keyword:SELECT', 'number:1', "comment:// it's; not 'a string", 'punct:,', 'number:2']);
    const i = createIntel('snowflake');
    i.setDocument('sf://c', "// a; b 'x\nSELECT 1; // c; d\nSELECT 2");
    expect(i.statements('sf://c').map((st) => st.text.split('\n').pop())).toEqual(['SELECT 1', 'SELECT 2']);
    expect(i.classify('// drop table x\nSELECT 1')).toBe('select');
  });

  it('folds unquoted names to upper case', () => {
    const spec = getSpec('snowflake');
    expect(spec.caseFolding).toBe('upper');
    expect(spec.fold('orders', false)).toBe('ORDERS');
    expect(spec.fold('Orders', true)).toBe('Orders');
  });

  it('knows its functions and system schemas', () => {
    const spec = getSpec('snowflake');
    expect(spec.functionMap.get('FLATTEN')?.kind).toBe('table');
    expect(spec.functionMap.get('IFF')?.signatures[0].params).toHaveLength(3);
    expect(spec.functionMap.get('ROUND')?.signatures.length).toBeGreaterThanOrEqual(2); // optional params expand
    expect(spec.systemCatalog?.schemas.map((s) => s.name)).toEqual(['INFORMATION_SCHEMA', 'ACCOUNT_USAGE']);
    expect(spec.dataTypeSet.has('VARIANT')).toBe(true);
    expect(spec.keywords.has('QUALIFY')).toBe(true);
  });
});

describe('Snowflake splitter and kinds', () => {
  it('keeps scripting blocks whole and ends plain statements at semicolons', () => {
    const i = createIntel('snowflake');
    i.setDocument('sf://1', [
      'BEGIN TRANSACTION;',
      'DECLARE',
      '  c1 CURSOR FOR SELECT ID FROM ORDERS;',
      '  n NUMBER DEFAULT 0;',
      'BEGIN',
      '  FOR r IN c1 DO',
      '    IF (r.ID > 2) THEN n := n + 1; END IF;',
      '  END FOR;',
      '  CREATE TABLE IF NOT EXISTS T (ID INT);',
      '  RETURN n;',
      'END;',
      'SELECT CASE WHEN a THEN 1 END FROM t;',
      'CREATE OR REPLACE PROCEDURE p() RETURNS VARCHAR LANGUAGE SQL AS $$ BEGIN RETURN 1; END; $$;',
      'COMMIT',
    ].join('\n'));
    const st = i.statements('sf://1');
    expect(st.map((s) => s.text.split('\n')[0])).toEqual([
      'BEGIN TRANSACTION', 'DECLARE', 'SELECT CASE WHEN a THEN 1 END FROM t', 'CREATE OR REPLACE PROCEDURE p() RETURNS VARCHAR LANGUAGE SQL AS $$ BEGIN RETURN 1; END; $$', 'COMMIT',
    ]);
    expect(st[1].text.endsWith('END')).toBe(true);
  });

  it('classifies Snowflake statement heads', () => {
    const i = createIntel('snowflake');
    expect(i.classify('SHOW WAREHOUSES')).toBe('select');
    expect(i.classify('LIST @stage')).toBe('select');
    expect(i.classify('PUT file:///tmp/a.csv @~')).toBe('insert');
    expect(i.classify('REMOVE @stage/old')).toBe('delete:destructive');
    expect(i.classify('BEGIN')).toBe('tx');
    expect(i.classify('BEGIN SELECT 1; END')).toBe('block');
    expect(i.classify('ALTER SESSION SET QUERY_TAG = 1')).toBe('set');
    expect(i.classify('EXECUTE IMMEDIATE $$ SELECT 1 $$')).toBe('block');
    expect(i.classify('DROP TABLE t')).toBe('drop:destructive');
  });

  it('runs a script as one batch per statement', () => {
    const i = createIntel('snowflake');
    i.setDocument('sf://2', 'USE WAREHOUSE COMPUTE_WH;\nBEGIN\n  SELECT 1;\nEND;\nSELECT 2');
    expect(i.batchesFor('sf://2').map((b) => [b.sql.split('\n')[0], b.line])).toEqual([['USE WAREHOUSE COMPUTE_WH', 1], ['BEGIN', 2], ['SELECT 2', 5]]);
  });
});

describe('Snowflake formatter', () => {
  it('has its own rules', () => {
    const r = rulesFor(getSpec('snowflake'));
    expect(r.dialect).toBe('snowflake');
    expect(r.functionKeywords.has('FLATTEN')).toBe(true);
    expect(r.conditionClauses.has('QUALIFY')).toBe(true);
    expect(r.statementStarts.has('UNDROP')).toBe(true);
  });

  it('formats a VARIANT / FLATTEN query keeping every token (paths, casts, binds)', () => {
    const input = 'select c.name, f.value:sku::string as sku from customers c, lateral flatten(input => c.profile:orders) f where c.id = :id';
    const out = formatSql(input, 'snowflake').text;
    const norm = (s: string) => kinds(s).map((k) => k.toUpperCase());
    expect(norm(out)).toEqual(norm(input));
    expect(out).toMatch(/FLATTEN\(input => c\.profile: ?orders\)/i);
    // the path colon is written without a space: f.value:sku
    expect(out).toContain('f.value:sku::string');
  });

  it('stage references and file URLs stay in one piece; their case is kept; // comments survive', () => {
    const a = formatSql("select $1:sku from @my_stage/path (file_format => 'csv') t", 'snowflake');
    expect(a.warnings).toEqual([]);
    expect(a.text).toContain("FROM @my_stage/path(file_format => 'csv') t");
    const b = formatSql("copy into t from @db.s.Stage/Table/x.csv file_format = (type = csv)", 'snowflake').text;
    expect(b).toContain('@db.s.Stage/Table/x.csv');
    const c = formatSql('list @~/a/b; list @%orders; put file:///tmp/a.csv @~/up; select 1', 'snowflake').text;
    expect(c).toContain('list @~/a/b;');
    expect(c).toContain('@%orders');
    expect(c).toContain('file:///tmp/a.csv @~/up;');
    const d = formatSql('remove @s/old // note; here\nselect 2 // another', 'snowflake').text;
    expect(d).toBe('REMOVE @s/old // note; here\nSELECT 2 // another');
    expect(formatSql(d, 'snowflake').text).toBe(d);
  });

  it('object kinds and clause words are upper-cased in their position: SHOW TABLES, USE ROLE, CLUSTER BY, RETURNS, LANGUAGE …', () => {
    const f = (s: string) => formatSql(s, 'snowflake').text.replace(/\s+/g, ' ');
    expect(f('show tables in schema s')).toBe('SHOW TABLES IN SCHEMA s');
    expect(f("show databases like 'x%'")).toBe("SHOW DATABASES LIKE 'x%'");
    expect(f('use warehouse w')).toBe('USE WAREHOUSE w');
    expect(f('use role r')).toBe('USE ROLE r');
    expect(f('alter table t cluster by (a, b)')).toBe('ALTER TABLE t CLUSTER BY (a, b)');
    expect(f('create or replace transient table t clone s.t')).toBe('CREATE OR REPLACE TRANSIENT TABLE t CLONE s.t');
    expect(f('create or replace secure view v as select 1')).toMatch(/^CREATE OR REPLACE SECURE VIEW v AS SELECT 1$/);
    expect(f('create or replace procedure p(x int) returns string language javascript as $$ return 1; $$'))
      .toBe('CREATE OR REPLACE PROCEDURE p (x INT) RETURNS STRING LANGUAGE JAVASCRIPT AS $$ return 1; $$');
    expect(f('create warehouse w with warehouse_size = xsmall')).toBe('CREATE WAREHOUSE w WITH warehouse_size = xsmall');
    expect(f('create or replace file format ff type = csv')).toBe('CREATE OR REPLACE FILE FORMAT ff type = csv');
    expect(f('grant usage on warehouse w to role r')).toBe('GRANT usage ON WAREHOUSE w TO ROLE r');
    expect(f('alter table t add column c int')).toBe('ALTER TABLE t ADD COLUMN c INT');
    expect(f("create table t (a number autoincrement, b varchar default 'x' comment 'hello')")).toBe("CREATE TABLE t ( a NUMBER AUTOINCREMENT, b VARCHAR DEFAULT 'x' COMMENT 'hello' )");
  });

  it('those words stay as typed where they are names', () => {
    const f = (s: string) => formatSql(s, 'snowflake').text.replace(/\s+/g, ' ');
    expect(f('create table stage (tag int, role varchar, comment varchar)')).toBe('CREATE TABLE stage ( tag INT, role VARCHAR, comment VARCHAR )');
    expect(f('alter table t add column refresh int')).toBe('ALTER TABLE t ADD COLUMN refresh INT');
    expect(f('select role, stage, warehouse from tasks')).toBe('SELECT role, stage, warehouse FROM tasks');
    expect(f('create table t2 as select a from stage')).toMatch(/FROM stage$/);
    const once = formatSql('create or replace procedure p(x int) returns string language python as $$ x $$', 'snowflake').text;
    expect(formatSql(once, 'snowflake').text).toBe(once);
  });

  it('QUALIFY is a clause line of its own, broken at AND / OR like WHERE', () => {
    const out = formatSql('select * from t qualify row_number() over (partition by a order by b) = 1 and x > 0', 'snowflake');
    expect(out.warnings).toEqual([]);
    expect(out.text).toMatch(/\nQUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY a ORDER BY b\) = 1\n {4}AND x > 0$/);
  });
});

// The shop fixture is a copy of the SQLite one (lower-case names); Snowflake stores unquoted names in upper case.
function upperShop(): CatalogSnapshot {
  const j = JSON.parse(JSON.stringify(fixtures.snowflake)) as {
    database: string; defaultSchema: string; databases: string[];
    schemas: { name: string; objects: { n: string; c?: [string, ...unknown[]][]; pk?: string[]; fk?: { cols: string[]; rs: string; rt: string; rcols: string[] }[] }[] }[];
  };
  const U = (x: string) => x.toUpperCase();
  j.database = 'SHOP'; j.defaultSchema = 'MAIN'; j.databases = ['SHOP', 'ARCHIVE'];
  for (const sc of j.schemas) {
    sc.name = U(sc.name);
    for (const o of sc.objects) {
      o.n = U(o.n);
      o.c = o.c?.map((c) => [U(c[0]), ...c.slice(1)] as [string, ...unknown[]]);
      o.pk = o.pk?.map(U);
      for (const f of o.fk ?? []) { f.cols = f.cols.map(U); f.rs = U(f.rs); f.rt = U(f.rt); f.rcols = f.rcols.map(U); }
    }
  }
  return j as unknown as CatalogSnapshot;
}

describe('Snowflake IntelliSense', () => {
  let intel: ReturnType<typeof createIntel>;
  beforeAll(() => {
    intel = createIntel('snowflake');
    intel.setCatalog(upperShop());
  });
  const at = (input: string) => {
    const d = doc(intel, input);
    return labels(intel.complete(d.uri, d.offset).items).filter((l) => l !== '*');
  };

  it('QUALIFY is a clause: its expression completes the columns of the FROM sources (also without a WHERE)', () => {
    expect(at('SELECT * FROM orders o QUALIFY ROW_NUMBER() OVER (ORDER BY |')).toEqual(expect.arrayContaining(['ID', 'TOTAL']));
    expect(at('SELECT * FROM orders o QUALIFY ROW_NUMBER() OVER (PARTITION BY o.| ORDER BY id) = 1')).toEqual(['ID', 'CUSTOMER_ID', 'ORDER_DATE', 'TOTAL']);
    expect(at('SELECT * FROM orders o GROUP BY ALL HAVING COUNT(*) > 1 QUALIFY o.|')).toContain('TOTAL');
  });

  it('table functions: FLATTEN / SPLIT_TO_TABLE output columns, also inside TABLE(…)', () => {
    const cols = ['SEQ', 'KEY', 'PATH', 'INDEX', 'VALUE', 'THIS'];
    expect(at('SELECT f.| FROM orders o, LATERAL FLATTEN(input => o.id) f')).toEqual(cols);
    expect(at('SELECT f.| FROM orders o, TABLE(FLATTEN(input => o.id)) f')).toEqual(cols);
    expect(at("SELECT s.| FROM TABLE(SPLIT_TO_TABLE('a,b', ',')) s")).toEqual(['SEQ', 'INDEX', 'VALUE']);
  });

  it('SAMPLE and Time Travel clauses do not hide the alias', () => {
    expect(at('SELECT * FROM orders o SAMPLE (10) WHERE o.|')).toContain('TOTAL');
    expect(at('SELECT * FROM orders AT (OFFSET => -60) o WHERE o.|')).toContain('TOTAL');
    expect(at('SELECT * FROM orders o TABLESAMPLE BERNOULLI (10 ROWS) REPEATABLE (7) WHERE o.|')).toContain('TOTAL');
  });

  it('completes inside the $$ body of a SQL procedure / function and of EXECUTE IMMEDIATE', () => {
    const proc = (body: string) => `CREATE OR REPLACE PROCEDURE p() RETURNS STRING LANGUAGE SQL AS $$\n${body}\n$$`;
    expect(at(proc('BEGIN\n  SELECT o.| FROM orders o;\nEND;'))).toEqual(['ID', 'CUSTOMER_ID', 'ORDER_DATE', 'TOTAL']);
    expect(at(proc('BEGIN\n  SELECT * FROM |;\nEND;'))).toEqual(expect.arrayContaining(['ORDERS', 'CUSTOMERS']));
    expect(at(proc('DECLARE\n  x INTEGER DEFAULT 1;\nBEGIN\n  LET rs RESULTSET := (SELECT t.| FROM orders t);\n  RETURN TABLE(rs);\nEND;'))).toContain('TOTAL');
    expect(at(proc('BEGIN\n  IF (1 > 0) THEN\n    UPDATE orders SET |\n  END IF;\nEND;'))).toContain('TOTAL');
    expect(at(proc('BEGIN\n  FOR r IN (SELECT 1) DO\n    DELETE FROM orders WHERE |;\n  END FOR;\nEND;'))).toContain('TOTAL');
    expect(at('CREATE FUNCTION f(x INT) RETURNS INT AS $$ SELECT MAX(total) FROM orders WHERE |$$')).toContain('TOTAL');
    expect(at('EXECUTE IMMEDIATE $$ BEGIN SELECT * FROM orders WHERE | ; END; $$')).toContain('TOTAL');
    // an unterminated body, and the replace range maps back to the document
    const d = doc(intel, 'CREATE PROCEDURE p() RETURNS STRING LANGUAGE SQL AS $$ BEGIN SELECT * FROM ord|');
    const r = intel.complete(d.uri, d.offset);
    expect(labels(r.items)).toContain('ORDERS');
    expect(d.text.slice(r.replaceRange[0], r.replaceRange[1])).toBe('ord');
  });

  it('other languages keep the body opaque', () => {
    expect(at('CREATE PROCEDURE p() RETURNS STRING LANGUAGE JAVASCRIPT AS $$ select * from | $$')).toEqual([]);
    expect(at('CREATE PROCEDURE p() RETURNS STRING LANGUAGE PYTHON RUNTIME_VERSION = 3.9 AS $$ x = | $$')).toEqual([]);
    expect(at("SELECT '$$ a|' AS x")).toEqual([]);
  });

  it('USE | offers the databases and the object kinds; USE DATABASE | the databases; USE SCHEMA | the schemas and db.', () => {
    const l = at('USE |');
    expect(l).toEqual(expect.arrayContaining(['SHOP', 'ARCHIVE', 'DATABASE', 'SCHEMA', 'WAREHOUSE', 'ROLE']));
    expect(at('USE DATABASE |')).toEqual(expect.arrayContaining(['SHOP', 'ARCHIVE']));
    expect(at('USE DATABASE |')).not.toContain('MAIN');
    expect(at('USE database ar|')).toEqual(['ARCHIVE']);
    const s = at('USE SCHEMA |');
    expect(s).toEqual(expect.arrayContaining(['MAIN', 'SHOP', 'ARCHIVE']));
    expect(at('USE SCHEMA shop.|')).toContain('MAIN');
    expect(at('USE WAREHOUSE |')).toEqual([]);
    expect(at('USE ROLE |')).toEqual([]);
    // finished: no names offered after the name
    expect(at('USE DATABASE shop |')).not.toContain('ARCHIVE');
  });

  it('USE SCHEMA db.| inserts the bare schema (no trailing dot); USE SCHEMA | inserts the database with a dot', () => {
    const d = doc(intel, 'USE SCHEMA shop.|');
    const r = intel.complete(d.uri, d.offset).items.find((i) => i.label === 'MAIN');
    expect(r?.insertText ?? r?.label).toBe('MAIN');
    const d2 = doc(intel, 'USE SCHEMA |');
    const r2 = intel.complete(d2.uri, d2.offset).items.find((i) => i.label === 'ARCHIVE' && i.kind === 'database');
    expect(r2?.insertText).toBe('ARCHIVE.');
  });

  it('three-part names of the console database: tables after db.schema., columns of db.schema.table', () => {
    expect(at('SELECT * FROM SHOP.MAIN.|')).toEqual(expect.arrayContaining(['ORDERS', 'CUSTOMERS']));
    expect(at('SELECT * FROM shop.main.|')).toEqual(expect.arrayContaining(['ORDERS']));
    expect(at('SELECT * FROM SHOP.MAIN.ORDERS o WHERE o.|')).toContain('TOTAL');
    expect(at('SELECT SHOP.MAIN.ORDERS.| FROM SHOP.MAIN.ORDERS')).toContain('TOTAL');
  });
});
