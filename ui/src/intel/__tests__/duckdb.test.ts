// plan-links WP-D: the DuckDB dialect of a linked database: lexing (`$name`), functions, completion over a link catalog
// (aliases = schemas, `alias.table.` columns, FK / virtual-relation joins across aliases), statement kinds, formatter.
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../../api/types';
import { getSpec } from '../dialect';
import { ensureDialect } from '../dialect/registry';
import { tokenize } from '../lexer/lexer';
import { createIntel } from '../index';
import { formatSql } from '../../format';
import { rulesFor } from '../../format/layout';
import { complete, labels, find, indexOf } from './helpers';

/**
 * A link over two members: `crm` (customers, orders) and `erp` (invoices, products). `erp.invoices.customer_id` →
 * `crm.customers.id` is a virtual relation (it crosses two aliases, no database has it as a foreign key).
 */
const LINK: CatalogSnapshot = {
  connectionId: 'c_link', dialect: 'duckdb', database: null, defaultSchema: 'crm', version: 1, databases: [],
  schemas: [
    {
      name: 'crm', version: 1, objects: [
        { t: 'table', n: 'customers', c: [['id', 'BIGINT', 0, 1, 0, null], ['name', 'VARCHAR', 0, 0, 0, null], ['email', 'VARCHAR', 1, 0, 0, null], ['country', 'VARCHAR', 1, 0, 0, null]], pk: ['id'] },
        { t: 'table', n: 'orders', c: [['id', 'BIGINT', 0, 1, 0, null], ['customer_id', 'BIGINT', 0, 0, 0, null], ['total', 'DECIMAL(12,2)', 0, 0, 0, null], ['placed_at', 'TIMESTAMP', 1, 0, 0, null]], pk: ['id'], fk: [{ n: 'fk_orders_customer', cols: ['customer_id'], rs: 'crm', rt: 'customers', rcols: ['id'] }] },
      ],
    },
    {
      name: 'erp', version: 1, objects: [
        { t: 'table', n: 'invoices', c: [['id', 'BIGINT', 0, 1, 0, null], ['customer_id', 'BIGINT', 0, 0, 0, null], ['amount', 'DECIMAL(12,2)', 0, 0, 0, null], ['paid', 'BOOLEAN', 0, 0, 0, null]], pk: ['id'], fk: [{ n: 'rel_invoices_customer', cols: ['customer_id'], rs: 'crm', rt: 'customers', rcols: ['id'] }] },
        { t: 'table', n: 'products', c: [['sku', 'VARCHAR', 0, 1, 0, null], ['title', 'VARCHAR', 0, 0, 0, null], ['price', 'DECIMAL(12,2)', 0, 0, 0, null]], pk: ['sku'] },
      ],
    },
  ],
} as unknown as CatalogSnapshot;

let intel = createIntel('duckdb');
const spec = () => getSpec('duckdb');
const kinds = (sql: string) => tokenize(sql, spec()).filter((t) => t.kind !== 'eof' && t.kind !== 'ws').map((t) => `${t.kind}:${t.text}`);
const cplt = (input: string) => complete('duckdb', input, undefined, intel);

beforeAll(async () => {
  await ensureDialect('duckdb');
  intel = createIntel('duckdb'); // after the lazy chunk loaded: createIntel captures the spec
  intel.setCatalog(LINK);
});

describe('duckdb lexer', () => {
  it('lexes $name, $1 and ? as parameters', () => {
    expect(kinds('WHERE a = $id AND b = $fp1 AND c = $2 AND d = ?')).toEqual([
      'keyword:WHERE', 'ident:a', 'op:=', 'param:$id', 'keyword:AND', 'ident:b', 'op:=', 'param:$fp1', 'keyword:AND', 'ident:c', 'op:=', 'param:$2',
      'keyword:AND', 'ident:d', 'op:=', 'param:?',
    ]);
  });

  it('keeps $$ and $tag$ bodies as strings (a $tag without a closing $ is a parameter)', () => {
    expect(kinds('SELECT $$a;b$$, $q$x$$y$q$, $name')).toEqual(['keyword:SELECT', 'string:$$a;b$$', 'punct:,', 'string:$q$x$$y$q$', 'punct:,', 'param:$name']);
  });

  it('lexes the :: cast, lambdas, named arguments and E strings', () => {
    expect(kinds("SELECT x::INTEGER, list_transform(l, y -> y + 1), struct_pack(a := 1), E'a\\n'")).toEqual([
      'keyword:SELECT', 'ident:x', 'op:::', 'ident:INTEGER', 'punct:,', 'ident:list_transform', 'punct:(', 'ident:l', 'punct:,', 'ident:y', 'op:->', 'ident:y', 'op:+',
      'number:1', 'punct:)', 'punct:,', 'ident:struct_pack', 'punct:(', 'ident:a', 'op::=', 'number:1', 'punct:)', 'punct:,', "string:E'a\\n'",
    ]);
  });

  it('a parameter is a placeholder for the statement runner', () => {
    const i = createIntel('duckdb');
    i.setDocument('duck://p', 'SELECT * FROM crm.orders WHERE total > $min AND id = $1');
    expect(i.tokens('duck://p').filter((t) => t.kind === 'param').map((t) => t.text)).toEqual(['$min', '$1']);
  });
});

