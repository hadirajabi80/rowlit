// Query builder model operations (reducers), join inference, the undo history and the compile of half-built models.
import { beforeEach, describe, expect, it } from 'vitest';
import type { BuilderModel, LinkCatalog, SourceTable } from '../../../api/links';
import { newCondition, newGroup } from '../../../filter/model';
import { useLinks } from '../../../store/links';
import { builderCatalogOf } from '../builder/catalog';
import { compileBuilder } from '../builder/compile';
import { placeCard } from '../builder/geometry';
import { autoJoinFor, nameForms, suggestBetween, suggestJoins } from '../builder/infer';
import * as M from '../builder/model';

const col = (name: string, kind = 'int', isPk = false) => ({ name, sourceType: kind === 'int' ? 'BIGINT' : 'VARCHAR', kind, nullable: true, isPk });
const table = (name: string, columns: ReturnType<typeof col>[], extra: Partial<SourceTable> = {}): SourceTable => ({
  name, linkName: name, database: null, schema: 'public', type: 'table', columns, primaryKey: columns.filter((c) => c.isPk).map((c) => c.name), foreignKeys: [], ...extra,
});

const CATALOG: LinkCatalog = {
  schemas: [
    {
      alias: 'crm', kind: 'connection', connectionId: 'c_pg', providerId: 'postgresql', warnings: [],
      tables: [
        table('customers', [col('id', 'int', true), col('name', 'string'), col('email', 'string'), col('country_id')],
          { foreignKeys: [{ name: 'fk_customers_countries', columns: ['country_id'], refSchema: 'public', refTable: 'countries', refColumns: ['id'] }] }),
        table('countries', [col('id', 'int', true), col('name', 'string')]),
      ],
    },
    {
      alias: 'shop', kind: 'connection', connectionId: 'c_shop', providerId: 'sqlite', warnings: [],
      tables: [
        table('orders', [col('id', 'int', true), col('customer_id'), col('status', 'string'), col('total')]),
        table('order_lines', [col('id', 'int', true), col('order_id'), col('sku', 'string')]),
      ],
    },
    { alias: 'erp', kind: 'connection', connectionId: 'c_prod', providerId: 'sqlserver', warnings: [], tables: [table('products', [col('sku', 'string', true), col('name', 'string')])] },
  ],
  relations: [{ id: 'r1', name: 'Orders → CRM', from: { alias: 'shop', table: 'orders' }, fromColumns: ['customer_id'], to: { alias: 'crm', table: 'customers' }, toColumns: ['id'] }],
};

function build(...names: [string, string][]): BuilderModel {
  let m = M.emptyModel();
  for (const [a, t] of names) m = M.addTable(m, a, t).model;
  return m;
}

