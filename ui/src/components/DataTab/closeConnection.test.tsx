// "Close connection" / "Close database" with tabs open (docs/resources.md): a console and a Data tab on the connection stay
// open when it is closed — rows and text are kept, the Data tab says "Disconnected" with a Reconnect button — and nothing
// reconnects (no catalog load, no session, no query) until the user acts: Reconnect, a run, a refresh, a page.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { closeDatabase, disconnectConnection } from '../../app/actions';
import { registerGridSaver } from '../../app/pendingGrids';
import { installGridMockEngine, until } from '../../mocks/m15/testServer';
import { dbKey, useCatalog, type DbCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useEdits } from '../../store/edits';
import { resetOwnSessionsForTests, useSessions } from '../../store/sessions';
import { useTabs, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import type { DataGridProps } from '../Grid/DataGrid';
import { DataTabView } from './DataTabView';
import { dataGridKey } from './open';
import { setSqlRunner, type QueryOutcome } from './runner';

let gridProps: DataGridProps | null = null;
vi.mock('../Grid/DataGrid', () => ({
  DataGrid: (p: DataGridProps) => {
    gridProps = p;
    return <div data-testid="grid" data-rows={p.rows.length} />;
  },
  rowValue: () => null,
}));

const mock = installGridMockEngine();

const col = (name: string, kind: ColumnKind, ordinal: number, isKey = false): ColumnInfo => ({
  name, ordinal, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'customers', schema: 'main', isKey,
});
const COLUMNS = [col('id', 'int', 0, true), col('name', 'string', 1)];
const outcome = (columns: ColumnInfo[], rows: CellValue[][]): QueryOutcome => ({
  executionId: 'x', status: 'ok', resultSets: [{ columns, rows, truncated: false }], affected: 0, affectedReported: false, error: null, messages: [], outParams: [], elapsedMs: 1, txOpen: false,
});
const runs: string[] = [];

const TAB: ViewTab = { kind: 'view', id: 'dt1', title: 'customers', view: 'data', connectionId: 'c_shop', database: null, state: { schema: 'main', name: 'customers', type: 'table' } };

let confirm: ReturnType<typeof vi.fn>;
let choice: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await useConnections.getState().load();
  setSqlRunner(async (_sid, sql) => {
    runs.push(sql);
    if (sql.includes('WHERE 1 = 0')) return outcome(COLUMNS, []);
    if (sql.startsWith('SELECT COUNT(*)')) return outcome([col('row_count', 'int', 0)], [[3]]);
    return outcome(COLUMNS, [[1, 'a'], [2, 'b'], [3, 'c']]);
  });
});
afterAll(() => setSqlRunner(null));

beforeEach(() => {
  runs.length = 0;
  gridProps = null;
  resetOwnSessionsForTests();
  useSessions.setState({ sessions: {}, byTab: {} });
  useCatalog.setState({ conns: {}, dbs: {}, closed: {} });
  useEdits.setState({ buffers: {} });
  useTabs.setState({ tabs: [TAB], activeId: TAB.id, mru: [], closed: [] });
  useUi.setState({ toasts: [] });
  confirm = vi.fn(async () => true);
  choice = vi.fn(async () => 'ok');
  useUi.setState({ askConfirm: confirm as never, askConfirmChoice: choice as never });
});

/** What a window does on its own: catalog, session and query traffic (the Resources poll is not part of it). */
const autoTraffic = () => mock.ctx.requests.filter((r) => /\/catalog|\/execute|\/diagnostics/.test(r.url.pathname) || (r.method === 'POST' && r.url.pathname.endsWith('/sessions')));
const settle = (ms = 400) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function openTabs() {
  render(<DataTabView tab={TAB} theme="light" visible />);
  await until(() => gridProps?.rows.length === 3);
  const con = await act(() => useSessions.getState().ensure('t_con', 'c_shop', null, 'auto'));
  const data = useSessions.getState().forTab('dt1')!;
  return { con, data };
}

