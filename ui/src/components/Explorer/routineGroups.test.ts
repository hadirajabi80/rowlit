// Functions folder: routines owned by an extension or a range type (catalog `g`, PostgreSQL) sit in a sub-folder per
// owner instead of between the user's own routines (docs/qa/round-postgresql.md 16).
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogObject, ConnectionProfile } from '../../api/types';
import { dbKey, type ConnCatalog, type DbCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { buildTree, nodeId, type TreeInput } from './tree';

const conn = (id: string): ConnectionProfile => ({
  id, name: id, providerId: 'postgresql', color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
} as ConnectionProfile);

function input(objects: CatalogObject[], expanded: string[]): TreeInput {
  const d: DbCatalog = {
    connectionId: 'c1', database: 'shop', schemasResp: { database: 'shop', defaultSchema: 'public', schemas: [{ name: 'public', loaded: true }] },
    schemasStatus: 'ready', schemasError: null, loaded: { public: { name: 'public', version: 1, objects } }, schemaStatus: { public: 'ready' },
    schemaError: {}, etags: {}, dialect: 'pgsql', defaultSchema: 'public', databasesList: ['shop'], snapshot: null,
  };
  const conns: Record<string, ConnCatalog> = { c1: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null } };
  return {
    connections: [conn('c1')], conns, dbs: { [dbKey('c1', 'shop')]: d },
    expanded: new Set([nodeId.conn('c1'), nodeId.db('c1', 'shop'), ...expanded]), collapsedFolders: new Set(), filter: '',
  };
}

const F = (n: string, g?: string): CatalogObject => ({ t: 'func', n, ...(g ? { g } : {}) });
const FID = nodeId.folder('c1', 'shop', 'public', 'func');

beforeEach(() => {
  useConnections.setState({ connections: [conn('c1')] });
});

describe('Functions folder owner groups', () => {
  const objects = [
    F('add_order'), F('postgres_fdw_handler', 'Extension postgres_fdw'), F('postgres_fdw_validator', 'Extension postgres_fdw'),
    F('floatrange', 'Range type constructors'), F('zz_report'),
  ];

  it('lists the user routines and one collapsed sub-folder per owner', () => {
    const rows = buildTree(input(objects, [FID]));
    const folder = rows.find((r) => r.id === FID)!;
    expect(folder.count).toBe(5);
    const below = rows.slice(rows.indexOf(folder) + 1).filter((r) => r.depth === folder.depth + 1);
    expect(below.map((r) => [r.kind, r.label, r.count])).toEqual([
      ['folder', 'Extension postgres_fdw', 2], ['folder', 'Range type constructors', 1], ['object', 'add_order', undefined], ['object', 'zz_report', undefined],
    ]);
    expect(rows.some((r) => r.label === 'postgres_fdw_handler')).toBe(false);
  });

  it('expanding a sub-folder shows its routines', () => {
    const rows = buildTree(input(objects, [FID, nodeId.routineGroup(FID, 'Extension postgres_fdw')]));
    const sub = rows.find((r) => r.id === nodeId.routineGroup(FID, 'Extension postgres_fdw'))!;
    expect(sub).toMatchObject({ kind: 'folder', expanded: true, objectType: 'func' });
    const inside = rows.filter((r) => r.depth === sub.depth + 1 && r.kind === 'object' && r.object?.g);
    expect(inside.map((r) => r.label)).toEqual(['postgres_fdw_handler', 'postgres_fdw_validator']);
  });

  it('the filter still finds extension routines', () => {
    const rows = buildTree({ ...input(objects, []), filter: 'fdw_hand' });
    expect(rows.some((r) => r.kind === 'object' && r.label === 'postgres_fdw_handler')).toBe(true);
  });
});