describe('tables', () => {
  it('gives each table a unique SQL alias and removes everything that refers to a removed table', () => {
    let m = build(['crm', 'customers'], ['crm', 'customers'], ['shop', 'orders']);
    expect(m.tables.map((t) => [t.id, t.as])).toEqual([['t1', 'customers'], ['t2', 'customers2'], ['t3', 'orders']]);
    m = M.connect(m, 't1', 'id', 't3', 'customer_id').model;
    m = M.toggleColumn(m, 't3', 'total');
    m = M.updateColumn(m, m.columns[0].id, { agg: 'sum', alias: 'revenue' });
    m = M.setFilter(m, newGroup('and', [newCondition('t3.status', 'eq', ['paid']), newCondition('t1.name', 'contains', ['a'])]));
    m = M.setHaving(m, newGroup('and', [newCondition(m.columns[0].id, 'gt', [10])]));
    m = M.setSort(m, [{ ref: { columnId: m.columns[0].id }, dir: 'desc' }, { ref: { tableId: 't1', column: 'name' }, dir: 'asc' }]);
    const r = M.removeTable(m, 't3');
    expect(r.tables.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(r.joins).toEqual([]);
    expect(r.columns).toEqual([]);
    expect(r.filter?.items.map((i) => (i.kind === 'condition' ? i.column : ''))).toEqual(['t1.name']);
    expect(r.having).toBeNull();
    expect(r.sort).toEqual([{ ref: { tableId: 't1', column: 'name' }, dir: 'asc' }]);
  });

  it('renames a SQL alias only when it stays unique', () => {
    const m = build(['crm', 'customers'], ['shop', 'orders']);
    expect(M.renameAs(m, 't2', 'CUSTOMERS')).toBe(m);
    expect(M.renameAs(m, 't2', 'o').tables[1].as).toBe('o');
  });
});

describe('columns', () => {
  it('toggles a column, gives a colliding name a telling alias, selects all / none', () => {
    let m = build(['crm', 'customers'], ['crm', 'countries']);
    m = M.toggleColumn(m, 't1', 'name');
    m = M.toggleColumn(m, 't2', 'name');
    expect(m.columns.map((c) => [c.tableId, c.column, c.alias])).toEqual([['t1', 'name', null], ['t2', 'name', 'countries_name']]);
    expect(M.isColumnSelected(m, 't2', 'name')).toBe(true);
    m = M.toggleColumn(m, 't2', 'name');
    expect(M.isColumnSelected(m, 't2', 'name')).toBe(false);
    m = M.setAllColumns(m, 't2', ['id', 'name'], true);
    expect(m.columns.filter((c) => c.tableId === 't2')).toHaveLength(2);
    m = M.setAllColumns(m, 't2', ['id', 'name'], false);
    expect(m.columns.filter((c) => c.tableId === 't2')).toHaveLength(0);
  });

  it('turns a hidden helper column back on instead of adding a second one', () => {
    let m = M.toggleColumn(build(['crm', 'customers']), 't1', 'name');
    m = M.updateColumn(m, m.columns[0].id, { output: false });
    m = M.toggleColumn(m, 't1', 'name');
    expect(m.columns).toHaveLength(1);
    expect(m.columns[0].output).toBe(true);
  });

  it('moves, removes and adds calculated and count(*) columns', () => {
    let m = M.toggleColumn(M.toggleColumn(build(['crm', 'customers']), 't1', 'id'), 't1', 'name');
    m = M.addCalculated(m, 'upper(customers.name)', 'big').model;
    m = M.addCountAll(m).model;
    expect(m.columns.map((c) => c.alias ?? c.column)).toEqual(['id', 'name', 'big', 'count']);
    m = M.moveColumn(m, m.columns[3].id, 0);
    expect(m.columns[0].agg).toBe('count');
    m = M.removeColumn(m, m.columns[0].id);
    expect(m.columns).toHaveLength(3);
  });

  it('cycles the sort of a column: ascending, descending, off', () => {
    let m = build(['crm', 'customers']);
    const ref = { tableId: 't1', column: 'name' };
    m = M.cycleSort(m, ref);
    expect(m.sort[0].dir).toBe('asc');
    m = M.cycleSort(m, ref);
    expect(m.sort[0].dir).toBe('desc');
    m = M.cycleSort(m, ref);
    expect(m.sort).toEqual([]);
  });
});

describe('joins', () => {
  it('joins two tables, adds a second condition to the same join, refuses a second path', () => {
    let m = build(['crm', 'customers'], ['shop', 'orders'], ['shop', 'order_lines']);
    let r = M.connect(m, 't1', 'id', 't2', 'customer_id');
    expect(r.joinId).toBe('j1');
    m = r.model;
    r = M.connect(m, 't2', 'id', 't3', 'order_id');
    m = r.model;
    r = M.connect(m, 't2', 'status', 't1', 'name');
    expect(r.joinId).toBe('j1');
    m = r.model;
    expect(m.joins[0].on).toEqual([
      { leftColumn: 'id', rightColumn: 'customer_id', op: '=', ignoreCase: false, trim: false },
      { leftColumn: 'name', rightColumn: 'status', op: '=', ignoreCase: false, trim: false },
    ]);
    const cyc = M.connect(m, 't1', 'id', 't3', 'order_id');
    expect(cyc.joinId).toBeNull();
    expect('reason' in cyc && cyc.reason).toBe('cycle');
    expect(M.connect(m, 't1', 'id', 't1', 'id').joinId).toBeNull();
  });

  it('orients a join drawn towards the FROM table and flips LEFT / RIGHT with it', () => {
    let m = build(['crm', 'customers'], ['shop', 'orders']);
    m = M.connect(m, 't2', 'customer_id', 't1', 'id', { type: 'left' }).model;
    expect(m.joins[0]).toMatchObject({ left: 't1', right: 't2', type: 'right', on: [{ leftColumn: 'id', rightColumn: 'customer_id' }] });
    const sql = compileBuilder(m, builderCatalogOf(CATALOG)).sql;
    expect(sql).toContain('RIGHT JOIN shop.orders AS orders ON customers.id = orders.customer_id');
  });

  it('moves the first joined table to the front when the FROM table is not joined yet, and keeps a second group runnable', () => {
    let m = build(['erp', 'products'], ['crm', 'customers'], ['shop', 'orders']);
    m = M.connect(m, 't2', 'id', 't3', 'customer_id').model;
    expect(m.tables[0].id).toBe('t2');
    const r = compileBuilder(m, builderCatalogOf(CATALOG));
    expect(r.sql.split('\n').slice(1)).toEqual([
      'FROM crm.customers AS customers',
      'INNER JOIN shop.orders AS orders ON customers.id = orders.customer_id',
      'CROSS JOIN erp.products AS products',
    ]);
    expect(r.warnings.map((w) => w.code)).toEqual(['cartesian']);
    // two joined groups: the second group's first table is cross joined before its join
    let g = build(['crm', 'customers'], ['shop', 'orders'], ['crm', 'countries'], ['shop', 'order_lines']);
    g = M.connect(g, 't1', 'id', 't2', 'customer_id').model;
    g = { ...g, joins: [...g.joins, { id: 'j9', type: 'inner', left: 't3', right: 't4', on: [{ leftColumn: 'id', rightColumn: 'order_id' }] }] };
    g = M.normalizeJoins(g);
    expect(compileBuilder(g, builderCatalogOf(CATALOG)).sql).toContain('CROSS JOIN crm.countries AS countries\nINNER JOIN shop.order_lines AS order_lines ON countries.id = order_lines.order_id');
  });

  it('removes the join with its last condition, makes another table the FROM table', () => {
    let m = build(['crm', 'customers'], ['shop', 'orders']);
    m = M.connect(m, 't1', 'id', 't2', 'customer_id', { type: 'left' }).model;
    const flipped = M.makeFromTable(m, 't2');
    expect(flipped.tables[0].id).toBe('t2');
    expect(flipped.joins[0]).toMatchObject({ left: 't2', right: 't1', type: 'right', on: [{ leftColumn: 'customer_id', rightColumn: 'id' }] });
    expect(M.removeCondition(m, 'j1', 0).joins).toEqual([]);
  });

  it('cross joins two tables that have no join', () => {
    const m = M.crossJoin(build(['crm', 'customers'], ['crm', 'countries']), 't1', 't2').model;
    expect(compileBuilder(m, builderCatalogOf(CATALOG)).sql).toContain('CROSS JOIN crm.countries AS countries');
  });
});

describe('join inference', () => {
  it('knows foreign keys inside a member, virtual relations and naming conventions', () => {
    const m = build(['crm', 'customers'], ['crm', 'countries'], ['shop', 'orders'], ['shop', 'order_lines'], ['erp', 'products']);
    const [cu, co, or, ol, pr] = m.tables;
    expect(suggestBetween(CATALOG, cu, co)[0]).toMatchObject({ reason: 'fk', fromTable: 't1', fromColumns: ['country_id'], toTable: 't2', toColumns: ['id'], score: 100 });
    expect(suggestBetween(CATALOG, cu, or)[0]).toMatchObject({ reason: 'relation', fromTable: 't3', toTable: 't1', score: 95 });
    expect(suggestBetween(CATALOG, or, ol)[0]).toMatchObject({ reason: 'name', fromTable: 't4', fromColumns: ['order_id'], toTable: 't3', toColumns: ['id'] });
    expect(suggestBetween(CATALOG, ol, pr)[0]).toMatchObject({ reason: 'name', fromColumns: ['sku'], toColumns: ['sku'], score: 70 });
    expect(nameForms('categories')).toContain('category');
    expect(nameForms('order')).toContain('orders');
  });

  it('joins a new table automatically only when confident, and lists suggestions for unjoined pairs', () => {
    const m = build(['crm', 'customers'], ['shop', 'orders'], ['erp', 'products']);
    expect(autoJoinFor(m, CATALOG, 't2')).toMatchObject({ reason: 'relation' });
    expect(autoJoinFor(m, CATALOG, 't3')).toBeNull();
    const joined = M.connect(m, 't1', 'id', 't2', 'customer_id').model;
    expect(suggestJoins(joined, CATALOG).some((s) => (s.fromTable === 't2' && s.toTable === 't1') || (s.fromTable === 't1' && s.toTable === 't2'))).toBe(false);
  });
});

describe('placement', () => {
  it('puts a card right of the table it joins, else after the others with rows wrapping', () => {
    const cards = [{ id: 't1', x: 40, y: 40, w: 260, h: 300 }];
    expect(placeCard(cards, 260, 200, cards[0])).toEqual({ x: 410, y: 40 });
    const row = [0, 1, 2].map((i) => ({ id: `t${i}`, x: 40 + i * 370, y: 40, w: 260, h: 200 }));
    expect(placeCard(row, 260, 200)).toEqual({ x: 40, y: 288 });
  });
});

describe('undo history', () => {
  beforeEach(() => useLinks.setState({ history: {} }));

  it('records, undoes, redoes and merges quick edits of one field', () => {
    const s = useLinks.getState();
    const a = build(['crm', 'customers']);
    const b = M.toggleColumn(a, 't1', 'id');
    const c = M.toggleColumn(b, 't1', 'name');
    s.record('tab', a);
    s.record('tab', b, 'alias:c1');
    s.record('tab', b, 'alias:c1');
    expect(useLinks.getState().history.tab.past).toHaveLength(2);
    expect(s.undo('tab', c)).toBe(b);
    expect(s.undo('tab', b)).toBe(a);
    expect(s.undo('tab', a)).toBeNull();
    expect(s.redo('tab', a)).toBe(b);
    expect(s.redo('tab', b)).toBe(c);
    s.clearHistory('tab');
    expect(useLinks.getState().history.tab).toBeUndefined();
  });
});
