// The linked-databases mock pack (mocks/packs/linked.ts): the sample link's catalog, the in-memory evaluator behind a
// link session (checked against the members' own rows), bind inlining, parse round trips of compiled builder SQL,
// validate, plan, refresh-sources and linked views.
import { describe, expect, it } from 'vitest';
import { api } from '../../../api/client';
import { linksApi, type BuilderModel, type LinkDefinition } from '../../../api/links';
import type { CellValue, WsEvent } from '../../../api/types';
import { inlineParams } from '../../../filter/sql';
import { builderCatalogOf, linkCatalog, linkedMockState, sqlToModel } from '../../../mocks/packs/linked';
import { installMockEngine } from '../../../test/mockServer';
import { compileBuilder } from '../builder/compile';

const mock = installMockEngine();
const engine = () => mock.ctx.engine;
const link = () => engine().conn('c_link')!;

type Session = Parameters<ReturnType<typeof engine>['interpret']>[0];

function session(cid: string): Session {
  const info = engine().createSession(cid, null, 'auto')!;
  return engine().sessions.get(info.sessionId)!;
}

/** Rows of a member table through the member's own console. */
function memberRows(cid: string, table: string): CellValue[][] {
  const r = engine().interpret(session(cid), `SELECT * FROM ${table}`);
  expect(r.error).toBeNull();
  return r.sets[0].rows;
}

function run(sql: string) {
  const r = engine().interpret(session('c_link'), sql);
  expect(r.error, r.error ?? '').toBeNull();
  return r.sets[0];
}

const num = (v: CellValue) => (typeof v === 'number' ? v : Number(v));

const model3: BuilderModel = {
  version: 1,
  tables: [
    { id: 't1', alias: 'shop', table: 'orders', as: 'orders', x: 0, y: 0 },
    { id: 't2', alias: 'shop', table: 'order_lines', as: 'order_lines', x: 0, y: 0 },
    { id: 't3', alias: 'erp', table: 'products', as: 'products', x: 0, y: 0 },
    { id: 't4', alias: 'crm', table: 'customers', as: 'customers', x: 0, y: 0 },
  ],
  joins: [
    { id: 'j1', type: 'inner', left: 't1', right: 't2', on: [{ leftColumn: 'id', rightColumn: 'order_id', op: '=' }] },
    { id: 'j2', type: 'inner', left: 't2', right: 't3', on: [{ leftColumn: 'product_id', rightColumn: 'id', op: '=' }] },
    { id: 'j3', type: 'inner', left: 't1', right: 't4', on: [{ leftColumn: 'customer_id', rightColumn: 'id', op: '=' }] },
  ],
  columns: [
    { id: 'c1', tableId: 't3', column: 'category', alias: null, agg: null },
    { id: 'c2', tableId: null, column: null, alias: 'lines', agg: 'count' },
    { id: 'c3', tableId: 't2', column: 'qty', alias: 'qty', agg: 'sum' },
  ],
  filter: { kind: 'group', id: 'g1', logic: 'and', items: [{ kind: 'condition', id: 'f1', column: 't1.status', op: 'eq', values: ['PAID'], enabled: true }] },
  groupBy: [], autoGroup: true, having: null,
  sort: [{ ref: { columnId: 'c3' }, dir: 'desc', nulls: null }], limit: null, offset: null, distinct: false,
};

