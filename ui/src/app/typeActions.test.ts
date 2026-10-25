// Drop… on user-defined types: the statement per kind, the usage warning, Script as CREATE, and the New type… targets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ObjectDetails, ObjectRef } from '../api/types';
import { initCommands } from '../commands';
import { isEnabled } from '../commands/registry';
import { containerTypeKind, openNewType } from '../designer/open';
import { dbKey, useCatalog, type DbCatalog } from '../store/catalog';
import { useConnections } from '../store/connections';
import { useTabs } from '../store/tabs';
import { useUi } from '../store/ui';
import { installMockEngine } from '../test/mockServer';
import { catalogDatabase } from './actions';
import { canDrop, catalogTypeKind, dropObject, dropSql, scriptCreate } from './objectActions';

installMockEngine({ frameDelay: 0 });

const phone: ObjectRef = { database: null, schema: 'dbo', name: 'Phone', type: 'type' };

function seedCatalog(cid: string, schema: string, objects: DbCatalog['loaded'][string]['objects']) {
  const key = dbKey(cid, catalogDatabase(cid, null));
  useCatalog.setState({ dbs: { [key]: { loaded: { [schema]: { name: schema, version: 1, objects } }, defaultSchema: schema } as unknown as DbCatalog } });
}

function details(usedBy: NonNullable<ObjectDetails['typeInfo']>['usedBy']): ObjectDetails {
  return {
    ref: phone, columns: [], indexes: [], foreignKeys: [], referencedBy: [], triggers: [], parameters: [], rowCountEstimate: null, created: null, modified: null,
    typeInfo: { kind: 'alias', properties: [], itemsTitle: null, items: [], usedBy },
  };
}

beforeEach(async () => {
  await initCommands();
  await useConnections.getState().load();
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  seedCatalog('c_prod', 'dbo', [
    { t: 'type', n: 'Phone', k: 'alias' }, { t: 'type', n: 'PhoneList', k: 'table' }, { t: 'type', n: 'NoteSchema', k: 'xmlschema' },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Drop… for types', () => {
  it('is offered for types on SQL Server now, with the statement of the kind', () => {
    expect(canDrop('type', 'tsql')).toBe(true);
    expect(canDrop('type', 'pgsql')).toBe(true);
    expect(dropSql(phone, 'tsql')).toBe('DROP TYPE dbo.Phone'); // no kind known: the generic statement
    expect(dropSql(phone, 'tsql', 'alias')).toBe('DROP TYPE dbo.Phone');
    expect(dropSql({ ...phone, name: 'NoteSchema' }, 'tsql', 'xmlschema')).toBe('DROP XML SCHEMA COLLECTION dbo.NoteSchema');
    expect(dropSql({ ...phone, schema: 'public', name: 'positive_int' }, 'pgsql', 'domain')).toBe('DROP DOMAIN public.positive_int');
    expect(dropSql({ ...phone, schema: 'SHOP', name: 'ADDRESS_T' }, 'plsql', 'object')).toBe('DROP TYPE SHOP.ADDRESS_T');
  });

  it('reads the kind of a type from the loaded catalog', () => {
    expect(catalogTypeKind('c_prod', null, phone)).toBe('alias');
    expect(catalogTypeKind('c_prod', null, { ...phone, name: 'NoteSchema' })).toBe('xmlschema');
    expect(catalogTypeKind('c_prod', null, { ...phone, name: 'Missing' })).toBeNull();
    expect(catalogTypeKind('c_prod', null, { ...phone, type: 'table' })).toBeNull();
  });

  it('asks with the exact statement and warns about the objects still using the type', async () => {
    vi.spyOn(api, 'objectDetails').mockResolvedValue(details([
      { schema: 'dbo', name: 'SavePhones', type: 'proc', usage: 'parameter @Fallback' },
      { schema: 'dbo', name: 'PhoneList', type: 'type', usage: 'column Number' },
    ]));
    const ask = vi.fn().mockResolvedValue(false);
    useUi.setState({ askConfirm: ask });
    await dropObject('c_prod', null, phone);
    expect(ask).toHaveBeenCalledTimes(1);
    const req = ask.mock.calls[0][0];
    expect(req).toMatchObject({ title: 'Drop Phone?', items: ['DROP TYPE dbo.Phone'], danger: true, confirmLabel: 'Drop' });
    expect(req.message).toContain('still used by 2 objects (dbo.SavePhones, dbo.PhoneList)');
  });

  it('has no usage warning for an unused type and survives a details failure', async () => {
    const ask = vi.fn().mockResolvedValue(false);
    useUi.setState({ askConfirm: ask });
    vi.spyOn(api, 'objectDetails').mockResolvedValueOnce(details([]));
    await dropObject('c_prod', null, phone);
    expect(ask.mock.calls[0][0].message).not.toContain('still used');
    vi.spyOn(api, 'objectDetails').mockRejectedValueOnce(new Error('boom'));
    await dropObject('c_prod', null, { ...phone, name: 'PhoneList' });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0].items).toEqual(['DROP TYPE dbo.PhoneList']);
  });

  it('truncates a long list of users', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ schema: 'dbo', name: `P${i}`, type: 'proc' as const, usage: 'parameter @x' }));
    vi.spyOn(api, 'objectDetails').mockResolvedValue(details(many));
    const ask = vi.fn().mockResolvedValue(false);
    useUi.setState({ askConfirm: ask });
    await dropObject('c_prod', null, phone);
    expect(ask.mock.calls[0][0].message).toContain('still used by 8 objects (dbo.P0, dbo.P1, dbo.P2, dbo.P3, dbo.P4, and 3 more)');
  });
});

