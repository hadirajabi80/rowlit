// Materialize / Add to link / native link: the pure rules.
import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../../api/types';
import type { LinkDefinition } from '../../../api/links';
import { addTableToDefinition, aliasProposal, initialMember, profileInput, type TableSource } from './addToLink';
import { buildRequest, defaultTableName, hasSource, progressPercent, readEnd, readProgress, stripTrailingSemicolon, tableNameIssue } from './model';
import { connectionMembers, kindLabel, nativeTargets, scriptParts } from '../native/model';

describe('table name rules', () => {
  it('requires a plain name', () => {
    expect(tableNameIssue('', 'create', null)).toMatch(/Enter the name/);
    expect(tableNameIssue(' x', 'create', null)).toMatch(/space/);
    expect(tableNameIssue('x'.repeat(129), 'create', null)).toMatch(/longer than 128/);
    expect(tableNameIssue('a\nb', 'create', null)).toMatch(/control/);
    expect(tableNameIssue('Order totals', 'create', null)).toBeNull();
  });

  it('create refuses a taken name, append needs an existing table, replace takes either', () => {
    expect(tableNameIssue('t', 'create', true)).toMatch(/already exists/);
    expect(tableNameIssue('t', 'create', false)).toBeNull();
    expect(tableNameIssue('t', 'append', false)).toMatch(/no table named "t"/);
    expect(tableNameIssue('t', 'append', true)).toBeNull();
    expect(tableNameIssue('t', 'append', null)).toBeNull();
    expect(tableNameIssue('t', 'replace', true)).toBeNull();
    expect(tableNameIssue('t', 'replace', false)).toBeNull();
  });
});

describe('default table name', () => {
  it('comes from the view name, else the first alias.table, else a generic name', () => {
    expect(defaultTableName({ name: 'Top customers 2024' })).toBe('top_customers_2024');
    expect(defaultTableName({ name: '2024 sales' })).toBe('v_2024_sales');
    expect(defaultTableName({ sql: 'SELECT * FROM crm.customers c JOIN shop.orders o ON 1=1' })).toBe('customers_materialized');
    expect(defaultTableName({ sql: 'SELECT * FROM "crm"."Order Lines"' })).toBe('order_lines_materialized');
    expect(defaultTableName({ sql: 'SELECT 1' })).toBe('query_result');
  });
});

describe('engine request', () => {
  it('sends the SQL without the trailing semicolon, or the view id', () => {
    const t = { connectionId: 'pg', database: 'shop', schema: 'public', table: 't', mode: 'create' as const };
    expect(buildRequest({ connectionId: 'link', sql: 'SELECT 1;\n' }, t)).toEqual({
      sql: 'SELECT 1', targetConnectionId: 'pg', database: 'shop', schema: 'public', table: 't', mode: 'create',
    });
    expect(buildRequest({ connectionId: 'link', viewId: 'v1', sql: 'ignored', sessionId: 's1', params: [{ name: 'p', type: 'string', value: 'x' } as never] }, { ...t, database: null, mode: 'append' })).toEqual({
      viewId: 'v1', params: [{ name: 'p', type: 'string', value: 'x' }], targetConnectionId: 'pg', database: null, schema: 'public', table: 't', mode: 'append', sessionId: 's1',
    });
    expect(stripTrailingSemicolon('select 1 ;; ')).toBe('select 1');
    expect(hasSource({ sql: ' ; ' })).toBe(false);
    expect(hasSource({ viewId: 'v' })).toBe(true);
  });
});

describe('job events', () => {
  it('reads rows, total and phase from the progress event (plain or JSON message)', () => {
    expect(readProgress({ done: 500, total: 2000, message: 'Writing' })).toEqual({ rows: 500, total: 2000, message: 'Writing' });
    expect(readProgress({ done: 5, total: null, message: null })).toEqual({ rows: 5, total: null, message: null });
    expect(readProgress({ done: 0, total: 0, message: '{"rows":1200,"total":4800,"phase":"Loading"}' })).toEqual({ rows: 1200, total: 4800, message: 'Loading' });
    expect(readProgress({ done: 0, total: null, message: '{oops' }).message).toBe('{oops');
    expect(progressPercent({ rows: 25, total: 100, message: null })).toBe(25);
    expect(progressPercent({ rows: 25, total: null, message: null })).toBeNull();
    expect(progressPercent(null)).toBeNull();
  });

  it('reads the job result', () => {
    const r = readEnd({ status: 'ok', error: null, result: { targetConnectionId: 'pg', schema: 'public', table: 't', rows: 7, elapsedMs: 40 } });
    expect(r.result).toMatchObject({ table: 't', rows: 7, elapsedMs: 40, warnings: [] });
    expect(readEnd({ status: 'error', error: 'boom', result: null })).toEqual({ status: 'error', error: 'boom', result: null });
  });
});