describe('linked mock pack', () => {
  it('lists the provider and the sample link with three members', async () => {
    expect((await api.providers()).some((p) => p.id === 'linked' && p.dialect === 'duckdb')).toBe(true);
    const cat = await linksApi.catalog('c_link');
    expect(cat.schemas.map((s) => s.alias)).toEqual(['crm', 'shop', 'erp']);
    expect(cat.schemas[0].tables.map((t) => t.linkName)).toEqual(['customers', 'countries']);
    const orders = cat.schemas[1].tables.find((t) => t.linkName === 'orders')!;
    expect(orders.columns.map((c) => c.name)).toEqual(['id', 'customer_id', 'order_date', 'status', 'total']);
    expect(orders.columns.find((c) => c.name === 'total')!.kind).toBe('decimal');
    expect(orders.primaryKey).toEqual(['id']);
    expect(cat.relations.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('serves the link catalog to the explorer: aliases as schemas, DuckDB types', async () => {
    const s = await api.schemas('c_link', null);
    expect(s.schemas.map((x) => x.name)).toEqual(['crm', 'shop', 'erp', 'views']);
    expect(s.defaultSchema).toBe('crm');
    const snap = engine().catalog('c_link', null, ['shop']);
    expect(snap.dialect).toBe('duckdb');
    const lines = snap.schemas[0].objects.find((o) => o.n === 'order_lines')!;
    expect(lines.c!.map((c) => c[1])).toEqual(['BIGINT', 'BIGINT', 'BIGINT', 'BIGINT', 'DECIMAL(38,2)']);
    // the FK to orders stays (same member); the one to products (another member) does not
    expect(lines.fk!.map((f) => f.rt)).toEqual(['orders']);
  });

  it('runs a compiled four-table builder query across three members correctly', () => {
    const cat = builderCatalogOf(linkCatalog(engine(), link()));
    const r = compileBuilder(model3, cat);
    expect(r.params).toEqual([{ name: 'fp1', kind: 'string', value: 'PAID' }]);
    const set = run(inlineParams(r.sql, r.params, 'duckdb'));
    expect(set.columns.map((c) => [c.name, c.dbType])).toEqual([['category', 'VARCHAR'], ['lines', 'BIGINT'], ['qty', 'HUGEINT']]);

    // ground truth from the members' rows
    const orders = memberRows('c_shop', 'main.orders');
    const lines = memberRows('c_shop', 'main.order_lines');
    const products = memberRows('c_prod', 'dbo.products');
    const customers = new Set(memberRows('c_pg', 'public.customers').map((c) => num(c[0])));
    const paid = new Map(orders.filter((o) => String(o[3]).toLowerCase() === 'paid' && customers.has(num(o[1]))).map((o) => [num(o[0]), o]));
    const cats = new Map(products.map((p) => [num(p[0]), String(p[2])]));
    const expected = new Map<string, { lines: number; qty: number }>();
    for (const l of lines) {
      if (!paid.has(num(l[0])) || !cats.has(num(l[2]))) continue;
      const k = cats.get(num(l[2]))!;
      const e = expected.get(k) ?? { lines: 0, qty: 0 };
      e.lines++;
      e.qty += num(l[3]);
      expected.set(k, e);
    }
    expect(set.rows.length).toBe(expected.size);
    for (const [k, lc, q] of set.rows) expect({ lines: lc, qty: q }).toEqual(expected.get(String(k)));
    const qtys = set.rows.map((x) => num(x[2]));
    expect(qtys).toEqual([...qtys].sort((a, b) => b - a));
  });

  it('inlines the $fp binds of an execution on a link session', async () => {
    const cat = builderCatalogOf(linkCatalog(engine(), link()));
    const r = compileBuilder(model3, cat);
    const s = engine().createSession('c_link', null, 'auto')!;
    const done = new Promise<void>((resolve) => {
      const off = engine().subscribe((ev: WsEvent) => {
        if (ev.type === 'exec.done') { off(); resolve(); }
      });
    });
    const x = engine().execute(s.sessionId, { batches: [{ sql: r.sql, line: 1, col: 1 }], params: r.params, maxRows: 0, stopOnError: true, label: 'script' });
    expect('executionId' in x).toBe(true);
    await done;
    const sets = engine().sessions.get(s.sessionId)!.lastResults!.sets;
    expect(sets.length).toBe(1);
    expect(sets[0].rows.length).toBeGreaterThan(0);
  });

  it('runs hand-written SQL: aliases without AS, ORDER BY ordinal, LEFT JOIN … IS NULL, expressions', () => {
    const top = run('SELECT c.name, count(*) FROM crm.customers c JOIN shop.orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY 2 DESC LIMIT 10');
    expect(top.columns.map((c) => c.name)).toEqual(['name', 'count_star()']);
    expect(top.rows.length).toBe(10);
    const counts = top.rows.map((r) => num(r[1]));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    const orders = memberRows('c_shop', 'main.orders');
    const customers = memberRows('c_pg', 'public.customers');
    const buyers = new Set(orders.map((o) => num(o[1])));
    const none = run('SELECT count(*) AS n FROM crm.customers c LEFT JOIN shop.orders o ON o.customer_id = c.id WHERE o.id IS NULL');
    expect(none.rows[0][0]).toBe(customers.filter((c) => !buyers.has(num(c[0]))).length);

    const e = run("SELECT upper(status) AS s, round(sum(total), 2) AS t, year(order_date) AS y FROM shop.orders WHERE status IN ('paid', 'new') AND total BETWEEN 10 AND 1000 GROUP BY 1, 3 ORDER BY s, y NULLS LAST");
    expect(new Set(e.rows.map((r) => r[0]))).toEqual(new Set(['PAID', 'NEW']));
    expect(e.rows.every((r) => r[2] === 2025)).toBe(true);
    const like = run("SELECT name FROM erp.products WHERE name ILIKE '%' || 'keyboard' || '%' ESCAPE '\\'");
    const names = memberRows('c_prod', 'dbo.products').map((p) => String(p[1]));
    expect(like.rows.length).toBe(names.filter((n) => /keyboard/i.test(n)).length);
    expect(like.rows.length).toBeGreaterThan(0);
  });

  it('answers DuckDB-like errors and refuses writes', () => {
    const r1 = engine().interpret(session('c_link'), 'SELECT * FROM crm.nope');
    expect(r1.error).toMatch(/^Catalog Error: Table with name crm.nope does not exist!/);
    const r2 = engine().interpret(session('c_link'), 'SELECT nope FROM crm.customers');
    expect(r2.error).toMatch(/^Binder Error: Referenced column "nope" not found/);
    const r3 = engine().interpret(session('c_link'), 'DELETE FROM crm.customers');
    expect(r3.error).toMatch(/read-only/);
    const r4 = engine().interpret(session('c_link'), 'SELECT id FROM crm.customers JOIN shop.orders ON customers.id = orders.customer_id');
    expect(r4.error).toMatch(/Ambiguous reference/);
  });

  it('parses compiled builder SQL back into a model that compiles to the same SQL', () => {
    const cat = builderCatalogOf(linkCatalog(engine(), link()));
    const models: BuilderModel[] = [
      model3,
      { ...model3, tables: [model3.tables[0]], joins: [], columns: [], filter: null, sort: [], limit: 5 },
      {
        version: 1,
        tables: [{ ...model3.tables[3], id: 't1' }, { ...model3.tables[0], id: 't2' }, { id: 't3', alias: 'crm', table: 'countries', as: 'countries', x: 0, y: 0 }],
        joins: [
          { id: 'j1', type: 'left', left: 't1', right: 't2', on: [{ leftColumn: 'id', rightColumn: 'customer_id', op: '=' }] },
          { id: 'j2', type: 'full', left: 't1', right: 't3', on: [{ leftColumn: 'country_id', rightColumn: 'id', op: '=', ignoreCase: false, trim: false }] },
        ],
        columns: [
          { id: 'c1', tableId: 't3', column: 'name', alias: 'country' },
          { id: 'c2', tableId: null, column: null, expr: 'year(orders.order_date)', alias: 'year' },
          { id: 'c3', tableId: 't1', column: 'id', alias: 'buyers', agg: 'countDistinct' },
          { id: 'c4', tableId: 't2', column: 'total', alias: null, agg: 'avg' },
        ],
        filter: {
          kind: 'group', id: 'g', logic: 'and', items: [
            { kind: 'condition', id: 'a', column: 't2.status', op: 'in', values: ['paid', 'shipped'], enabled: true },
            { kind: 'group', id: 'g2', logic: 'or', items: [
              { kind: 'condition', id: 'b', column: 't1.name', op: 'contains', values: ['an'], enabled: true },
              { kind: 'condition', id: 'c', column: 't1.email', op: 'isNull', values: [], enabled: true },
              { kind: 'condition', id: 'd', column: 't2.total', op: 'between', values: [10, 99.5], enabled: true },
            ] },
            { kind: 'condition', id: 'e', column: 't1.is_active', op: 'isTrue', values: [], enabled: true },
          ],
        },
        groupBy: [], autoGroup: true,
        having: { kind: 'group', id: 'h', logic: 'and', items: [{ kind: 'condition', id: 'h1', column: 'c3', op: 'gte', values: [2], enabled: true }] },
        sort: [{ ref: { columnId: 'c4' }, dir: 'desc', nulls: null }, { ref: { tableId: 't3', column: 'name' }, dir: 'asc', nulls: 'first' }],
        limit: 50, offset: 10, distinct: false,
      },
    ];
    for (const m of models) {
      const r = compileBuilder(m, cat);
      const sql = inlineParams(r.sql, r.params, 'duckdb');
      const parsed = sqlToModel(engine(), link(), sql);
      expect(parsed.reason ?? null, sql).toBeNull();
      const again = compileBuilder(parsed.model!, cat);
      expect(inlineParams(again.sql, again.params, 'duckdb')).toBe(sql);
      // and it runs
      run(sql);
    }
  });

  it('explains what the builder cannot show', () => {
    expect(sqlToModel(engine(), link(), 'SELECT * FROM crm.customers WHERE id = $fp1').reason).toMatch(/bind parameters/);
    expect(sqlToModel(engine(), link(), 'SELECT * FROM crm.customers UNION SELECT * FROM crm.customers').reason).toMatch(/UNION/);
    expect(sqlToModel(engine(), link(), 'SELECT 1').reason).toMatch(/FROM/);
    expect(sqlToModel(engine(), link(), 'SELECT * FROM crm.customers c JOIN shop.orders o ON o.total > c.id + 1').reason).toMatch(/condition/);
  });

  it('validates definitions', async () => {
    const def: LinkDefinition = {
      version: 1, relations: [], options: {},
      members: [
        { alias: 'main', connectionId: 'c_pg', schema: 'public', tables: [{ name: 'customers' }] },
        { alias: 'crm', connectionId: 'c_nope', tables: [{ name: 'x' }] },
        { alias: 'crm', connectionId: 'c_redis', tables: [] },
        { alias: 'loop', connectionId: 'c_link', allTables: true, tables: [] },
        { alias: 'ok', connectionId: 'c_shop', schema: 'main', tables: [{ name: 'orders' }, { name: 'products', as: 'orders' }, { name: 'ghost' }] },
      ],
    };
    const r = await linksApi.validate({ definition: def });
    expect(r.ok).toBe(false);
    const codes = r.problems.map((p) => `${p.member}:${p.code}`);
    expect(codes).toEqual(expect.arrayContaining(['0:aliasReserved', '1:memberMissing', '2:aliasDuplicate', '2:memberUnsupported', '2:noTables', '3:memberLinked', '4:tableDuplicate', '4:tableMissing']));
    expect(r.problems.find((p) => p.code === 'tableMissing')!.severity).toBe('warning');
    const fine = await linksApi.validate({ definition: { ...def, members: [def.members[4]].map((m) => ({ ...m, tables: [{ name: 'orders' }] })) } });
    expect(fine).toMatchObject({ ok: true, problems: [], members: [{ alias: 'ok', reachable: true, tables: 1 }] });
  });

  it('plans push-down per source and remembers fetched sources until refresh', async () => {
    await linksApi.refreshSources('c_link');
    const plan = await linksApi.plan('c_link', { sql: "SELECT o.id, c.name FROM shop.orders o JOIN crm.customers c ON c.id = o.customer_id WHERE o.status = 'paid' AND c.id < 50" });
    expect(plan.parsed).toBe(true);
    const orders = plan.sources.find((s) => s.table.table === 'orders')!;
    expect(orders.sourceQuery).toBe('SELECT id, customer_id, status FROM main.orders WHERE status = \'paid\'');
    expect(orders.predicates).toEqual([{ column: 'status', op: '=', values: [{ kind: 'string', value: 'paid' }] }]);
    const customers = plan.sources.find((s) => s.table.table === 'customers')!;
    expect(customers.sourceQuery).toBe('SELECT id, name FROM public.customers WHERE id < 50');
    expect(customers.rows).toBe(49);
    expect(customers.cached).toBe(false);

    const top = await linksApi.plan('c_link', { sql: 'SELECT name FROM erp.products LIMIT 5' });
    expect(top.sources[0].sourceQuery).toBe('SELECT TOP 5 name FROM dbo.products');
    expect(top.warnings.map((w) => w.code)).toContain('limitWithoutOrder');

    run('SELECT count(*) FROM crm.customers');
    const again = await linksApi.plan('c_link', { sql: 'SELECT * FROM crm.customers' });
    expect(again.sources[0].cached).toBe(true);
    expect(again.warnings.map((w) => w.code)).toContain('cached');
    expect((await linksApi.refreshSources('c_link')).invalidated).toBeGreaterThan(0);
    expect((await linksApi.plan('c_link', { sql: 'SELECT * FROM crm.customers' })).sources[0].cached).toBe(false);
  });

  it('compiles through the engine route, with a plan on request', async () => {
    const r = await linksApi.compile('c_link', { model: model3, plan: true });
    expect(r.sql).toBe(compileBuilder(model3, builderCatalogOf(linkCatalog(engine(), link()))).sql);
    expect(r.plan!.sources.map((s) => `${s.table.alias}.${s.table.table}`)).toEqual(['shop.orders', 'shop.order_lines', 'erp.products', 'crm.customers']);
  });

  it('stores linked views and mirrors them into the link\'s saved queries', async () => {
    const seeded = await linksApi.views('c_link');
    expect(seeded.map((v) => v.name)).toEqual(['Revenue by country']);
    expect(seeded[0].builder?.tables.length).toBe(3);
    run(seeded[0].sql);
    const v = await linksApi.putView('c_link', 'new', { name: 'Paid lines', sql: 'SELECT * FROM shop.order_lines', builder: null });
    expect(v.id).toMatch(/^lv_mock_/);
    await expect(linksApi.putView('c_link', 'new', { name: 'paid LINES', sql: 'SELECT 1', builder: null })).rejects.toThrow(/already exists/);
    const res = await fetch(`http://engine.test/api/v1/connections/c_link/queries?schema=views`, { headers: { Authorization: 'Bearer test-token' } });
    const queries = (await res.json()) as { id: string; name: string }[];
    expect(queries.map((q) => q.name)).toEqual(['Paid lines', 'Revenue by country']);
    await linksApi.deleteView('c_link', v.id);
    expect((await linksApi.views('c_link')).map((x) => x.id)).toEqual([seeded[0].id]);
    expect(linkedMockState(engine())).toBeDefined();
  });
});