describe('Script as CREATE and New type…', () => {
  it('Script as CREATE opens the definition in a console of the connection', async () => {
    vi.spyOn(api, 'ddl').mockResolvedValue({ ddl: 'CREATE TYPE [dbo].[Phone] FROM nvarchar(20) NOT NULL;\n', source: 'generated' });
    await scriptCreate('c_prod', null, phone);
    const tab = useTabs.getState().tabs.find((t) => t.kind === 'console');
    expect(tab && 'text' in tab ? tab.text : '').toContain('CREATE TYPE [dbo].[Phone]');
  });

  it('New type… starts from the kind of the folder or of the type it was invoked on', () => {
    expect(containerTypeKind({ kind: 'container', connectionId: 'c_prod', database: null, schema: 'dbo', objectType: 'type', typeKind: 'table' })).toBe('table');
    expect(containerTypeKind({ kind: 'container', connectionId: 'c_prod', database: null, schema: 'dbo', objectType: 'table', typeKind: 'table' })).toBeNull();
    expect(containerTypeKind({ kind: 'container', connectionId: 'c_prod', database: null, schema: 'dbo' })).toBeNull();
    expect(containerTypeKind({ kind: 'object', connectionId: 'c_prod', database: null, ref: { ...phone, name: 'PhoneList' } })).toBe('table');
  });

  it('opens a console with the template', () => {
    const id = openNewType({ connectionId: 'c_prod', database: null, schema: 'dbo', dialect: 'tsql' }, 'table');
    expect(id).toBeTruthy();
    const tab = useTabs.getState().tabs.find((t) => t.id === id);
    expect(tab && 'text' in tab ? tab.text : '').toContain('CREATE TYPE dbo.NewTableType AS TABLE');
    expect(tab?.title).toBe('New type');
    expect(openNewType({ connectionId: 'c_prod', database: null, schema: 'dbo', dialect: 'sqlite' }, null)).toBeNull();
  });

  it('the commands exist: New type… everywhere with types, New table type… on SQL Server only', () => {
    expect(isEnabled('designer.newType', { kind: 'container', connectionId: 'c_prod', database: null, schema: 'dbo' })).toBe(true);
    expect(isEnabled('designer.newTableType', { kind: 'container', connectionId: 'c_prod', database: null, schema: 'dbo' })).toBe(true);
    expect(isEnabled('designer.newType', { kind: 'container', connectionId: 'c_pg', database: null, schema: 'public' })).toBe(true);
    expect(isEnabled('designer.newTableType', { kind: 'container', connectionId: 'c_pg', database: null, schema: 'public' })).toBe(false);
    expect(isEnabled('designer.newType', { kind: 'container', connectionId: 'c_shop', database: null, schema: 'main' })).toBe(false); // SQLite
    expect(isEnabled('explorer.scriptCreate', { kind: 'object', connectionId: 'c_prod', database: null, ref: phone })).toBe(true);
  });
});
