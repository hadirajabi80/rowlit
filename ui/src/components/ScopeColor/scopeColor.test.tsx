// Schema / database colours: the stored map (lib/scopeColors.ts), the "Set colour…" command and dialog, and where the
// colour shows: explorer rows (dot on the node, stripe + tint inside it), tab colour bars (schema colour wins over the
// connection's), the console's database switcher and the Objects tab's breadcrumb.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initCommands } from '../../commands';
import { CONTEXT_MENUS } from '../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../commands/registry';
import { readScopeColors, resolveScopeColor, scopeColorKey, setScopeColor } from '../../lib/scopeColors';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { Explorer, useExplorer } from '../Explorer/Explorer';
import { TabBar } from '../layout/TabBar';
import { Toolbar } from '../Toolbar/Toolbar';
import { useScopeColorDialog } from './dialogStore';
import { ScopeColorDialog } from './ScopeColorDialog';

const mock = installMockEngine();
beforeAll(() => initCommands(), 60_000);

const GREEN = '#16a34a';
const PURPLE = '#7c3aed';
const row = (label: string) => screen.getAllByRole('treeitem').find((el) => el.querySelector('.tree-label')?.textContent === label);

async function expand(label: string) {
  const r = await waitFor(() => {
    const el = row(label);
    if (!el) throw new Error(`row ${label} not found`);
    return el;
  });
  fireEvent.click(r.querySelector('.tree-twisty')!);
}

beforeEach(async () => {
  mock.reset();
  localStorage.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useScopeColorDialog.setState({ request: null });
  useExplorer.setState({ expanded: new Set(), collapsedFolders: new Set(), filter: '', selected: null, selectedTarget: null });
  useCatalog.setState({ conns: {}, dbs: {} });
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  await useConnections.getState().load();
});

describe('the stored colours', () => {
  it('a schema inherits its database colour unless it has its own; nothing for another connection', () => {
    const map = { [scopeColorKey('c1', 'Shop', null)]: GREEN, [scopeColorKey('c1', 'Shop', 'Sales')]: PURPLE };
    expect(resolveScopeColor(map, 'c1', 'Shop', 'dbo')).toBe(GREEN);
    expect(resolveScopeColor(map, 'c1', 'Shop', 'Sales')).toBe(PURPLE);
    expect(resolveScopeColor(map, 'c1', 'Shop', null)).toBe(GREEN);
    expect(resolveScopeColor(map, 'c1', 'Other', 'dbo')).toBeNull();
    expect(resolveScopeColor(map, 'c2', 'Shop', 'dbo')).toBeNull();
    expect(resolveScopeColor(map, null, 'Shop', 'dbo')).toBeNull();
  });

  it('is kept in settings.ui and cleared with null; junk values are ignored', () => {
    const ref = { connectionId: 'c1', database: 'Shop', schema: 'dbo' };
    setScopeColor(ref, GREEN);
    expect(useSettings.getState().settings.ui.scopeColors).toEqual({ [scopeColorKey('c1', 'Shop', 'dbo')]: GREEN });
    setScopeColor({ ...ref, schema: null }, PURPLE);
    setScopeColor(ref, null);
    expect(readScopeColors(useSettings.getState().settings.ui)).toEqual({ [scopeColorKey('c1', 'Shop', null)]: PURPLE });
    expect(readScopeColors({ scopeColors: 'x' })).toEqual({});
    expect(readScopeColors({ scopeColors: ['x'] })).toEqual({});
  });
});

