// Resources (docs/resources.md), window side: background results released (and reloaded from the engine's copy),
// catalog LRU eviction, Close connection / Close database with confirmations, the status-bar popover and the
// Resources settings card.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { CatalogSchema, SessionInfo } from '../api/types';
import { initCommands } from '../commands';
import { isEnabled } from '../commands/registry';
import { useExplorer } from '../components/Explorer/explorerStore';
import { ResourcesItem } from '../components/StatusBar/ResourcesItem';
import { SettingsDialog } from '../components/layout/settings/SettingsDialog';
import { useSettingsNav } from '../components/layout/settings/nav';
import { ChunkedList } from '../lib/chunked';
import { dbKey, useCatalog, type DbCatalog } from '../store/catalog';
import { useConnections } from '../store/connections';
import { useEdits } from '../store/edits';
import { useResources } from '../store/resources';
import { useResults, viewKey } from '../store/results';
import { createExecution, type ExecutionState } from '../store/resultsReducer';
import { connectionActivity, resetOwnSessionsForTests, useSessions } from '../store/sessions';
import { DEFAULT_SETTINGS, useSettings } from '../store/settings';
import { useTabs, type ConsoleTab } from '../store/tabs';
import { useUi } from '../store/ui';
import { installMockEngine } from '../test/mockServer';
import { closeDatabase, disconnectConnection } from './actions';
import { reloadReleased, RELEASE_KEEP_ROWS, resetResourcePolicyForTests, runResourcePolicy, setLastViewedForTests } from './resources';

const mock = installMockEngine({ frameDelay: 0 });
beforeAll(() => initCommands(), 60_000);

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function consoleTab(id: string, connectionId = 'c_shop', database: string | null = null): ConsoleTab {
  return { kind: 'console', id, title: id, connectionId, database, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null };
}

/** A finished execution of `tabId` with one result set of `rows` rows. */
function finished(tabId: string, rows: number, o: Partial<ExecutionState> = {}): ExecutionState {
  const e = createExecution({ localId: `l_${tabId}`, tabId, connectionId: 'c_shop', sessionId: null, label: 'statement', batches: [{ sql: 'SELECT 1', line: 1, col: 1 }], maxRows: 0 });
  const list = new ChunkedList<(string | number | null)[]>();
  for (let i = 0; i < rows; i++) list.push([i]);
  return {
    ...e, executionId: `x_${tabId}`, status: 'ok', endedAt: NOW, elapsedMs: 1,
    resultSets: [{ id: 0, batchIndex: 0, columns: [{ name: 'n', ordinal: 0, dbType: 'int', kind: 'number', nullable: false }] as never, rows: list as never, rowCount: rows, truncated: false, elapsedMs: 1, done: true, rev: 1 }],
    ...o,
  };
}

function setResults(execs: ExecutionState[]) {
  useResults.setState({
    executions: Object.fromEntries(execs.map((e) => [e.localId, e])),
    byTab: Object.fromEntries(execs.map((e) => [e.tabId, e.localId])),
  });
}

const rowsOf = (tabId: string) => useResults.getState().executions[`l_${tabId}`].resultSets[0].rows.length;

beforeEach(() => {
  resetResourcePolicyForTests();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useTabs.setState({ tabs: [consoleTab('t_fg'), consoleTab('t_bg'), consoleTab('t_bg2')], activeId: 't_fg', mru: [], closed: [], groups: [{ id: 'g1', tabIds: ['t_fg', 't_bg', 't_bg2'], activeId: 't_fg' }] } as never);
  useEdits.setState({ buffers: {} });
  useResources.setState({ level: 'normal', snapshot: null, open: false });
});

