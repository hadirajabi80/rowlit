// IntelliSense of linked consoles over wide members (components/Links/intel/wideNames.ts): `pg.` → schemas, `pg.sales.` →
// tables, `ms.` → databases, `ms.Staging.` → schemas, `ms.Staging.dbo.` → tables, `ms.Sales.` (a schema of the default
// database) → tables, columns of a table named with 3 / 4 parts through its alias, and the "Loading…" row (with the load
// it starts) while a level or a table is not there yet.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkBrowseResult, LinkCatalog, SourceTable } from '../../../api/links';
import type { CatalogSnapshot, ConnectionProfile } from '../../../api/types';
import { createIntel, registerCompletionSource, type Intel } from '../../../intel';
import { ensureDialect } from '../../../intel/dialect/registry';
import { useConnections } from '../../../store/connections';
import { browseKey, useLinks } from '../../../store/links';
import { wideNameItems } from '../intel/wideNames';

const LINK = 'c_wide';

const col = (name: string, sourceType = 'bigint') => ({ name, sourceType, kind: sourceType === 'bigint' ? 'int' : 'string', nullable: false, isPk: name === 'id' });
const table = (linkName: string, path: string[] | null, cols: string[]): SourceTable => ({
  name: path ? path[path.length - 1] : linkName, linkName, database: null, schema: null, type: 'table', columns: cols.map((c) => col(c, c === 'id' ? 'bigint' : 'varchar')),
  primaryKey: ['id'], foreignKeys: [], ...(path ? { path } : {}),
});

const PG_ORDERS = table('sales.orders', ['sales', 'orders'], ['id', 'total', 'placed_at']);
const CATALOG: LinkCatalog = {
  relations: [],
  schemas: [
    { alias: 'pg', kind: 'connection', connectionId: 'c_pg', providerId: 'postgresql', warnings: [], scope: 'database', levels: ['schema'], defaultPath: ['public'], tables: [table('customers', null, ['id', 'name']), PG_ORDERS] },
    { alias: 'ms', kind: 'connection', connectionId: 'c_prod', providerId: 'sqlserver', warnings: [], scope: 'connection', levels: ['database', 'schema'], defaultPath: ['Shop', 'dbo'], tables: [table('Customers', null, ['id', 'name'])] },
    { alias: 'crm', kind: 'connection', connectionId: 'c_pg', providerId: 'postgresql', warnings: [], tables: [table('countries', null, ['id'])] },
  ],
};

const level = (alias: string, path: string[], r: Partial<LinkBrowseResult>): [string, { status: 'ready'; result: LinkBrowseResult; error: null }] =>
  [browseKey(alias, path), { status: 'ready', error: null, result: { alias, path, level: null, children: [], tables: [], warnings: [], ...r } }];

const BROWSE = Object.fromEntries([
  level('pg', [], { level: 'schema', children: [{ name: 'public', isDefault: true }, { name: 'sales', isDefault: false }] }),
  level('pg', ['sales'], { tables: [PG_ORDERS] }),
  level('ms', [], { level: 'database', children: [{ name: 'Shop', isDefault: true }, { name: 'Staging', isDefault: false }] }),
  level('ms', ['Shop'], { level: 'schema', children: [{ name: 'dbo', isDefault: true }, { name: 'Sales', isDefault: false }] }),
  level('ms', ['Shop', 'Sales'], { tables: [table('Sales.orders', ['Sales', 'orders'], ['id', 'amount'])] }),
  level('ms', ['Staging'], { level: 'schema', children: [{ name: 'dbo', isDefault: false }] }),
  level('ms', ['Staging', 'dbo'], { tables: [table('Staging.dbo.orders', ['Staging', 'dbo', 'orders'], ['id', 'loaded_at'])] }),
]);

const SNAPSHOT = {
  connectionId: LINK, dialect: 'duckdb', database: null, defaultSchema: 'pg', version: 1, databases: [],
  schemas: [
    { name: 'pg', version: 1, objects: [{ t: 'table', n: 'customers', c: [['id', 'BIGINT', 0, 1, 0, null], ['name', 'VARCHAR', 0, 0, 0, null]] }] },
    { name: 'ms', version: 1, objects: [{ t: 'table', n: 'Customers', c: [['id', 'BIGINT', 0, 1, 0, null]] }] },
    { name: 'crm', version: 1, objects: [{ t: 'table', n: 'countries', c: [['id', 'BIGINT', 0, 1, 0, null]] }] },
  ],
} as unknown as CatalogSnapshot;

