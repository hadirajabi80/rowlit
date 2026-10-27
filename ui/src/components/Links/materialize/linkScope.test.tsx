// "Link database…" / "Link schema…": which explorer nodes they apply to (database / schema rows of relational
// connections, MongoDB databases), the member they build, the menus they join, and the dialog's three answers (new link,
// add to an existing link, already covered) against the MSW mock engine.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkDefinitionOf, linkProps, type LinkDefinition } from '../../../api/links';
import { contextMenuEntries } from '../../../commands/menuModel';
import { isEnabled, registerCommand } from '../../../commands/registry';
import type { ContainerTarget, SourceTarget } from '../../../commands/types';
import { linkedConnections } from '../../../mocks/packs/linked';
import { useConnections } from '../../../store/connections';
import { useUi } from '../../../store/ui';
import { installMockEngine } from '../../../test/mockServer';
import { registerMaterializeCommands } from './commands';
import { addScopeToDefinition, coveringMember, scopeMember, scopeSourceOf } from './linkScope';
import { LinkScopeDialog } from './LinkScopeDialog';

const mock = installMockEngine();

const container = (connectionId: string, database: string | null, schema: string | null, extra: Partial<ContainerTarget> = {}): ContainerTarget =>
  ({ kind: 'container', connectionId, database, schema, ...extra });
const mongoDb = (db: string): SourceTarget => ({ kind: 'source', connectionId: 'c_mongo', providerId: 'mongodb', nodeType: 'database', path: [db] });

beforeEach(async () => {
  mock.reset();
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  await useConnections.getState().load();
  const have = new Set(useConnections.getState().connections.map((c) => c.id));
  useConnections.setState({ connections: [...useConnections.getState().connections, ...linkedConnections.filter((c) => !have.has(c.id))] });
  registerMaterializeCommands();
});
afterEach(() => vi.restoreAllMocks());

describe('links.linkDatabase / links.linkSchema targets', () => {
  it('a database node of PostgreSQL / SQL Server is a whole database, a schema node a whole schema', () => {
    expect(scopeSourceOf(container('c_pg', 'shop', null), 'database')).toEqual({
      connectionId: 'c_pg', providerId: 'postgresql', scope: 'database', database: 'shop', schema: null, name: 'shop',
    });
    expect(scopeSourceOf(container('c_pg', 'shop', null), 'schema')).toBeNull();
    expect(scopeSourceOf(container('c_pg', 'shop', 'sales'), 'schema')).toMatchObject({ scope: 'schema', database: 'shop', schema: 'sales' });
    expect(scopeSourceOf(container('c_pg', 'shop', 'sales'), 'database')).toBeNull();
    expect(scopeSourceOf(container('c_shop', null, 'main'), 'schema')).toMatchObject({ scope: 'schema', schema: 'main' });
  });

  it('MySQL schema nodes and MongoDB databases are whole databases (the name in schema)', () => {
    expect(scopeSourceOf(container('c_mysql', null, 'shop'), 'database')).toMatchObject({ scope: 'database', database: null, schema: 'shop' });
    expect(scopeSourceOf(container('c_mysql', null, 'shop'), 'schema')).toBeNull();
    expect(scopeSourceOf(mongoDb('shop'), 'database')).toMatchObject({ connectionId: 'c_mongo', scope: 'database', database: null, schema: 'shop' });
    expect(scopeSourceOf(mongoDb('shop'), 'schema')).toBeNull();
  });

  it('not on folders, Queries folders or a link’s own schemas', () => {
    expect(scopeSourceOf(container('c_pg', 'shop', 'public', { objectType: 'table' }), 'schema')).toBeNull();
    expect(scopeSourceOf(container('c_pg', 'shop', 'public', { queries: true }), 'schema')).toBeNull();
    expect(scopeSourceOf(container('c_link', null, 'crm'), 'schema')).toBeNull();
    expect(isEnabled('links.linkSchema', container('c_pg', 'shop', 'public'))).toBe(true);
    expect(isEnabled('links.linkSchema', container('c_link', null, 'crm'))).toBe(false);
    expect(isEnabled('links.linkDatabase', container('c_pg', 'shop', null))).toBe(true);
  });

  it('joins the database / schema and MongoDB database menus (hidden where they do not apply)', () => {
    const ids = (menu: string) => contextMenuEntries(menu).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e] : []));
    expect(ids('explorer.container')).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'links.linkDatabase', hideDisabled: true }), expect.objectContaining({ command: 'links.linkSchema', hideDisabled: true }),
    ]));
    expect(ids('explorer.mongo.db').map((e) => e.command)).toContain('links.linkDatabase');
  });

  it('builds a wide member and knows when a link already spans the node', () => {
    const src = scopeSourceOf(container('c_pg', 'shop', null), 'database')!;
    expect(scopeMember(src, 'Postgres Shop', ['shop'])).toEqual({
      alias: 'shop_2', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: null, scope: 'database', allTables: true, tables: [],
    });
    // a generic schema takes the connection's name
    expect(scopeMember(scopeSourceOf(container('c_pg', 'shop', 'public'), 'schema')!, 'Postgres Shop').alias).toBe('postgres_shop');
    const def: LinkDefinition = { version: 2, relations: [], options: {}, members: [{ alias: 'pg', connectionId: 'c_pg', scope: 'connection', tables: [] }] };
    expect(coveringMember(def, src)?.alias).toBe('pg');
    const tablesOnly: LinkDefinition = { ...def, members: [{ alias: 'crm', connectionId: 'c_pg', database: 'shop', schema: 'public', scope: 'tables', tables: [{ name: 'customers' }] }] };
    const r = addScopeToDefinition(tablesOnly, scopeSourceOf(container('c_pg', 'shop', 'public'), 'schema')!, 'Postgres Shop');
    expect(r.already).toBe(false);
    expect(r.definition.members[1]).toMatchObject({ alias: 'postgres_shop', scope: 'schema', database: 'shop', schema: 'public' });
  });
});

