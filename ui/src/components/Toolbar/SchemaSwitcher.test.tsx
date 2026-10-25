// The console's schema indicator / switcher (SQL Server, PostgreSQL, Snowflake): where it shows, what each provider lets
// the picker do (PostgreSQL / Snowflake change the session, SQL Server only sets the editor schema), that the choice is
// kept on the tab (and re-applied when the session is reopened) and that IntelliSense follows it.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../api/client';
import type { SessionInfo } from '../../api/types';
import { initCommands } from '../../commands';
import { getCommand, isEnabled } from '../../commands/registry';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { resetOwnSessionsForTests, useSessions } from '../../store/sessions';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { installMockEngine } from '../../test/mockServer';
import { SchemaPickerHost } from './SchemaPickerHost';
import { Toolbar } from './Toolbar';

const mock = installMockEngine({ frameDelay: 0 });
beforeAll(() => initCommands(), 60_000);

function consoleTab(id: string, connectionId: string, database: string | null = null, schema: string | null = null): ConsoleTab {
  return { kind: 'console', id, title: id, connectionId, database, schema, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null };
}

beforeEach(async () => {
  mock.reset();
  localStorage.clear();
  resetOwnSessionsForTests();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useCatalog.setState({ conns: {}, dbs: {} });
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  useSessions.setState({ sessions: {}, byTab: {} });
  useUi.setState({ switcher: null, toasts: [] });
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  await useConnections.getState().load();
});

/** Like the app: the toolbar gets the tab from the store, so it follows changes to it. */
function Harness() {
  const tab = useTabs((s) => s.tabs[0]) as ConsoleTab | undefined;
  return tab ? <><Toolbar tab={tab} /><SchemaPickerHost /></> : null;
}

function mountConsole(tab: ConsoleTab) {
  useTabs.setState({ tabs: [tab], activeId: tab.id, mru: [], closed: [] });
  return render(<Harness />);
}

const pill = (c: HTMLElement) => c.querySelector<HTMLElement>('.schema-pill');

describe('where the schema control shows', () => {
  it.each([
    ['c_prod', 'SQL Server'], ['c_pg', 'PostgreSQL'], ['c_snowflake', 'Snowflake'],
  ])('%s (%s) has a schema pill next to the database pill', async (cid) => {
    const { container } = mountConsole(consoleTab('t1', cid));
    await waitFor(() => expect(pill(container)).not.toBeNull());
    expect(container.querySelector('.db-pill')).not.toBeNull();
  });

  it.each([
    ['c_ora', 'Oracle: the switcher is the schema'], ['c_mysql', 'MySQL'], ['c_clickhouse', 'ClickHouse'], ['c_cassandra', 'Cassandra keyspace'], ['c_shop', 'SQLite'],
  ])('%s (%s) gets no second control', (cid) => {
    const { container } = mountConsole(consoleTab('t1', cid));
    expect(pill(container)).toBeNull();
  });

  it('the Oracle database switcher is labelled as the schema', () => {
    const { container } = mountConsole(consoleTab('t1', 'c_ora'));
    expect(container.querySelector('.db-pill')!.getAttribute('aria-label')).toMatch(/^Schema /);
  });

  it('Change schema… is a command only where there is a schema control', async () => {
    mountConsole(consoleTab('t1', 'c_pg'));
    expect(getCommand('connections.changeSchema')).toBeDefined();
    expect(isEnabled('connections.changeSchema')).toBe(true);
    act(() => useTabs.setState({ tabs: [consoleTab('t1', 'c_ora')], activeId: 't1' }));
    expect(isEnabled('connections.changeSchema')).toBe(false);
  });
});

