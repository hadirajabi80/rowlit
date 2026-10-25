// Types folder (SSMS Programmability › Types): kind sub-folders, counts, kind icons data, and SQL Server's System Data Types group.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogObject, ConnectionProfile, SystemTypeInfo } from '../../api/types';
import { dbKey, type ConnCatalog, type DbCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import type { SystemTypesEntry } from '../../store/systemTypes';
import { buildTree, nodeId, parseSystemTypesId, typesOfChips, type TreeInput } from './tree';

const conn = (id: string, providerId: string): ConnectionProfile => ({
  id, name: id, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
} as ConnectionProfile);

const T = (n: string, k: string | undefined, bt?: string): CatalogObject => ({ t: 'type', n, ...(k ? { k } : {}), ...(bt ? { bt } : {}) });
const TT: CatalogObject = { ...T('PhoneList', 'table', 'table (2 columns)'), c: [['Ordinal', 'int', 0, 0, 0, null], ['Number', 'dbo.Phone', 1, 0, 0, null]] };

function sys(name: string, category: string, maxLength: number | null = null, precision: number | null = null): SystemTypeInfo {
  return { name, category, maxLength, precision, scale: null, collation: null, nullable: true };
}

function input(objects: CatalogObject[], over: Partial<TreeInput> = {}, providerId = 'sqlserver'): TreeInput {
  const dialect = providerId === 'postgresql' ? 'pgsql' : providerId === 'oracle' ? 'plsql' : 'tsql';
  const d: DbCatalog = {
    connectionId: 'c1', database: 'Shop', schemasResp: { database: 'Shop', defaultSchema: 'dbo', schemas: [{ name: 'dbo', loaded: true }] },
    schemasStatus: 'ready', schemasError: null, loaded: { dbo: { name: 'dbo', version: 1, objects } }, schemaStatus: { dbo: 'ready' },
    schemaError: {}, etags: {}, dialect, defaultSchema: 'dbo', databasesList: ['Shop'], snapshot: null,
  };
  const conns: Record<string, ConnCatalog> = { c1: { databases: { databases: ['Shop'], current: 'Shop' }, status: 'ready', error: null } };
  return {
    connections: [conn('c1', providerId)], conns, dbs: { [dbKey('c1', 'Shop')]: d }, expanded: new Set([nodeId.conn('c1'), nodeId.db('c1', 'Shop')]),
    collapsedFolders: new Set(), filter: '', ...over,
  };
}

const FID = nodeId.folder('c1', 'Shop', 'dbo', 'type');
const opened = (...ids: string[]) => new Set([nodeId.conn('c1'), nodeId.db('c1', 'Shop'), FID, ...ids]);
const shape = (rows: ReturnType<typeof buildTree>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.kind}:${r.label}${r.count !== undefined ? ` (${r.count})` : ''}`);

beforeEach(() => {
  useConnections.setState({ connections: [conn('c1', 'sqlserver')] });
});

describe('Types folder', () => {
  const objects = [T('Phone', 'alias', 'nvarchar(20) not null'), T('Zip', 'alias'), TT, T('NoteSchema', 'xmlschema', 'xml schema collection')];

  it('groups the types of a schema by kind in SSMS order, with counts', () => {
    const rows = buildTree(input(objects, { expanded: opened() }));
    const types = rows.find((r) => r.id === FID)!;
    expect(types).toMatchObject({ kind: 'folder', label: 'Types', count: 4, objectType: 'type' });
    const subs = rows.filter((r) => r.kind === 'folder' && r.typeKind);
    expect(subs.map((r) => [r.label, r.count, r.typeKind])).toEqual([
      ['User-Defined Data Types', 2, 'alias'], ['User-Defined Table Types', 1, 'table'], ['XML Schema Collections', 1, 'xmlschema'],
    ]);
    expect(subs.every((r) => r.depth === types.depth + 1 && r.expandable && !r.expanded && r.objectType === 'type')).toBe(true);
    expect(rows.some((r) => r.kind === 'object')).toBe(false); // sub-folders start collapsed
  });

  it('expanding a sub-folder lists its types with their kind and definition summary', () => {
    const rows = buildTree(input(objects, { expanded: opened(nodeId.typeKind(FID, 'alias'), nodeId.typeKind(FID, 'table')) }));
    const objs = rows.filter((r) => r.kind === 'object');
    expect(objs.map((r) => [r.label, r.typeKind, r.detail])).toEqual([
      ['Phone', 'alias', 'nvarchar(20) not null'], ['Zip', 'alias', undefined], ['PhoneList', 'table', 'table (2 columns)'],
    ]);
    const sub = rows.find((r) => r.id === nodeId.typeKind(FID, 'alias'))!;
    expect(objs[0].depth).toBe(sub.depth + 1);
    // a table type has columns to expand like a table
    const list = rows.find((r) => r.label === 'PhoneList')!;
    expect(list.expandable).toBe(true);
  });

  it('a single kind stays flat (no sub-folder)', () => {
    const rows = buildTree(input([T('Phone', 'alias'), T('Zip', 'alias')], { expanded: opened() }));
    expect(shape(rows).filter((s) => /folder:|object:/.test(s))).toEqual(['    folder:Types (2)', '      object:Phone', '      object:Zip']);
    expect(rows.filter((r) => r.kind === 'folder' && r.typeKind)).toEqual([]);
    expect(rows.filter((r) => r.kind === 'object').map((r) => r.label)).toEqual(['Phone', 'Zip']);
  });

  it('types of a provider that reports no kind (ClickHouse dictionaries) stay flat', () => {
    const rows = buildTree(input([T('dict_a', undefined), T('dict_b', undefined)], { expanded: opened() }));
    expect(rows.filter((r) => r.kind === 'folder' && r.typeKind)).toEqual([]);
    expect(rows.filter((r) => r.kind === 'object')).toHaveLength(2);
  });

  it('PostgreSQL kinds: enums, domains, composites and ranges', () => {
    useConnections.setState({ connections: [conn('c1', 'postgresql')] });
    const pg = [T('order_status', 'enum', '4 labels'), T('email_address', 'domain', 'text'), T('address', 'composite', '3 attributes'), T('price_range', 'range', 'numeric')];
    const rows = buildTree(input(pg, { expanded: opened() }, 'postgresql'));
    expect(rows.filter((r) => r.typeKind).map((r) => r.label)).toEqual(['Enums', 'Domains', 'Composite Types', 'Range Types']);
  });

  it('the type chips hide or show the folder as before (Other)', () => {
    const hidden = buildTree(input(objects, { typesFor: () => typesOfChips(['tables']) }));
    expect(hidden.some((r) => r.label === 'Types')).toBe(false);
    const shown = buildTree(input(objects, { typesFor: () => typesOfChips(['other']) }));
    expect(shown.some((r) => r.label === 'Types')).toBe(true);
  });

  it('filtering finds a type by name with its kind (flat, under its schema)', () => {
    const rows = buildTree(input(objects, { filter: 'phone' }));
    const found = rows.filter((r) => r.kind === 'object');
    expect(found.map((r) => [r.label, r.typeKind])).toEqual(expect.arrayContaining([['Phone', 'alias'], ['PhoneList', 'table']]));
  });
});

describe('System Data Types', () => {
  const ready = (types: SystemTypeInfo[]): Record<string, SystemTypesEntry> => ({ [dbKey('c1', 'Shop')]: { status: 'ready', types } });
  const SYS = nodeId.systemTypes('c1', 'Shop');
  const types = [
    sys('varchar', 'Character strings', 8000), sys('int', 'Exact numerics', 4, 10), sys('bigint', 'Exact numerics', 8, 19), sys('xml', 'Other data types', -1),
  ];

  it('is a collapsed group after the schemas of a SQL Server database', () => {
    const rows = buildTree(input([T('Phone', 'alias')], { systemTypes: ready(types) }));
    const group = rows.find((r) => r.id === SYS)!;
    expect(group).toMatchObject({ kind: 'sfolder', label: 'System Data Types', expandable: true, expanded: false, count: 4 });
    expect(rows.indexOf(group)).toBe(rows.length - 1);
    expect(rows.some((r) => r.kind === 'sfolder' && r.label !== 'System Data Types')).toBe(false);
  });

  it('groups the built-in types by category in SSMS order; the types are read-only leaves', () => {
    const cat = nodeId.systemCategory(SYS, 'Exact numerics');
    const rows = buildTree(input([T('Phone', 'alias')], { systemTypes: ready(types), expanded: new Set([...opened(), SYS, cat]) }));
    const sys0 = rows.findIndex((r) => r.id === SYS);
    expect(rows.slice(sys0).map((r) => `${r.kind}:${r.label}`)).toEqual([
      'sfolder:System Data Types', 'sfolder:Exact numerics', 'sysType:int', 'sysType:bigint', 'sfolder:Character strings', 'sfolder:Other data types',
    ]);
    const leaf = rows.find((r) => r.label === 'int')!;
    expect(leaf).toMatchObject({ expandable: false, detail: '4 bytes', depth: rows[sys0].depth + 2 });
    expect(leaf.sysType?.name).toBe('int');
    expect(rows.find((r) => r.label === 'Exact numerics')?.count).toBe(2);
  });

  it('shows loading and error rows while the list is not there', () => {
    const open = new Set([...opened(), SYS]);
    const loading = buildTree(input([], { expanded: open, systemTypes: { [dbKey('c1', 'Shop')]: { status: 'loading', types: [] } } }));
    expect(loading.find((r) => r.status === 'loading' && r.depth > rows0(loading))?.label).toBe('Loading data types…');
    const failed = buildTree(input([], { expanded: open, systemTypes: { [dbKey('c1', 'Shop')]: { status: 'error', types: [], error: 'denied' } } }));
    expect(failed.find((r) => r.status === 'error')?.label).toBe('denied');
    const missing = buildTree(input([], { expanded: open, systemTypes: {} }));
    expect(missing.find((r) => r.status === 'loading')?.label).toBe('Loading data types…');
  });

  it('only for SQL Server, only when asked for, and not when the chips exclude types', () => {
    expect(buildTree(input([T('Phone', 'alias')])).some((r) => r.kind === 'sfolder')).toBe(false); // no systemTypes input
    useConnections.setState({ connections: [conn('c1', 'postgresql')] });
    expect(buildTree(input([T('Phone', 'alias')], { systemTypes: ready(types) }, 'postgresql')).some((r) => r.kind === 'sfolder')).toBe(false);
    useConnections.setState({ connections: [conn('c1', 'sqlserver')] });
    expect(buildTree(input([], { systemTypes: ready(types), typesFor: () => typesOfChips(['views']) })).some((r) => r.kind === 'sfolder')).toBe(false);
    expect(buildTree(input([], { systemTypes: ready(types), typesFor: () => typesOfChips(['other']) })).some((r) => r.kind === 'sfolder')).toBe(true);
  });

  it('parses the group id back to its connection and database', () => {
    expect(parseSystemTypesId(nodeId.systemTypes('c1', 'Shop'))).toEqual({ connectionId: 'c1', database: 'Shop' });
    expect(parseSystemTypesId(nodeId.systemTypes('c1', null))).toEqual({ connectionId: 'c1', database: null });
    expect(parseSystemTypesId(nodeId.systemCategory(nodeId.systemTypes('c1', 'Shop'), 'Exact numerics'))).toBeNull();
    expect(parseSystemTypesId(nodeId.folder('c1', 'Shop', 'dbo', 'type'))).toBeNull();
  });
});

function rows0(rows: ReturnType<typeof buildTree>): number {
  return rows.find((r) => r.kind === 'sfolder')!.depth;
}
