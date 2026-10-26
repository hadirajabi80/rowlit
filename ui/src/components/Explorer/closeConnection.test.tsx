// Explorer side of "Close connection" / "Close database" (docs/resources.md): the node folds up, its catalog is dropped
// and nothing reloads it until the user expands it again (the lazy loads used to bring the connection straight back).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../api/client';
import { closeDatabase, disconnectConnection } from '../../app/actions';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { resetOwnSessionsForTests, useSessions } from '../../store/sessions';
import { useTabs } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { Explorer, useExplorer } from './Explorer';

const mock = installMockEngine();

const row = (label: string) => screen.getAllByRole('treeitem').find((el) => el.querySelector('.tree-label')?.textContent === label);
async function expand(label: string) {
  const r = await waitFor(() => {
    const el = row(label);
    if (!el) throw new Error(`row ${label} not found`);
    return el;
  });
  fireEvent.click(r.querySelector('.tree-twisty')!);
}
const settle = (ms = 300) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe('Explorer after Close connection / Close database', () => {
  beforeEach(async () => {
    mock.reset();
    localStorage.clear();
    resetOwnSessionsForTests();
    useExplorer.setState({ expanded: new Set(), collapsedFolders: new Set(), filter: '', selected: null });
    useCatalog.setState({ conns: {}, dbs: {}, closed: {} });
    useSessions.setState({ sessions: {}, byTab: {} });
    useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
    useTabs.setState({ tabs: [], activeId: null, seq: 0 });
    await useConnections.getState().load();
  });

  it('Close connection folds the node up, drops the catalog and does not reload it with a console open on it', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    // a console of the connection holds a session
    const s = await act(() => api.createSession({ connectionId: 'c_prod', database: 'Shop', txMode: 'auto', captureServerOutput: false }));
    useSessions.getState().upsert(s, 't_con');
    expect(mock.hits('/catalog/databases')).toHaveLength(1);

    await act(() => disconnectConnection('c_prod'));
    await settle(500);
    expect(useExplorer.getState().expanded.has('c:c_prod')).toBe(false);
    expect(row('Shop')).toBeUndefined();
    expect(useCatalog.getState().conns.c_prod).toBeUndefined();
    expect(useCatalog.getState().closed.c_prod).toBe(true);
    expect(useSessions.getState().sessions[s.sessionId].released).toBe(true);
    // nothing asked the engine for the catalog again
    expect(mock.hits('/catalog/databases')).toHaveLength(1);
    expect(mock.hits('/catalog/schemas')).toHaveLength(0);

    // expanding it again is the user's choice: it loads and the closed mark clears
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    expect(mock.hits('/catalog/databases')).toHaveLength(2);
    expect(useCatalog.getState().closed.c_prod).toBeUndefined();
  });

  it('Close database folds up only that database and keeps the rest of the tree loaded', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    await expand('Shop');
    await waitFor(() => expect(row('dbo')).toBeDefined());
    const schemaHits = mock.hits('/catalog/schemas').length;

    await act(() => closeDatabase('c_prod', 'Shop'));
    await settle(500);
    expect(useExplorer.getState().expanded.has('d:c_prod:Shop')).toBe(false);
    expect(row('Prod SQL')).toBeDefined();
    expect(row('master')).toBeDefined();
    expect(row('dbo')).toBeUndefined();
    expect(Object.keys(useCatalog.getState().dbs)).toEqual([]);
    expect(mock.hits('/catalog/schemas')).toHaveLength(schemaHits); // no reload

    await expand('Shop');
    await waitFor(() => expect(row('dbo')).toBeDefined());
    expect(mock.hits('/catalog/schemas')).toHaveLength(schemaHits + 1);
  });

  it('catalog.changed and other automatic loads leave a closed connection alone', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    await act(() => disconnectConnection('c_prod'));
    useCatalog.setState({ dbs: { [`c_prod\u0001Shop`]: { connectionId: 'c_prod', database: 'Shop', schemasStatus: 'ready', loaded: {}, schemaStatus: {} } as never } });
    mock.ctx.requests.length = 0;
    act(() => useCatalog.getState().applyChanged({ type: 'catalog.changed', connectionId: 'c_prod', database: 'Shop', schemas: [], version: 2 } as never));
    await settle();
    expect(mock.ctx.requests.filter((r) => r.url.pathname.includes('/catalog'))).toEqual([]);
  });
});