describe('duckdb spec', () => {
  it('has a full function catalog with signatures, aggregates, windows and table functions', () => {
    const s = spec();
    expect(s.functions.length).toBeGreaterThan(400);
    expect(s.functionMap.get('LIST_TRANSFORM')?.signatures[0].params).toEqual(['list ANY[]', 'lambda']);
    expect(s.functionMap.get('STRFTIME')?.returns).toBe('VARCHAR');
    expect(s.functionMap.get('STRING_AGG')?.kind).toBe('aggregate');
    expect(s.functionMap.get('ARG_MAX')?.signatures.length).toBeGreaterThanOrEqual(2);
    expect(s.functionMap.get('ROW_NUMBER')?.kind).toBe('window');
    expect(s.functionMap.get('DUCKDB_TABLES')?.kind).toBe('table');
    expect(s.functionMap.get('DUCKDB_TABLES')?.columns).toContain('table_name');
    expect(s.functionMap.get('CURRENT_DATE')?.kind).toBe('niladic');
    expect(s.operators.map((o) => o.op)).toContain('//');
    for (const f of s.functions) {
      expect(f.doc.length, f.name).toBeGreaterThan(3);
      expect(f.signatures.length, f.name).toBeGreaterThan(0);
    }
  });

  it('knows its keywords, types and folds names case-insensitively', () => {
    const s = spec();
    for (const k of ['QUALIFY', 'PIVOT', 'UNPIVOT', 'SUMMARIZE', 'ILIKE', 'GLOB']) expect(s.keywords.has(k), k).toBe(true);
    for (const t of ['HUGEINT', 'STRUCT', 'LIST', 'MAP', 'UUID', 'TIMESTAMPTZ', 'UBIGINT']) expect(s.dataTypeSet.has(t), t).toBe(true);
    expect(s.fold('Orders', false)).toBe('ORDERS');
    expect(s.quote).toEqual(['"', '"']);
  });

  it('classifies FROM-first queries and DuckDB statements', () => {
    const i = createIntel('duckdb');
    expect(i.classify('FROM crm.orders')).toBe('select');
    expect(i.classify('FROM crm.orders SELECT id')).toBe('select');
    expect(i.classify('SUMMARIZE crm.orders')).toBe('select');
    expect(i.classify('DESCRIBE crm.orders')).toBe('select');
    expect(i.classify('PIVOT crm.orders ON status USING sum(total)')).toBe('select');
    expect(i.classify('WITH t AS (SELECT 1) FROM t')).toBe('select');
    expect(i.classify('COPY crm.orders TO \'x.csv\'')).toBe('other');
    expect(i.classify('INSTALL httpfs')).toBe('other');
    expect(i.classify('DELETE FROM crm.orders')).toBe('delete:destructive');
  });
});