describe('Close connection with an open console and Data tab', () => {
  it('releases both sessions, keeps the tabs and their rows, and says Disconnected', async () => {
    const { con, data } = await openTabs();
    mock.ctx.requests.length = 0;
    await act(() => disconnectConnection('c_shop'));
    expect(confirm).not.toHaveBeenCalled();
    expect(useSessions.getState().sessions[con.sessionId]).toMatchObject({ released: true, releasedReason: 'closed' });
    expect(useSessions.getState().sessions[data.sessionId]).toMatchObject({ released: true, releasedReason: 'closed' });
    expect(mock.ctx.engine.sessions.get(data.sessionId)?.released).toBe(true);
    // the tabs stay: the grid keeps its rows, the banner offers Reconnect
    expect(gridProps!.rows.length).toBe(3);
    expect(screen.getByText(/Disconnected — the loaded rows are kept/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeInTheDocument();
    expect(useTabs.getState().tabs.map((t) => t.id)).toEqual(['dt1']);
    expect(useCatalog.getState().closed.c_shop).toBe(true);
  });

  it('nothing reconnects by itself: no catalog load, no session, no query after the close', async () => {
    await openTabs();
    await act(() => disconnectConnection('c_shop'));
    mock.ctx.requests.length = 0;
    runs.length = 0;
    await settle(800);
    expect(autoTraffic()).toEqual([]);
    expect(runs).toEqual([]);
    expect(useCatalog.getState().dbs).toEqual({});
    expect(useCatalog.getState().conns).toEqual({});
    expect(mock.ctx.engine.sessions.get(useSessions.getState().forTab('dt1')!.sessionId)?.released).toBe(true);
  });

  it('Reconnect reopens the session and the catalog may load again; the rows stay', async () => {
    const { data } = await openTabs();
    await act(() => disconnectConnection('c_shop'));
    fireEvent.click(screen.getByRole('button', { name: /Reconnect/ }));
    await until(() => mock.ctx.engine.sessions.get(data.sessionId)?.released === false);
    await until(() => !useSessions.getState().sessions[data.sessionId].released);
    expect(screen.queryByText(/Disconnected —/)).toBeNull();
    expect(useCatalog.getState().closed.c_shop).toBeUndefined();
    expect(gridProps!.rows.length).toBe(3);
  });

  it('a refresh or a console run reconnects: the closed mark clears', async () => {
    await openTabs();
    await act(() => disconnectConnection('c_shop'));
    runs.length = 0;
    await act(async () => {
      gridProps!.controllerExtras!.refresh!();
    });
    await until(() => runs.some((s) => s.includes('LIMIT')));
    expect(useCatalog.getState().closed.c_shop).toBeUndefined();
    // a console run does the same
    await act(() => disconnectConnection('c_shop'));
    expect(useCatalog.getState().closed.c_shop).toBe(true);
    await act(() => useSessions.getState().ensure('t_con', 'c_shop', null, 'auto'));
    expect(useCatalog.getState().closed.c_shop).toBeUndefined();
  });

  it('an open transaction in the console asks first: Cancel closes nothing, confirming rolls it back and keeps the tabs', async () => {
    const { con } = await openTabs();
    mock.ctx.engine.sessions.get(con.sessionId)!.txOpen = true;
    useSessions.getState().upsert({ ...useSessions.getState().sessions[con.sessionId], txOpen: true, txMode: 'manual' }, 't_con');
    confirm.mockResolvedValueOnce(false);
    await act(() => disconnectConnection('c_shop'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].message).toMatch(/uncommitted transaction.*rolls it back/);
    expect(useSessions.getState().sessions[con.sessionId].released).toBeFalsy();
    expect(useCatalog.getState().closed.c_shop).toBeUndefined();

    await act(() => disconnectConnection('c_shop'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(useSessions.getState().sessions[con.sessionId]).toMatchObject({ released: true, txOpen: false });
    expect(mock.ctx.engine.sessions.get(con.sessionId)?.released).toBe(true);
    expect(gridProps!.rows.length).toBe(3);
  });

  it('Close database only affects the tabs on that database', async () => {
    const onShop = await act(() => api.createSession({ connectionId: 'c_shop', database: 'Shop', txMode: 'auto', captureServerOutput: false }));
    const onOther = await act(() => api.createSession({ connectionId: 'c_shop', database: 'Other', txMode: 'auto', captureServerOutput: false }));
    useSessions.getState().upsert(onShop, 't_a');
    useSessions.getState().upsert(onOther, 't_b');
    useCatalog.setState({
      dbs: { [dbKey('c_shop', 'Shop')]: { connectionId: 'c_shop', database: 'Shop' } as DbCatalog, [dbKey('c_shop', 'Other')]: { connectionId: 'c_shop', database: 'Other' } as DbCatalog },
    });
    await act(() => closeDatabase('c_shop', 'Shop'));
    expect(useSessions.getState().sessions[onShop.sessionId].released).toBe(true);
    expect(useSessions.getState().sessions[onOther.sessionId].released).toBeFalsy();
    expect(Object.keys(useCatalog.getState().dbs)).toEqual([dbKey('c_shop', 'Other')]);
    expect(useCatalog.getState().closed[`c_shop\u0001shop`]).toBe(true);
    expect(useCatalog.getState().closed.c_shop).toBeUndefined();
  });
});

describe('Close connection with unsaved grid edits', () => {
  const tab2: ViewTab = { ...TAB, id: 'dt2', title: 'orders' };
  const offs: (() => void)[] = [];
  const reg = (key: string, save: () => Promise<boolean>) => offs.push(registerGridSaver(key, save));
  afterEach(() => offs.splice(0).forEach((off) => off()));
  beforeEach(() => {
    useTabs.setState({ tabs: [TAB, tab2], activeId: TAB.id, mru: [], closed: [] });
    useEdits.getState().addInsert(dataGridKey('dt2'), 2);
  });
  const pending = () => useEdits.getState().get(dataGridKey('dt2')).pending.inserts.length;

  async function withSession() {
    const s = await act(() => api.createSession({ connectionId: 'c_shop', database: null, txMode: 'auto', captureServerOutput: false }));
    useSessions.getState().upsert(s, 'dt2');
    return s;
  }

  it('Cancel closes nothing and keeps the edits', async () => {
    const s = await withSession();
    choice.mockResolvedValueOnce('cancel');
    reg(dataGridKey('dt2'), async () => true);
    await act(() => disconnectConnection('c_shop'));
    expect(choice).toHaveBeenCalledTimes(1);
    expect(choice.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Save', altLabel: 'Discard', cancelLabel: 'Cancel' });
    expect(pending()).toBe(1);
    expect(useSessions.getState().sessions[s.sessionId].released).toBeFalsy();
    expect(mock.ctx.engine.sessions.get(s.sessionId)?.released).toBeFalsy();
  });

  it('Discard drops the edits and closes', async () => {
    const s = await withSession();
    choice.mockResolvedValueOnce('alt');
    reg(dataGridKey('dt2'), async () => true);
    await act(() => disconnectConnection('c_shop'));
    expect(pending()).toBe(0);
    expect(useSessions.getState().sessions[s.sessionId].released).toBe(true);
  });

  it('Save saves through the tab first, then closes', async () => {
    const s = await withSession();
    const save = vi.fn(async () => {
      useEdits.getState().reset(dataGridKey('dt2')); // what a successful submit leaves behind: nothing pending
      return true;
    });
    reg(dataGridKey('dt2'), save);
    await act(() => disconnectConnection('c_shop'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(useSessions.getState().sessions[s.sessionId].released).toBe(true);
  });

  it('a save that fails keeps the connection open and says so', async () => {
    const s = await withSession();
    reg(dataGridKey('dt2'), async () => false);
    await act(() => disconnectConnection('c_shop'));
    expect(pending()).toBe(1);
    expect(useSessions.getState().sessions[s.sessionId].released).toBeFalsy();
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('“orders” could not be saved') });
  });

  it('edits that cannot be saved from here (no mounted Data tab) only offer Discard or Cancel', async () => {
    await withSession();
    confirm.mockResolvedValueOnce(false);
    await act(() => disconnectConnection('c_shop'));
    expect(choice).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Discard changes', danger: true });
    expect(pending()).toBe(1);
  });
});