describe('background results', () => {
  it('releases rows beyond the first page of tabs not viewed for the configured time, never the visible tab', () => {
    setResults([finished('t_fg', 5000), finished('t_bg', 5000), finished('t_bg2', 5000)]);
    setLastViewedForTests('t_bg', NOW - 11 * MIN);
    setLastViewedForTests('t_bg2', NOW - 2 * MIN);
    const released = runResourcePolicy({ now: NOW });
    expect(released).toBe(5000 - RELEASE_KEEP_ROWS);
    expect(rowsOf('t_bg')).toBe(RELEASE_KEEP_ROWS);
    expect(useResults.getState().executions.l_t_bg.resultSets[0].released).toMatchObject({ kept: RELEASE_KEEP_ROWS, total: 5000, reason: 'idle' });
    expect(rowsOf('t_bg2')).toBe(5000); // viewed 2 min ago
    expect(rowsOf('t_fg')).toBe(5000); // on screen
  });

  it('keeps grids with unsaved edits and running queries', () => {
    setResults([finished('t_bg', 5000), finished('t_bg2', 5000, { status: 'running' })]);
    setLastViewedForTests('t_bg', NOW - 60 * MIN);
    setLastViewedForTests('t_bg2', NOW - 60 * MIN);
    useEdits.getState().setCell(viewKey('l_t_bg', 0), 1, 0, 42 as never, 0 as never);
    runResourcePolicy({ now: NOW });
    expect(rowsOf('t_bg')).toBe(5000);
    expect(rowsOf('t_bg2')).toBe(5000);
  });

  it('over the row budget the least recently viewed background tab goes first; under pressure all background tabs go', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, resources: { ...DEFAULT_SETTINGS.resources, resultRowBudget: 12_000 } } });
    setResults([finished('t_fg', 5000), finished('t_bg', 5000), finished('t_bg2', 5000)]);
    setLastViewedForTests('t_bg', NOW - 3 * MIN);
    setLastViewedForTests('t_bg2', NOW - 1 * MIN);
    runResourcePolicy({ now: NOW });
    expect(useResults.getState().executions.l_t_bg.resultSets[0].released?.reason).toBe('budget');
    expect(rowsOf('t_bg2')).toBe(5000); // 11,000 rows left: within the budget

    runResourcePolicy({ now: NOW, level: 'high' });
    expect(rowsOf('t_bg2')).toBe(RELEASE_KEEP_ROWS);
    expect(useResults.getState().executions.l_t_bg2.resultSets[0].released?.reason).toBe('pressure');
    expect(rowsOf('t_fg')).toBe(5000);
  });

  it('turning automatic release off keeps everything', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, resources: { ...DEFAULT_SETTINGS.resources, autoRelease: false } } });
    setResults([finished('t_bg', 5000)]);
    setLastViewedForTests('t_bg', NOW - 600 * MIN);
    runResourcePolicy({ now: NOW, level: 'critical' });
    expect(rowsOf('t_bg')).toBe(5000);
  });

  it('Reload fetches the released rows back from the engine copy; a 404 leaves only Re-run', async () => {
    setResults([finished('t_bg', 2500)]);
    useResults.getState().releaseRows('l_t_bg', RELEASE_KEEP_ROWS, 'idle');
    const rows = vi.spyOn(api, 'rows').mockImplementation(async (_x, _rs, offset, limit) => ({
      columns: [], rows: Array.from({ length: Math.min(limit, 2500 - offset) }, (_, i) => [offset + i]), rowCount: 2500, truncated: false,
    }) as never);
    try {
      expect(await reloadReleased('l_t_bg')).toBe(true);
      const rs = useResults.getState().executions.l_t_bg.resultSets[0];
      expect(rs.rows.length).toBe(2500);
      expect(rs.rows.get(1000)).toEqual([1000]);
      expect(rs.released).toBeNull();

      useResults.getState().releaseRows('l_t_bg', RELEASE_KEEP_ROWS, 'pressure');
      rows.mockRejectedValue(new ApiError('NOT_FOUND', 'gone', 404));
      expect(await reloadReleased('l_t_bg')).toBe(false);
      expect(useResults.getState().executions.l_t_bg.resultSets[0].released).toMatchObject({ unavailable: true, reloading: false });
    } finally {
      rows.mockRestore();
    }
  });
});