const PROFILE = { id: LINK, name: 'Wide', providerId: 'linked', color: null, folder: null, readOnly: true, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null } as ConnectionProfile;

let intel: Intel;
let off: () => void;
let n = 0;

function complete(input: string) {
  const offset = input.indexOf('|');
  const text = input.replace('|', '');
  const uri = `wide://${++n}`;
  intel.setDocument(uri, text);
  return intel.complete(uri, offset).items;
}
const labels = (input: string) => complete(input).map((i) => i.label);

beforeAll(async () => {
  await ensureDialect('duckdb');
  intel = createIntel('duckdb');
  intel.setCatalog(SNAPSHOT);
  off = registerCompletionSource('duckdb', wideNameItems);
});
afterAll(() => off());

beforeEach(() => {
  useConnections.setState({ connections: [PROFILE] });
  useLinks.setState({
    catalogs: { [LINK]: { status: 'ready', catalog: CATALOG, error: null, source: 'engine', loadedAt: 1 } },
    browse: { [LINK]: { ...BROWSE } }, extra: {}, resolved: {},
  });
});

describe('wide member names in a linked console', () => {
  it('`pg.` offers the schemas of the whole database (and the core keeps its default tables)', () => {
    const items = complete('SELECT * FROM pg.|');
    const l = items.map((i) => i.label);
    expect(l).toEqual(expect.arrayContaining(['public', 'sales', 'customers']));
    const sales = items.find((i) => i.label === 'sales')!;
    expect(sales).toMatchObject({ kind: 'schema', insertText: 'sales.', command: 'retrigger' });
  });

  it('`pg.sales.` offers that schema’s tables', () => {
    expect(labels('SELECT * FROM pg.sales.|')).toContain('orders');
    expect(labels('FROM pg.sales.or|')).toContain('orders');
  });

  it('a whole connection: databases, their schemas, their tables; a default-database schema works two-part', () => {
    const dbs = complete('SELECT * FROM ms.|');
    expect(dbs.filter((i) => i.kind === 'database').map((i) => i.label)).toEqual(expect.arrayContaining(['Shop', 'Staging']));
    expect(labels('SELECT * FROM ms.Staging.|')).toContain('dbo');
    expect(labels('SELECT * FROM ms.Staging.dbo.|')).toContain('orders');
    expect(labels('SELECT * FROM ms.Sales.|')).toContain('orders');
    expect(labels('SELECT * FROM ms.Shop.|')).toEqual(expect.arrayContaining(['dbo', 'Sales']));
  });

  it('columns of a table named with three parts, through its alias and its full name', () => {
    const items = complete('SELECT o.| FROM pg.sales.orders o');
    expect(items.map((i) => i.label)).toEqual(expect.arrayContaining(['id', 'total', 'placed_at']));
    expect(items.find((i) => i.label === 'total')?.description).toBe('varchar');
    expect(labels('SELECT pg.sales.orders.| FROM pg.sales.orders')).toContain('placed_at');
  });

  it('a level that is not loaded yet: a Loading row, and the level is read', () => {
    const browse = vi.spyOn(useLinks.getState(), 'browseLevel').mockResolvedValue(null);
    const items = complete('SELECT * FROM ms.Shop.dbo.|');
    expect(items.some((i) => i.loading && /Loading ms\.Shop\.dbo/.test(i.label))).toBe(true);
    expect(browse).toHaveBeenCalledWith(LINK, 'ms', ['Shop', 'dbo']);
  });

  it('a 4-part table the catalog does not have: resolved by engine name (the default database left out)', () => {
    const resolve = vi.spyOn(useLinks.getState(), 'resolveTables').mockResolvedValue();
    const items = complete('SELECT x.| FROM ms.Shop.Sales.orders x');
    expect(items.some((i) => i.loading)).toBe(true);
    expect(resolve).toHaveBeenCalledWith(LINK, [{ alias: 'ms', table: 'Sales.orders' }]);
  });

  it('stays out of normal members and non-link consoles', () => {
    expect(labels('SELECT * FROM crm.|')).not.toContain('Loading crm…');
    useConnections.setState({ connections: [{ ...PROFILE, providerId: 'postgresql' }] });
    expect(labels('SELECT * FROM pg.|')).not.toContain('sales');
  });
});
