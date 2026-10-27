// Link editor draft (editor/model.ts): alias auto-slugging, table selection and renames, explorer tables added to the
// right member, validation, and the definition / connection input it saves.
import { describe, expect, it } from 'vitest';
import { linkProps, type LinkDefinition } from '../../../api/links';
import type { ConnectionProfile, ProviderId } from '../../../api/types';
import {
  addMembers, addSourceTables, aliasProblem, draftFromProfile, draftSignature, emptyDraft, newMember, renameTable, setAlias, setAllTables, setConnection, setPlace,
  setScope, setTables, toConnectionInput, toDefinition, validateDraft, type LinkDraft,
} from '../editor/model';

const conn = (id: string, name: string, providerId: ProviderId = 'postgresql'): ConnectionProfile => ({
  id, name, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
});
const PG = conn('c_pg', 'Postgres Shop');
const SHOP = conn('c_shop', 'Shop (SQLite)', 'sqlite');
const CONNS = [PG, SHOP, conn('c_link', 'Sales', 'linked')];

function withMember(d: LinkDraft = emptyDraft()) {
  const m = newMember(d);
  return { d: { ...d, name: 'Sales', members: [...d.members, m] }, key: m.key };
}

describe('link draft', () => {
  it('slugs the alias from the connection name, unique among members, until the user types one', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    expect(d.members[0].alias).toBe('postgres_shop');
    const second = withMember(d);
    d = setConnection(second.d, second.key, PG);
    expect(d.members[1].alias).toBe('postgres_shop_2');
    d = setPlace(d, second.key, { schema: 'sales' }, PG);
    expect(d.members[1].alias).toBe('postgres_shop_sales');
    d = setAlias(d, key, 'crm');
    d = setConnection(d, key, SHOP);
    expect(d.members[0].alias).toBe('crm');
  });

  it('explains alias problems', () => {
    expect(aliasProblem('crm', false)).toBeNull();
    expect(aliasProblem('', false)).toMatch(/alias/);
    expect(aliasProblem('Crm', false)).toMatch(/Lower-case/);
    expect(aliasProblem('order', false)).toMatch(/reserved/);
    expect(aliasProblem('main', false)).toMatch(/reserved/);
    expect(aliasProblem('crm', true)).toMatch(/Another source/);
  });

  it('selects tables, renames them and writes the definition', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    d = setPlace(d, key, { database: 'shop', schema: 'public' }, PG);
    d = setTables(d, key, [{ name: 'customers', type: 'table' }, { name: 'orders', type: 'table' }], true);
    d = renameTable(d, key, { name: 'orders', type: 'table' }, 'sales_orders');
    d = setTables(d, key, [{ name: 'customers' }], false);
    const def = toDefinition(d);
    expect(def.members).toEqual([{
      alias: 'postgres_shop', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', scope: 'tables', allTables: false,
      tables: [{ name: 'orders', as: 'sales_orders', type: 'table' }],
    }]);
    // all tables: only renamed tables are listed
    d = setTables(d, key, [{ name: 'customers', type: 'table' }], true);
    d = setAllTables(d, key, true);
    expect(toDefinition(d).members[0]).toMatchObject({ scope: 'schema', allTables: true, tables: [{ name: 'orders', as: 'sales_orders' }] });
  });

  it('validates names, connections, schemas, tables and renames', () => {
    const start = withMember();
    let d: LinkDraft = { ...start.d, name: '' };
    const key = start.key;
    expect(validateDraft(d, CONNS).map((p) => p.field)).toEqual(expect.arrayContaining(['name', 'connection', 'alias']));
    d = { ...setConnection(d, key, PG), name: 'Sales' };
    expect(validateDraft(d, CONNS).map((p) => p.field)).toEqual(['schema']);
    d = setPlace(d, key, { database: 'shop', schema: 'public' }, PG);
    expect(validateDraft(d, CONNS).map((p) => p.field)).toEqual(['tables']);
    d = setTables(d, key, [{ name: 'a' }, { name: 'b' }], true);
    expect(validateDraft(d, CONNS)).toEqual([]);
    d = renameTable(d, key, { name: 'a' }, 'b');
    expect(validateDraft(d, CONNS)).toEqual([expect.objectContaining({ field: 'table', table: 'a' })]);
    d = renameTable(d, key, { name: 'a' }, ' a ');
    expect(validateDraft(d, CONNS)[0].message).toMatch(/not a valid table name/);
    const link = withMember(d);
    const withLink = setConnection(link.d, link.key, CONNS[2]);
    expect(validateDraft(withLink, CONNS).some((p) => p.member === link.key && /cannot be a source/.test(p.message))).toBe(true);
  });

  it('adds explorer tables to the member on the same place, else to a new member', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    d = setPlace(d, key, { database: 'shop', schema: 'public' }, PG);
    const r = addSourceTables(d, [
      { connectionId: 'c_pg', database: 'shop', schema: 'public', name: 'customers', type: 'table' },
      { connectionId: 'c_shop', database: null, schema: 'main', name: 'orders', type: 'table' },
      { connectionId: 'c_link', database: null, schema: 'crm', name: 'x', type: 'table' },
    ], CONNS);
    expect(r.draft.members).toHaveLength(2);
    expect(r.draft.members[0].tables.map((t) => t.name)).toEqual(['customers']);
    expect(r.draft.members[1]).toMatchObject({ connectionId: 'c_shop', schema: 'main', alias: 'shop_sqlite', tables: [{ name: 'orders' }] });
    expect(r.select).toBe(r.draft.members[1].key);
  });

  it('keeps relations, options, unknown fields and other props of an edited link', () => {
    const def: LinkDefinition = {
      version: 1,
      members: [{ alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers', options: { x: 1 } }], label: 'CRM' }],
      relations: [{ id: 'r1', from: { alias: 'crm', table: 'customers' }, fromColumns: ['id'], to: { alias: 'crm', table: 'customers' }, toColumns: ['id'] }],
      options: { maxRowsPerSource: 10 },
    };
    const p = { ...conn('c_link', 'Sales', 'linked'), color: '#2563eb', folder: 'Linked databases', props: { ...linkProps(def), note: 'keep me' } };
    const d = draftFromProfile(p, 'edit');
    const input = toConnectionInput(d);
    expect(input).toMatchObject({ name: 'Sales', providerId: 'linked', readOnly: true, color: '#2563eb', folder: 'Linked databases', password: null, savePassword: false });
    expect(input.props).toEqual({ ...linkProps(def), note: 'keep me' });
    expect(draftFromProfile(p, 'duplicate').name).toBe('Sales (copy)');
    expect(draftSignature(draftFromProfile(p, 'edit'))).toBe(draftSignature(d));
  });
});