describe('catalog LRU', () => {
  const schema = (name: string, objects: number): CatalogSchema => ({
    name, version: 1, objects: Array.from({ length: objects }, (_, i) => ({ t: 'table', n: `t${i}`, c: [['id', 'int', false]] as never })),
  });
  const entry = (cid: string, db: string | null, objects: number): DbCatalog => ({
    connectionId: cid, database: db, schemasResp: null, schemasStatus: 'ready', schemasError: null, loaded: { dbo: schema('dbo', objects) },
    schemaStatus: { dbo: 'ready' }, schemaError: {}, etags: {}, dialect: 'tsql', defaultSchema: 'dbo', databasesList: [], snapshot: null,
  });

  it('evicts the least recently used databases nobody shows, keeps open tabs and expanded nodes', () => {
    useTabs.setState({ tabs: [consoleTab('t1', 'c_open')], activeId: 't1' });
    useExplorer.setState({ expanded: new Set(['c:c_tree', 'd:c_tree:Shown']) });
    useCatalog.setState({
      conns: {},
      dbs: {
        [dbKey('c_open', 'A')]: entry('c_open', 'A', 500),
        [dbKey('c_tree', 'Shown')]: entry('c_tree', 'Shown', 500),
        [dbKey('c_tree', 'Hidden')]: entry('c_tree', 'Hidden', 500),
        [dbKey('c_gone', 'Old')]: entry('c_gone', 'Old', 500),
      },
    });
    const evicted = useCatalog.getState().evict({
      budgetBytes: 0, minIdleMs: 0, now: Date.now() + MIN,
      inUse: (d) => d.connectionId === 'c_open' || (d.connectionId === 'c_tree' && d.database === 'Shown'),
    });
    expect(evicted.sort()).toEqual([dbKey('c_gone', 'Old'), dbKey('c_tree', 'Hidden')].sort());
    expect(Object.keys(useCatalog.getState().dbs).sort()).toEqual([dbKey('c_open', 'A'), dbKey('c_tree', 'Shown')].sort());

    // within budget: nothing goes
    expect(useCatalog.getState().evict({ budgetBytes: 10 * 1024 * 1024, minIdleMs: 0, inUse: () => false })).toEqual([]);
  });

  it('the policy uses the explorer and the open tabs (catalogCacheMb budget)', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, resources: { ...DEFAULT_SETTINGS.resources, catalogCacheMb: 8 } } });
    useTabs.setState({ tabs: [], activeId: null, groups: [] } as never);
    useExplorer.setState({ expanded: new Set() });
    useCatalog.setState({ conns: {}, dbs: { [dbKey('c_x', 'Big')]: entry('c_x', 'Big', 60_000) } });
    runResourcePolicy({ now: Date.now() + 11 * MIN });
    expect(useCatalog.getState().dbs[dbKey('c_x', 'Big')]).toBeUndefined();
  });
});

