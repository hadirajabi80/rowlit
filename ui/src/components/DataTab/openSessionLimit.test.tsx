// Data tab identity (tab key, re-opening a tab) and the session-limit relief: opening a table must not fail with
// SESSION_LIMIT while other Data tabs only hold idle sessions.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { SessionInfo } from '../../api/types';
import { newCondition, newGroup } from '../../filter/model';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useEdits } from '../../store/edits';
import { useSessions } from '../../store/sessions';
import { useTabs, type ViewTab } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { DATA_VIEW, dataGridKey, dataTabKey, openDataTab, type DataTabState } from './open';
import { registerDataTabActivity, releaseIdleDataSession } from './sessionLimit';

installMockEngine({ frameDelay: 0 });

const dataTabs = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === DATA_VIEW);
const stateOf = (t: ViewTab) => t.state as DataTabState;

beforeAll(async () => {
  await useConnections.getState().load();
});

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useCatalog.setState({ conns: {}, dbs: {} });
});

describe('data tab key', () => {
  it('keeps PostgreSQL "Orders" and orders apart, folds case on SQL Server / SQLite', () => {
    expect(dataTabKey('c', null, 'public', 'Orders', 'pgsql')).not.toBe(dataTabKey('c', null, 'public', 'orders', 'pgsql'));
    expect(dataTabKey('c', null, 'dbo', 'Orders', 'tsql')).toBe(dataTabKey('c', null, 'DBO', 'orders', 'tsql'));
    expect(dataTabKey('c', null, 'main', 'Orders', 'sqlite')).toBe(dataTabKey('c', null, 'main', 'orders', 'sqlite'));
  });

  it('a dot in a name does not blur schema and table', () => {
    expect(dataTabKey('c', null, 'a', 'b.c', 'pgsql')).not.toBe(dataTabKey('c', null, 'a.b', 'c', 'pgsql'));
    expect(dataTabKey('c', 'db1', 's', 't', 'pgsql')).not.toBe(dataTabKey('c', 'db2', 's', 't', 'pgsql'));
  });
});

describe('openDataTab', () => {
  it('tables that differ only by case are two tabs on PostgreSQL, one on SQL Server', () => {
    openDataTab({ connectionId: 'c_pg', database: null, schema: 'public', name: 'Orders' });
    openDataTab({ connectionId: 'c_pg', database: null, schema: 'public', name: 'orders' });
    expect(dataTabs()).toHaveLength(2);
    useTabs.setState({ tabs: [], activeId: null });
    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'Orders' });
    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'orders' });
    expect(dataTabs()).toHaveLength(1);
  });

  it('the same table with and without the default schema is one tab', () => {
    useCatalog.setState({ conns: {}, dbs: { 'c_prod\u0001Shop': { defaultSchema: 'dbo' } as never } });
    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: null, name: 'customers' });
    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers' });
    expect(dataTabs()).toHaveLength(1);
  });

  it('opening an open table again keeps its filter, search and sort; a requested filter replaces only the filter', () => {
    const id = openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers', type: 'table' });
    const mine = newGroup('and', [newCondition('name', 'contains', ['x'])]);
    useTabs.getState().updateView(id, { state: { ...stateOf(dataTabs()[0]), filter: mine, quick: 'ada', sort: [{ column: 'id', dir: 'desc' }] } });
    const nonce = stateOf(dataTabs()[0]).nonce;

    expect(openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers', type: 'table' })).toBe(id);
    let s = stateOf(dataTabs()[0]);
    expect(s).toMatchObject({ filter: mine, quick: 'ada', sort: [{ column: 'id', dir: 'desc' }], nonce });
    expect(s.retry).toBeTypeOf('number');

    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers', type: 'table', filter: [{ column: 'id', value: 7 }] });
    s = stateOf(dataTabs()[0]);
    expect(s.filter).not.toEqual(mine);
    expect(s).toMatchObject({ quick: 'ada', sort: [{ column: 'id', dir: 'desc' }] });
    expect(dataTabs()).toHaveLength(1);
  });

  it('a tab restored with the old key is found, not duplicated', () => {
    useTabs.getState().openView({
      view: DATA_VIEW, title: 'dbo.customers', connectionId: 'c_prod', database: 'Shop', state: { schema: 'dbo', name: 'customers', type: 'table' },
      key: 'c_prod|shop|dbo.customers', // the old key was lower-cased
    });
    openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers', type: 'table' });
    expect(dataTabs()).toHaveLength(1);
    expect(dataTabs()[0].key).toBe(dataTabKey('c_prod', 'Shop', 'dbo', 'customers', 'tsql'));
  });
});