describe('member scopes', () => {
  const MY = conn('c_my', 'Shop MySQL', 'mysql');
  const MONGO = conn('c_mongo', 'Docs', 'mongodb');
  const ALL = [...CONNS, MY, MONGO];

  it('migrates stored members: allTables → schema, else tables; a scope wins; files stay tables', () => {
    const p = {
      ...conn('c_link', 'Old', 'linked'),
      props: {
        linkVersion: 1, relations: [], options: {},
        members: [
          { alias: 'a', connectionId: 'c_pg', schema: 'public', allTables: true, tables: [] },
          { alias: 'b', connectionId: 'c_pg', schema: 'public', tables: [{ name: 'x' }] },
          { alias: 'c', connectionId: 'c_pg', database: 'shop', scope: 'database', allTables: false, tables: [] },
          { alias: 'f', kind: 'files', tables: [{ name: 'a.csv' }] },
        ],
      },
    };
    const d = draftFromProfile(p, 'edit');
    expect(d.members.map((m) => m.scope)).toEqual(['schema', 'tables', 'database', 'tables']);
    const def = toDefinition(d);
    expect(def.version).toBe(2);
    expect(def.members.map((m) => [m.scope, m.allTables])).toEqual([['schema', true], ['tables', false], ['database', true], [undefined, false]]);
    expect(linkProps(def).linkVersion).toBe(2);
  });

  it('writes only the place a scope uses (whole database: no schema; whole connection: neither)', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    d = setPlace(d, key, { database: 'shop', schema: 'public' }, PG);
    d = setScope(d, key, 'database');
    expect(toDefinition(d).members[0]).toMatchObject({ scope: 'database', database: 'shop', schema: null, allTables: true, tables: [] });
    d = setScope(d, key, 'connection');
    expect(toDefinition(d).members[0]).toMatchObject({ scope: 'connection', database: null, schema: null, allTables: true });
    // the draft keeps the place: back to tables, the schema is there again
    d = setScope(d, key, 'tables');
    expect(d.members[0]).toMatchObject({ database: 'shop', schema: 'public' });
    // MySQL: the whole database is the member's schema (its database level)
    const my = withMember();
    let m = setConnection(my.d, my.key, { ...MY, providerId: 'mysql' });
    m = setPlace(m, my.key, { schema: 'shop' }, MY);
    m = setScope(m, my.key, 'database');
    expect(toDefinition(m).members[0]).toMatchObject({ scope: 'database', database: null, schema: 'shop' });
  });

  it('validates per scope: schema for tables / schema, tables only for tables, a database for a whole database', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    d = setScope(d, key, 'connection');
    expect(validateDraft(d, ALL)).toEqual([]);
    d = setScope(d, key, 'database');
    expect(validateDraft(d, ALL).map((p) => p.field)).toEqual(['database']);
    d = setPlace(d, key, { database: 'shop' }, PG);
    expect(validateDraft(d, ALL)).toEqual([]);
    d = setScope(d, key, 'schema');
    expect(validateDraft(d, ALL).map((p) => p.field)).toEqual(['schema']);
    d = setPlace(d, key, { schema: 'public' }, PG);
    expect(validateDraft(d, ALL)).toEqual([]);
    d = setScope(d, key, 'tables');
    expect(validateDraft(d, ALL).map((p) => p.field)).toEqual(['tables']);
    // MongoDB offers whole database / whole connection only and starts with the database
    const mg = withMember();
    const md = setConnection(mg.d, mg.key, { ...MONGO, providerId: 'mongodb' });
    expect(md.members[0].scope).toBe('database');
    expect(validateDraft(md, ALL).map((p) => p.field)).toEqual(['schema']);
    expect(validateDraft(setScope(md, mg.key, 'tables'), ALL).map((p) => p.field)).toContain('scope');
  });

  it('explorer tables a wide member already spans are not added again', () => {
    let { d, key } = withMember();
    d = setConnection(d, key, PG);
    d = setScope(setPlace(d, key, { database: 'shop' }, PG), key, 'database');
    const r = addSourceTables(d, [{ connectionId: 'c_pg', database: 'shop', schema: 'sales', name: 'orders', type: 'table' }], CONNS);
    expect(r.draft.members).toHaveLength(1);
    expect(r.select).toBe(key);
    const other = addSourceTables(d, [{ connectionId: 'c_pg', database: 'analytics', schema: 'public', name: 'events', type: 'table' }], CONNS);
    expect(other.draft.members).toHaveLength(2);
  });
});

describe('ready-made members (links.new { members })', () => {
  it('adds them as they are, renaming an alias that is already taken', () => {
    const { d } = withMember();
    const taken = setAlias(d, d.members[0].key, 'crm');
    const r = addMembers(taken, [
      { alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers', type: 'table' }] },
    ]);
    expect(r.draft.members).toHaveLength(2);
    expect(r.draft.members[1]).toMatchObject({ alias: 'crm_2', connectionId: 'c_pg', schema: 'public', tables: [{ name: 'customers', as: '', type: 'table' }] });
    expect(r.select).toBe(r.draft.members[1].key);
    expect(toDefinition({ ...r.draft, members: [r.draft.members[1]] }).members[0]).toMatchObject({ alias: 'crm_2', tables: [{ name: 'customers' }] });
  });
});