describe('Close connection / Close database', () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    mock.ctx.engine.sessions.clear();
    resetOwnSessionsForTests();
    await useConnections.getState().load();
    useSessions.setState({ sessions: {}, byTab: {} });
    useResults.setState({ executions: {}, byTab: {} });
    useUi.setState({ toasts: [] });
    confirm = vi.fn(async () => true);
    useUi.setState({ askConfirm: confirm as never });
  });

  async function session(tabId: string, database: string | null = null): Promise<SessionInfo> {
    const info = await api.createSession({ connectionId: 'c_shop', database, txMode: 'auto', captureServerOutput: false });
    useSessions.getState().upsert(info, tabId);
    return info;
  }

  it('releases the sessions (ids stay; tabs reconnect lazily), drops the catalog, and the dot goes out', async () => {
    const a = await session('t_fg');
    useCatalog.setState({ conns: { c_shop: { databases: null, status: 'ready', error: null } }, dbs: {} });
    expect(connectionActivity('c_shop', useSessions.getState().sessions, () => 'ready')).toEqual({ kind: 'session', sessions: 1 });
    expect(isEnabled('connections.disconnect', { kind: 'connection', connectionId: 'c_shop' })).toBe(true);

    await disconnectConnection('c_shop');
    expect(confirm).not.toHaveBeenCalled();
    const s = useSessions.getState().sessions[a.sessionId];
    expect(s).toMatchObject({ released: true, releasedReason: 'closed' });
    expect(useSessions.getState().byTab.t_fg).toBe(a.sessionId);
    expect(mock.ctx.engine.sessions.get(a.sessionId)?.released).toBe(true);
    expect(useCatalog.getState().conns.c_shop).toBeUndefined();
    expect(connectionActivity('c_shop', useSessions.getState().sessions, () => undefined)).toEqual({ kind: 'catalog', released: 1 });
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ text: 'Closed Shop (SQLite)', detail: '1 session released' });
  });

  it('asks before rolling back an open transaction or cancelling a running query, and lists them', async () => {
    const a = await session('t_fg');
    mock.ctx.engine.sessions.get(a.sessionId)!.txOpen = true;
    useSessions.getState().upsert({ ...a, txOpen: true, txMode: 'manual' }, 't_fg');
    setResults([finished('t_bg', 10, { status: 'running' })]);
    confirm.mockResolvedValueOnce(false);
    await disconnectConnection('c_shop');
    expect(confirm).toHaveBeenCalledTimes(1);
    const req = confirm.mock.calls[0][0];
    expect(req.message).toMatch(/^1 console has an uncommitted transaction on “.+”\. Closing rolls it back\. 1 running query will be cancelled\.$/);
    expect(req.items).toEqual([`${a.sessionId} — uncommitted transaction, rolled back`, 't_bg — running query, cancelled']);
    expect(mock.ctx.engine.sessions.get(a.sessionId)?.released).toBeFalsy(); // cancelled: nothing closed

    await disconnectConnection('c_shop');
    expect(mock.ctx.engine.sessions.get(a.sessionId)?.released).toBe(true);
    expect(useSessions.getState().lastTxEnd).toMatchObject({ sessionId: a.sessionId, kind: 'rollback' });
  });

  it('confirms what only the engine knows (409 RESOURCE_BUSY) before forcing', async () => {
    const a = await session('t_fg');
    mock.ctx.engine.sessions.get(a.sessionId)!.txOpen = true; // the window does not know yet
    await disconnectConnection('c_shop');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Close connection', confirmLabel: 'Interrupt and close' });
    expect(confirm.mock.calls[0][0].items).toEqual([`${a.sessionId} — uncommitted transaction`]);
    expect(mock.ctx.engine.sessions.get(a.sessionId)?.released).toBe(true);
  });

  it('Close database releases only the sessions on that database and forgets only its catalog', async () => {
    const onShop = await session('t_fg', 'Shop');
    const onOther = await session('t_bg', 'Other');
    useCatalog.setState({
      conns: {},
      dbs: { [dbKey('c_shop', 'Shop')]: { connectionId: 'c_shop', database: 'Shop' } as DbCatalog, [dbKey('c_shop', 'Other')]: { connectionId: 'c_shop', database: 'Other' } as DbCatalog },
    });
    expect(isEnabled('connections.closeDatabase', { kind: 'container', connectionId: 'c_shop', database: 'Shop', schema: null })).toBe(true);
    expect(isEnabled('connections.closeDatabase', { kind: 'container', connectionId: 'c_shop', database: 'Shop', schema: 'dbo' })).toBe(false);
    await closeDatabase('c_shop', 'Shop');
    expect(useSessions.getState().sessions[onShop.sessionId].released).toBe(true);
    expect(useSessions.getState().sessions[onOther.sessionId].released).toBeFalsy();
    expect(mock.ctx.engine.sessions.get(onOther.sessionId)?.released).toBeFalsy();
    expect(Object.keys(useCatalog.getState().dbs)).toEqual([dbKey('c_shop', 'Other')]);
  });

  it('a released session runs again on the same id (the engine reconnects)', async () => {
    const a = await session('t_fg');
    await disconnectConnection('c_shop');
    const ensured = await useSessions.getState().ensure('t_fg', 'c_shop', null, 'auto');
    expect(ensured.sessionId).toBe(a.sessionId);
    const r = await api.execute(a.sessionId, { batches: [{ sql: 'SELECT 1', line: 1, col: 1 }], maxRows: 10, stopOnError: true, label: 'statement' });
    expect(r.executionId).toBeTruthy();
    expect(mock.ctx.engine.sessions.get(a.sessionId)?.released).toBe(false);
  });
});