describe('LinkScopeDialog', () => {
  const pgShop = () => scopeSourceOf(container('c_pg', 'shop', null), 'database')!;

  it('New link… opens the link editor with the member', async () => {
    const newLink = vi.fn();
    const off = registerCommand({ id: 'links.new', title: 'New linked database…', category: 'File', run: newLink });
    const onClose = vi.fn();
    render(<LinkScopeDialog source={pgShop()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /New link/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClose).toHaveBeenCalled();
    expect(newLink).toHaveBeenCalledWith({
      members: [{ alias: 'shop', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: null, scope: 'database', allTables: true, tables: [] }],
      connectAfter: false,
    });
    off();
  });

  it('adds the whole database to an existing link as a new member', async () => {
    const onClose = vi.fn();
    render(<LinkScopeDialog source={pgShop()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /Sales \(linked\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const def = linkDefinitionOf(mock.ctx.engine.conn('c_link')!);
    expect(def.version).toBe(2);
    expect(def.members[def.members.length - 1]).toMatchObject({ connectionId: 'c_pg', scope: 'database', database: 'shop', schema: null, allTables: true });
    expect(useUi.getState().toasts.some((t) => /Linked the database shop/.test(t.text) && /schema\.table/.test(t.detail ?? ''))).toBe(true);
  });

  it('says so (and how to query it) when the link already spans it', async () => {
    const saved = await useConnections.getState().save({
      name: 'Wide', providerId: 'linked', color: null, folder: null, readOnly: true, savePassword: false, password: null,
      props: linkProps({ version: 2, relations: [], options: {}, members: [{ alias: 'pg', connectionId: 'c_pg', database: null, schema: null, scope: 'connection', allTables: true, tables: [] }] }),
    });
    const onClose = vi.fn();
    render(<LinkScopeDialog source={pgShop()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /Wide/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(linkDefinitionOf(mock.ctx.engine.conn(saved.id)!).members).toHaveLength(1);
    const t = useUi.getState().toasts.find((x) => /already in Wide/.test(x.text));
    expect(t?.detail).toMatch(/pg\.database\.schema\.table/);
  });
});