describe('PostgreSQL: the session schema', () => {
  it('shows the session\'s schema and search_path once connected, and says what unqualified names resolve to', async () => {
    const tab = consoleTab('t1', 'c_pg');
    const { container } = mountConsole(tab);
    await act(async () => { await useSessions.getState().ensure('t1', 'c_pg', null, 'auto'); });
    await waitFor(() => expect(pill(container)!.textContent).toContain('public'));
    expect(pill(container)!.title).toContain('Unqualified names resolve to public');
  });

  it('choosing a schema runs SET search_path on the session and the tab remembers it', async () => {
    const tab = consoleTab('t1', 'c_pg');
    const { container } = mountConsole(tab);
    await act(async () => { await useSessions.getState().ensure('t1', 'c_pg', null, 'auto'); });
    fireEvent.click(pill(container)!);
    const dialog = await screen.findByRole('dialog', { name: 'Change schema' });
    expect(dialog).toHaveTextContent('Unqualified names resolve to public');
    const option = await screen.findByRole('option', { name: /sales/ });
    fireEvent.mouseDown(option);

    await waitFor(() => expect(pill(container)!.textContent).toContain('sales'));
    expect(useTabs.getState().tabs[0]).toMatchObject({ schema: 'sales' });
    const sid = useSessions.getState().byTab.t1;
    expect(mock.ctx.engine.sessions.get(sid)).toMatchObject({ schema: 'sales', searchPath: ['sales', 'public'] });
    expect(pill(container)!.title).toContain('search_path: sales, public');
  });

  it('without a session the choice is only remembered; the first run applies it to the new session', async () => {
    const { container } = mountConsole(consoleTab('t1', 'c_pg'));
    fireEvent.click(pill(container)!);
    fireEvent.mouseDown(await screen.findByRole('option', { name: /sales/ }));
    await waitFor(() => expect(pill(container)!.textContent).toContain('sales'));
    expect(mock.ctx.engine.sessions.size).toBe(0);

    const tab = useTabs.getState().tabs[0] as ConsoleTab;
    let info!: SessionInfo;
    await act(async () => { info = await useSessions.getState().ensure('t1', 'c_pg', null, 'auto', tab.schema); });
    expect(info.schema).toBe('sales');
    expect(mock.ctx.engine.sessions.get(info.sessionId)).toMatchObject({ schema: 'sales' });
  });

  it('"Reset to the session\'s default" returns to public and forgets the tab\'s choice', async () => {
    const { container } = mountConsole(consoleTab('t1', 'c_pg', null, 'sales'));
    await act(async () => { await useSessions.getState().ensure('t1', 'c_pg', null, 'auto', 'sales'); });
    await waitFor(() => expect(pill(container)!.textContent).toContain('sales'));
    fireEvent.click(pill(container)!);
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Reset to the session/ }));
    await waitFor(() => expect(pill(container)!.textContent).toContain('public'));
    expect((useTabs.getState().tabs[0] as ConsoleTab).schema).toBeNull();
  });

  it('the engine moving the schema (SET search_path typed in the editor) is followed by the tab', async () => {
    const { container } = mountConsole(consoleTab('t1', 'c_pg'));
    await act(async () => { await useSessions.getState().ensure('t1', 'c_pg', null, 'auto'); });
    const sid = useSessions.getState().byTab.t1;
    act(() => useSessions.getState().applyChanged({ type: 'session.changed', sessionId: sid, state: 'idle', txOpen: false, database: 'shop', txMode: 'auto', schema: 'sales', searchPath: ['sales', 'public'] } as never));
    expect((useTabs.getState().tabs[0] as ConsoleTab).schema).toBe('sales');
    await waitFor(() => expect(pill(container)!.textContent).toContain('sales'));
  });

  it('switching the database forgets the remembered schema (another database has other schemas)', () => {
    mountConsole(consoleTab('t1', 'c_pg', 'shop', 'sales'));
    act(() => useTabs.getState().setDatabase('t1', 'analytics'));
    expect((useTabs.getState().tabs[0] as ConsoleTab).schema).toBeNull();
    act(() => useTabs.setState({ tabs: [consoleTab('t1', 'c_pg', 'shop', 'sales')] }));
    act(() => useTabs.getState().setDatabase('t1', 'shop')); // same database: kept
    expect((useTabs.getState().tabs[0] as ConsoleTab).schema).toBe('sales');
  });
});

describe('SQL Server: read-only, editor schema only', () => {
  it('explains that the server uses the login\'s default schema and sets the editor schema without touching the session', async () => {
    const { container } = mountConsole(consoleTab('t1', 'c_prod', 'Shop'));
    await act(async () => { await useSessions.getState().ensure('t1', 'c_prod', 'Shop', 'auto'); });
    await waitFor(() => expect(pill(container)!.textContent).toContain('dbo'));
    expect(pill(container)!.className).toContain('read-only');
    expect(pill(container)!.title).toContain('login’s default schema');

    fireEvent.click(pill(container)!);
    const dialog = await screen.findByRole('dialog', { name: 'Choose the editor schema' });
    expect(dialog).toHaveTextContent('SQL Server uses the login’s default schema');
    expect(dialog).toHaveTextContent('editor schema');
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Sales/ }));

    await waitFor(() => expect(pill(container)!.textContent).toContain('Sales'));
    expect(pill(container)!.className).toContain('override');
    expect(pill(container)!.querySelector('.schema-pill-tag')!.textContent).toBe('editor');
    expect(pill(container)!.title).toContain('completion and diagnostics only');
    expect((useTabs.getState().tabs[0] as ConsoleTab).schema).toBe('Sales');
    // the session itself is untouched
    const sid = useSessions.getState().byTab.t1;
    expect(mock.ctx.engine.sessions.get(sid)).toMatchObject({ schema: 'dbo' });
  });

  it('the engine refuses a session-level change with NOT_SUPPORTED, and so does a single-level provider', async () => {
    const ms = await api.createSession({ connectionId: 'c_prod', database: 'Shop', txMode: 'auto', captureServerOutput: false });
    await expect(api.changeSchema(ms.sessionId, 'Sales')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
    await expect(api.getSessionSchema(ms.sessionId)).resolves.toMatchObject({ schema: 'dbo', mode: 'readOnly' });
    const lite = await api.createSession({ connectionId: 'c_shop', database: null, txMode: 'auto', captureServerOutput: false });
    await expect(api.getSessionSchema(lite.sessionId)).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});

describe('the choice survives a workspace restore', () => {
  it('the schema is part of the saved tab and comes back with it', () => {
    useTabs.setState({ tabs: [consoleTab('t1', 'c_pg', 'shop', 'sales')], activeId: 't1', mru: [], closed: [] });
    const saved = JSON.parse(JSON.stringify(useTabs.getState().serialize()));
    useTabs.setState({ tabs: [], activeId: null, mru: [], closed: [] });
    useTabs.getState().restore(saved);
    expect(useTabs.getState().tabs[0]).toMatchObject({ id: 't1', schema: 'sales' });
  });

  it('a tab restored with a schema applies it to the new session on its first run (session reconnected)', async () => {
    useTabs.setState({ tabs: [consoleTab('t1', 'c_pg', 'shop', 'sales')], activeId: 't1', mru: [], closed: [] });
    const tab = useTabs.getState().tabs[0] as ConsoleTab;
    const info = await useSessions.getState().ensure(tab.id, 'c_pg', 'shop', tab.txMode, tab.schema);
    expect(info.schema).toBe('sales');
    // a session the tab already has is left alone (it follows the editor's own SET)
    const again = await useSessions.getState().ensure(tab.id, 'c_pg', 'shop', tab.txMode, 'public');
    expect(again.schema).toBe('sales');
  });
});