const def = (): LinkDefinition => ({
  version: 1, relations: [], options: {},
  members: [{ alias: 'shop', kind: 'connection', connectionId: 'c_shop', schema: 'main', allTables: false, tables: [{ name: 'orders', type: 'table' }] }],
});
const src = (over: Partial<TableSource> = {}): TableSource => ({ connectionId: 'c_shop', database: null, schema: 'main', name: 'customers', type: 'table', ...over });

describe('add to link', () => {
  it('adds the table to the member of its connection and schema', () => {
    const r = addTableToDefinition(def(), src(), 'Shop');
    expect(r).toMatchObject({ alias: 'shop', table: 'customers', already: false, newMember: false });
    expect(r.definition.members).toHaveLength(1);
    expect(r.definition.members[0].tables.map((t) => t.name)).toEqual(['orders', 'customers']);
  });

  it('does nothing when the table is mounted (explicitly or through allTables)', () => {
    expect(addTableToDefinition(def(), src({ name: 'orders' }), 'Shop')).toMatchObject({ already: true, alias: 'shop' });
    const all = def();
    all.members[0].allTables = true;
    const r = addTableToDefinition(all, src({ name: 'anything' }), 'Shop');
    expect(r.already).toBe(true);
    expect(r.definition).toBe(all);
  });

  it('creates a member with a unique alias for another connection or schema', () => {
    const r = addTableToDefinition(def(), src({ connectionId: 'c_pg', database: 'shop', schema: 'public', name: 'customers' }), 'Postgres Shop');
    expect(r.newMember).toBe(true);
    expect(r.alias).toBe('postgres_shop');
    expect(r.definition.members[1]).toMatchObject({ connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers', type: 'table' }] });
    // the same connection, another schema: the schema is part of the alias
    expect(addTableToDefinition(def(), src({ schema: 'archive' }), 'Shop').alias).toBe('shop_archive');
    // and a clash gets a numeric suffix
    const twice = addTableToDefinition(r.definition, src({ connectionId: 'c_pg2', schema: 'public' }), 'Postgres Shop');
    expect(twice.alias).toBe('postgres_shop_2');
  });

  it('proposes aliases from the schema unless it is a default one', () => {
    expect(aliasProposal(src({ schema: 'dbo' }), 'SQL Server 2022')).toBe('sql_server_2022');
    expect(aliasProposal(src({ schema: 'Sales' }), 'ERP')).toBe('erp_sales');
    expect(aliasProposal(src({ schema: null }), '!!!')).toBe('db');
  });

  it('builds the member of a new link and the profile that is saved back', () => {
    expect(initialMember(src(), 'Shop')).toMatchObject({ alias: 'shop', connectionId: 'c_shop', tables: [{ name: 'customers' }] });
    const profile = { id: 'l', name: 'Link', providerId: 'linked', color: null, folder: 'Linked databases', readOnly: true, props: { extra: 1 }, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null } as ConnectionProfile;
    const input = profileInput(profile, addTableToDefinition(def(), src(), 'Shop').definition);
    expect(input).toMatchObject({ name: 'Link', providerId: 'linked', readOnly: true, password: null });
    expect(input.props.extra).toBe(1);
    expect((input.props.members as unknown[]).length).toBe(1);
  });
});

describe('native link helpers', () => {
  const conn = (id: string, providerId: string) => ({ id, name: id, providerId }) as ConnectionProfile;

  it('offers servers that can host a native link, never the member itself', () => {
    const list = [conn('ms', 'sqlserver'), conn('pg', 'postgresql'), conn('lite', 'sqlite'), conn('link', 'linked'), conn('redis', 'redis'), conn('my', 'mysql')];
    expect(nativeTargets(list, { alias: 'a', connectionId: 'pg', tables: [] }).map((c) => c.id)).toEqual(['ms', 'my']);
    expect(nativeTargets(list, undefined).map((c) => c.id)).toEqual(['ms', 'pg', 'my']);
  });

  it('lists the members that live in a database server', () => {
    const profile = { props: { members: [{ alias: 'a', kind: 'connection', connectionId: 'x', tables: [] }, { alias: 'f', kind: 'files', tables: [] }, { alias: 'b', connectionId: 'y', tables: [] }] } };
    expect(connectionMembers(profile).map((m) => m.alias)).toEqual(['a', 'b']);
    expect(connectionMembers(undefined)).toEqual([]);
  });

  it('splits a script at its placeholders, longest first, keeping every character', () => {
    const script = "CREATE USER MAPPING FOR CURRENT_USER SERVER s OPTIONS (user '<user>', password '<password>');\n-- <password> again";
    const parts = scriptParts(script, ['<password>', '<user>', '<password>']);
    expect(parts.map((p) => p.text).join('')).toBe(script);
    expect(parts.filter((p) => p.placeholder).map((p) => p.text)).toEqual(['<user>', '<password>', '<password>']);
    expect(scriptParts('SELECT 1', [])).toEqual([{ text: 'SELECT 1', placeholder: false }]);
  });

  it('names the kinds', () => {
    expect(kindLabel('fdw')).toMatch(/foreign data wrapper/i);
    expect(kindLabel('something')).toBe('something');
  });
});