describe('releaseIdleDataSession', () => {
  const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
    sessionId: id, connectionId: 'c_prod', serverInfo: {} as never, database: 'Shop', txMode: 'auto', txOpen: false, state: 'idle', dialect: 'tsql', ...over,
  });
  let closed: string[];
  const tab = (name: string) => openDataTab({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name });
  const own = (tabId: string, s: SessionInfo) => useSessions.setState((st) => ({ sessions: { ...st.sessions, [s.sessionId]: s }, byTab: { ...st.byTab, [tabId]: s.sessionId } }));

  beforeEach(() => {
    closed = [];
    useSessions.setState({ sessions: {}, byTab: {} });
    useEdits.setState({ buffers: {} } as never);
    vi.spyOn(api, 'closeSession').mockImplementation(async (sid: string) => {
      closed.push(sid);
      return undefined as never;
    });
  });

  it('releases the least recently used idle data tab, never the asking tab, a busy one, one in a transaction or with edits', async () => {
    const a = tab('a');
    const b = tab('b');
    const c = tab('c');
    const d = tab('d');
    const asking = tab('asking');
    own(a, session('s_a'));
    own(b, session('s_b'));
    own(c, session('s_c', { txOpen: true }));
    own(d, session('s_d', { state: 'executing' }));
    own(asking, session('s_asking'));
    const unregister = [
      registerDataTabActivity(a, { busy: () => true, lastUse: () => 1 }), // busy
      registerDataTabActivity(b, { busy: () => false, lastUse: () => 5 }),
      registerDataTabActivity(asking, { busy: () => false, lastUse: () => 0 }),
    ];
    expect(await releaseIdleDataSession('c_prod', asking)).toBe(true);
    expect(closed).toEqual(['s_b']);
    unregister.forEach((u) => u());

    // Nothing left that is safe: a (busy), c (transaction), d (running), the asking tab.
    registerDataTabActivity(a, { busy: () => true, lastUse: () => 1 });
    expect(await releaseIdleDataSession('c_prod', asking)).toBe(false);
    expect(closed).toEqual(['s_b']);
  });

  it('prefers the older of two idle tabs, and an unused session before any tab', async () => {
    const a = tab('a');
    const b = tab('b');
    own(a, session('s_a'));
    own(b, session('s_b'));
    registerDataTabActivity(a, { busy: () => false, lastUse: () => 200 });
    registerDataTabActivity(b, { busy: () => false, lastUse: () => 100 });
    useSessions.setState((st) => ({ sessions: { ...st.sessions, s_orphan: session('s_orphan') } }));
    expect(await releaseIdleDataSession('c_prod', 'none')).toBe(true);
    expect(closed).toEqual(['s_orphan']);
    expect(await releaseIdleDataSession('c_prod', 'none')).toBe(true);
    expect(closed).toEqual(['s_orphan', 's_b']);
  });

  it('leaves a tab with pending edits alone', async () => {
    const a = tab('a');
    own(a, session('s_a'));
    useEdits.getState().addInsert(dataGridKey(a), 2);
    expect(await releaseIdleDataSession('c_prod', 'none')).toBe(false);
    expect(closed).toEqual([]);
  });
});