describe('released sessions in the sessions store', () => {
  it('session.changed carries the release; the explorer dot only shows what holds server resources', () => {
    const s: SessionInfo = {
      sessionId: 's1', connectionId: 'c_shop', serverInfo: {} as never, database: null, txMode: 'auto', txOpen: false, state: 'idle', dialect: 'sqlite',
    };
    useSessions.setState({ sessions: { s1: s }, byTab: { t_fg: 's1' } });
    useSessions.getState().applyChanged({ type: 'session.changed', ts: '', sessionId: 's1', state: 'idle', txOpen: false, database: null, txMode: 'auto', released: true, releasedReason: 'idle' });
    expect(useSessions.getState().sessions.s1).toMatchObject({ released: true, releasedReason: 'idle' });
    expect(connectionActivity('c_shop', useSessions.getState().sessions, () => undefined)).toEqual({ kind: 'catalog', released: 1 });
    expect(connectionActivity('c_shop', {}, () => undefined, () => true)).toEqual({ kind: 'client' });
    useSessions.getState().applyChanged({ type: 'session.changed', ts: '', sessionId: 's1', state: 'idle', txOpen: false, database: null, txMode: 'auto', released: false });
    expect(useSessions.getState().sessions.s1.released).toBe(false);
    expect(connectionActivity('c_shop', useSessions.getState().sessions, () => undefined)).toEqual({ kind: 'session', sessions: 1 });
  });
});

describe('status bar Resources item', () => {
  afterEach(() => useResources.setState({ open: false }));

  it('shows memory, opens the popover with the connections and closes one', async () => {
    mock.ctx.engine.sessions.clear();
    await useConnections.getState().load();
    const info = await api.createSession({ connectionId: 'c_shop', database: null, txMode: 'auto', captureServerOutput: false });
    useSessions.getState().upsert(info, 't_fg');
    await act(async () => {
      await useResources.getState().refresh();
    });
    render(<ResourcesItem />);
    const button = screen.getByRole('button', { name: /^Resources: / });
    expect(button).toHaveTextContent('180 MB');
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Resources' }, { timeout: 10_000 });
    expect(within(dialog).getByText('Shop (SQLite)')).toBeInTheDocument();
    expect(within(dialog).getByText('1 open session')).toBeInTheDocument();
    expect(within(dialog).getByRole('progressbar', { name: 'Memory use' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close Shop (SQLite)' }));
    });
    await vi.waitFor(() => expect(mock.ctx.engine.sessions.get(info.sessionId)?.released).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useResources.getState().open).toBe(false);
  });
});

describe('Settings › Connections › Resources', () => {
  it('edits the resources settings', () => {
    useSettingsNav.setState({ section: 'connections' });
    useUi.setState({ settingsOpen: true });
    const update = vi.spyOn(useSettings.getState(), 'update').mockImplementation(() => undefined);
    try {
      render(<SettingsDialog />);
      expect(screen.getByRole('region', { name: 'Resources' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Close idle sessions after (minutes)'), { target: { value: '30' } });
      expect(update).toHaveBeenCalledWith({ resources: { idleSessionMinutes: 30 } });
      fireEvent.change(screen.getByLabelText('Open connections at most'), { target: { value: '5' } });
      expect(update).toHaveBeenCalledWith({ resources: { maxOpenConnections: 5 } });
      fireEvent.click(screen.getByLabelText('Release resources automatically'));
      expect(update).toHaveBeenCalledWith({ resources: { autoRelease: false } });
    } finally {
      update.mockRestore();
      useUi.setState({ settingsOpen: false });
    }
  });
});