describe('completion over the link catalog', () => {
  it('`FROM |` offers the aliases (schemas) and the default alias tables', () => {
    const r = cplt('SELECT * FROM |');
    const l = labels(r.items);
    expect(l).toContain('crm');
    expect(l).toContain('erp');
    expect(l).toContain('customers');
  });

  it('`crm.` completes the tables of the member', () => {
    const l = labels(cplt('SELECT * FROM crm.|').items);
    expect(l).toEqual(expect.arrayContaining(['customers', 'orders']));
    expect(l).not.toContain('invoices');
    expect(labels(cplt('SELECT * FROM erp.|').items)).toEqual(expect.arrayContaining(['invoices', 'products']));
  });

  it('`crm.customers.` completes the columns, with their types', () => {
    const r = cplt('SELECT crm.customers.| FROM crm.customers');
    expect(labels(r.items)).toEqual(expect.arrayContaining(['id', 'name', 'email', 'country']));
    expect(find(r.items, 'total')).toBeUndefined();
    expect(find(r.items, 'id')?.description ?? find(r.items, 'id')?.detail).toMatch(/BIGINT/);
  });

  it('resolves aliases and completes their columns', () => {
    const r = cplt('SELECT o.| FROM crm.orders o JOIN crm.customers c ON c.id = o.customer_id');
    expect(labels(r.items)).toEqual(expect.arrayContaining(['id', 'customer_id', 'total', 'placed_at']));
    expect(labels(r.items)).not.toContain('email');
  });

  it('`WHERE |` offers the columns of both tables of a cross-source join', () => {
    const l = labels(cplt('SELECT * FROM crm.customers c JOIN erp.invoices i ON i.customer_id = c.id WHERE |').items);
    expect(l).toEqual(expect.arrayContaining(['name', 'amount', 'paid']));
  });

  it('suggests the join on a foreign key inside a member', () => {
    const r = cplt('SELECT * FROM crm.orders o JOIN |');
    const i = r.items.find((x) => /customers/.test(x.label) && /customer_id/.test(x.insertText + (x.detail ?? '') + (x.documentation ?? '')));
    expect(i, labels(r.items, 12).join(', ')).toBeDefined();
  });

  it('suggests the join across members through a virtual relation (a foreign key to another alias)', () => {
    // both directions: invoices -> customers (crm is the default alias, so it is written unqualified) ...
    const r = cplt('SELECT * FROM erp.invoices i JOIN |');
    const hit = r.items.find((x) => /customers/.test(x.label));
    expect(hit, labels(r.items, 12).join(', ')).toBeDefined();
    expect(hit!.insertText).toMatch(/customers c ON c.id = i.customer_id/);
    expect(indexOf(r.items, hit!.label)).toBeLessThanOrEqual(1);
    // ... and customers -> invoices (the referencing table of another alias is written alias.table)
    const back = cplt('SELECT * FROM crm.customers c JOIN |');
    const inv = back.items.find((x) => /invoices/.test(x.label));
    expect(inv, labels(back.items, 12).join(', ')).toBeDefined();
    expect(inv!.insertText).toMatch(/erp.invoices i ON i.customer_id = c.id/);
    expect(indexOf(back.items, inv!.label)).toBeLessThanOrEqual(1);
  });

  it('after ON, the related column of the join is the first suggestion', () => {
    const r = cplt('SELECT * FROM erp.invoices i JOIN crm.customers c ON |');
    expect(r.items.some((x) => /c\.id\s*=\s*i\.customer_id|i\.customer_id\s*=\s*c\.id/.test(x.insertText))).toBe(true);
  });

  it('offers table functions in FROM and DuckDB clauses after a source', () => {
    const f = labels(cplt('SELECT * FROM |').items, 400);
    expect(f).toEqual(expect.arrayContaining(['range', 'generate_series', 'duckdb_tables']));
    const k = labels(cplt('SELECT * FROM crm.orders |').items);
    expect(k).toEqual(expect.arrayContaining(['QUALIFY', 'ASOF JOIN']));
    expect(labels(cplt('SELECT * FROM crm.orders GROUP BY |').items)).toBeDefined();
  });

  it('completes functions with their signature in the select list', () => {
    const r = cplt('SELECT list_tr|');
    const f = r.items.find((x) => x.label.toLowerCase() === 'list_transform');
    expect(f).toBeDefined();
    expect(f!.detail).toContain('lambda');
  });

  it('`FROM crm.|` also works in a FROM-first statement', () => {
    expect(labels(cplt('FROM crm.|').items)).toEqual(expect.arrayContaining(['customers', 'orders']));
  });

  it('works after `;` in a multi-statement script', () => {
    expect(labels(cplt('SELECT 1;\n\nSELECT * FROM erp.|').items)).toContain('invoices');
  });
});

describe('duckdb formatter', () => {
  it('has its own rules', () => {
    const r = rulesFor(spec());
    expect(r.dialect).toBe('duckdb');
    expect(r.conditionClauses.has('QUALIFY')).toBe(true);
    expect(r.extraClauses?.QUALIFY).toBe('where');
    expect(r.functionKeywords.has('COLUMNS')).toBe(true);
  });

  it('QUALIFY is a clause line of its own, broken at AND / OR like WHERE', () => {
    const out = formatSql('select * from crm.orders qualify row_number() over (partition by customer_id order by placed_at desc) = 1 and total > 0', 'duckdb');
    expect(out.warnings).toEqual([]);
    expect(out.text).toMatch(/\nQUALIFY ROW_NUMBER\(\) OVER \(PARTITION BY customer_id ORDER BY placed_at DESC\) = 1\n {4}AND total > 0$/);
  });

  it('keeps parameters, casts, lambdas and the cross-link join intact', () => {
    const input = 'select c.name, sum(i.amount)::decimal(12,2) as due, list_transform([1,2,3], x -> x * 2) as l from crm.customers c asof left join erp.invoices i on i.customer_id = c.id where i.paid = false and c.country = $country group by all order by all';
    const out = formatSql(input, 'duckdb');
    expect(out.warnings).toEqual([]);
    const norm = (s: string) => kinds(s).map((k) => k.toUpperCase());
    expect(norm(out.text)).toEqual(norm(input));
    expect(out.text).toMatch(/\nASOF LEFT JOIN erp\.invoices i ON i\.customer_id = c\.id/);
    expect(out.text).toContain('$country');
    expect(out.text).toMatch(/\nGROUP BY ALL\nORDER BY ALL$/);
    // idempotent
    expect(formatSql(out.text, 'duckdb').text).toBe(out.text);
  });

  it('formats a FROM-first query and EXCLUDE / REPLACE', () => {
    const out = formatSql('from crm.customers select * exclude (email) replace (upper(name) as name) where country = $c', 'duckdb');
    expect(out.warnings).toEqual([]);
    expect(out.text.split('\n')[0]).toMatch(/^FROM crm\.customers/);
    expect(out.text).toContain('EXCLUDE (email)');
  });

  it('5,000 lines format quickly', () => {
    const stmt = 'select c.id, sum(o.total) from crm.customers c join crm.orders o on o.customer_id = c.id group by all;\n';
    const t0 = performance.now();
    formatSql(stmt.repeat(1000), 'duckdb');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