describe('Set colour…', () => {
  it('is a palette command and sits in the schema / database context menu only', () => {
    expect(getCommand('scope.setColor')).toBeTruthy();
    const entry = CONTEXT_MENUS['explorer.container'].find((e) => typeof e === 'object' && 'command' in e && e.command === 'scope.setColor');
    expect(entry).toMatchObject({ label: 'Set colour…', hideDisabled: true });
    expect(isEnabled('scope.setColor', { kind: 'container', connectionId: 'c_prod', database: 'Shop', schema: 'dbo' })).toBe(true);
    expect(isEnabled('scope.setColor', { kind: 'container', connectionId: 'c_prod', database: 'Shop', schema: null })).toBe(true);
    // a type folder inside a schema colours nothing of its own
    expect(isEnabled('scope.setColor', { kind: 'container', connectionId: 'c_prod', database: 'Shop', schema: 'dbo', objectType: 'table' })).toBe(false);
    // a non-SQL connection has no schemas
    expect(isEnabled('scope.setColor', { kind: 'container', connectionId: 'c_redis', database: null, schema: null })).toBe(false);
  });

  it('opens the dialog for the node; a swatch applies the colour and closes, "No colour" clears it', () => {
    expect(runCommand('scope.setColor', { kind: 'container', connectionId: 'c_prod', database: 'Shop', schema: 'dbo' })).toBe(true);
    const req = useScopeColorDialog.getState().request!;
    expect(req).toEqual({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo' });
    render(<ScopeColorDialog request={req} />);
    expect(screen.getByRole('dialog', { name: 'Colour of schema dbo' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'No colour' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    expect(useScopeColorDialog.getState().request).toBeNull();
    expect(useSettings.getState().settings.ui.scopeColors).toEqual({ [scopeColorKey('c_prod', 'Shop', 'dbo')]: GREEN });

    render(<ScopeColorDialog request={req} />);
    expect(screen.getAllByRole('radio', { name: 'Green' }).at(-1)).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getAllByRole('radio', { name: 'No colour' }).at(-1)!);
    expect(useSettings.getState().settings.ui.scopeColors).toEqual({});
  });

  it('a database dialog says database and keeps the schemas as they are', () => {
    render(<ScopeColorDialog request={{ connectionId: 'c_prod', database: 'Shop', schema: null }} />);
    expect(screen.getByRole('dialog', { name: 'Colour of database Shop' })).toBeTruthy();
    expect(screen.getByText(/Its schemas use it unless they have their own/)).toBeTruthy();
  });
});

describe('where the colour shows', () => {
  it('explorer: a dot on the coloured node, a stripe and tint on its children, nothing on its siblings', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    await expand('Shop');
    await waitFor(() => expect(row('dbo')).toBeDefined());
    expect(row('dbo')!.querySelector('.scope-dot')).toBeNull();
    act(() => setScopeColor({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo' }, GREEN));
    const dbo = row('dbo')!;
    expect(dbo.classList.contains('scope-node')).toBe(true);
    expect(dbo.querySelector('.scope-dot')).toHaveAttribute('aria-label', 'Schema colour: Green');
    expect(dbo.getAttribute('title')).toBe('dbo · Schema colour: Green');
    expect(dbo.style.getPropertyValue('--scope-color')).toBe('var(--conn-green)');
    expect(row('Sales')!.querySelector('.scope-dot')).toBeNull();
    await expand('dbo');
    await waitFor(() => expect(row('Tables')).toBeDefined());
    const tables = row('Tables')!;
    expect(tables.querySelector('.tree-scope')).not.toBeNull();
    expect(tables.querySelector('.scope-dot')).toBeNull();
    expect(tables.classList.contains('scope-node')).toBe(false);
    // a database colour reaches its schemas that have none
    act(() => setScopeColor({ connectionId: 'c_prod', database: 'Shop', schema: null }, PURPLE));
    expect(row('Shop')!.querySelector('.scope-dot')).toHaveAttribute('aria-label', 'Database colour: Purple');
    expect(row('Sales')!.style.getPropertyValue('--scope-color')).toBe('var(--conn-purple)');
    // inherited: stripe and tint, no dot of its own, and the title says where it comes from
    expect(row('Sales')!.querySelector('.scope-dot')).toBeNull();
    expect(row('Sales')!.querySelector('.tree-scope')).not.toBeNull();
    expect(row('Sales')!.getAttribute('title')).toBe('Sales · Schema colour: Purple (from the database)');
    expect(row('dbo')!.style.getPropertyValue('--scope-color')).toBe('var(--conn-green)'); // its own wins
  });

  const consoleTab = (id: string, connectionId: string, database: string | null): ConsoleTab => ({
    kind: 'console', id, title: `Console ${id}`, connectionId, database, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null,
  });

  it('tabs: the colour bar is the schema colour when set, else the connection colour', async () => {
    await useCatalog.getState().loadDatabases('c_prod');
    await useCatalog.getState().loadSchemas('c_prod', 'Shop');
    useTabs.setState({ tabs: [consoleTab('1', 'c_prod', 'Shop'), consoleTab('2', 'c_prod', 'master')], activeId: '1', mru: [], closed: [] });
    const { container } = render(<TabBar />);
    const tabs = () => [...container.querySelectorAll<HTMLElement>('.tab')];
    const connBar = tabs()[0].style.getPropertyValue('--tab-color');
    act(() => setScopeColor({ connectionId: 'c_prod', database: 'Shop', schema: null }, PURPLE));
    expect(tabs()[0].style.getPropertyValue('--tab-color')).toBe('var(--conn-purple)');
    expect(tabs()[0].getAttribute('title')).toContain('Schema colour: Purple');
    // the other database has no colour: the connection's bar stays
    expect(tabs()[1].style.getPropertyValue('--tab-color')).toBe(connBar);
    expect(tabs()[1].getAttribute('title')).not.toContain('colour:');
  });

  it('the console toolbar: the database switcher carries the colour and says its name', async () => {
    await useCatalog.getState().loadDatabases('c_prod');
    const tab = consoleTab('1', 'c_prod', 'Shop');
    useTabs.setState({ tabs: [tab], activeId: '1', mru: [], closed: [] });
    const { container } = render(<Toolbar tab={tab} />);
    const pill = () => container.querySelector<HTMLElement>('.db-pill')!;
    expect(pill().querySelector('.scope-dot')).toBeNull();
    act(() => setScopeColor({ connectionId: 'c_prod', database: 'Shop', schema: null }, GREEN));
    expect(pill().querySelector('.scope-dot')).not.toBeNull();
    expect(pill().style.getPropertyValue('--scope-color')).toBe('var(--conn-green)');
    expect(pill().getAttribute('aria-label')).toContain('colour Green');
    expect(pill().getAttribute('title')).toContain('(Green)');
  });
});
