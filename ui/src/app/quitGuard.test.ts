// Quit / close guard, renderer side: the report main asks for, and the danger confirmation it shows for every window.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataGridKey } from '../components/DataTab/open';
import { setPlatform, type Platform } from '../platform';
import type { DiscardRequest, UnsavedWorkReport } from '../platform/bridge';
import { useConnections } from '../store/connections';
import { useEdits } from '../store/edits';
import { resetOwnSessionsForTests, useSessions } from '../store/sessions';
import { useTabs, type ConsoleTab } from '../store/tabs';
import { useUi } from '../store/ui';
import { confirmDiscard, wireQuitGuard } from './quitGuard';
import { describeUnsavedWork } from './unsavedWork';

function consoleTab(id: string): ConsoleTab {
  return { kind: 'console', id, title: id, connectionId: 'c1', database: null, text: '', savedText: '', filePath: null, txMode: 'manual', maxRows: null };
}

const work = (w: Partial<UnsavedWorkReport>): UnsavedWorkReport => ({ grids: 0, edits: 0, transactions: [], ...w });
const req = (w: Partial<UnsavedWorkReport>, reason: DiscardRequest['reason'] = 'quit', windows = 1): DiscardRequest => ({ reason, work: work(w), windows });

describe('quit guard (renderer)', () => {
  let query: (() => unknown) | null;
  let confirm: ((r: DiscardRequest) => unknown) | null;
  let unwire: () => void;

  beforeEach(() => {
    useEdits.setState({ buffers: {}, activeGrid: null });
    useSessions.setState({ sessions: {}, byTab: {} });
    useTabs.setState({ tabs: [consoleTab('t1'), consoleTab('t2')], activeId: 't1', mru: [], closed: [] });
    useConnections.setState({ connections: [{ id: 'c1', name: 'Prod' }, { id: 'c2', name: 'Dev' }] as never });
    useUi.setState({ confirm: null });
    resetOwnSessionsForTests(['s1', 's2']);
    query = null;
    confirm = null;
    setPlatform({
      kind: 'electron',
      appVersion: '1.0.0',
      onUnsavedWorkQuery: (cb: () => unknown) => { query = cb; return () => { query = null; }; },
      onConfirmDiscard: (cb: (r: DiscardRequest) => unknown) => { confirm = cb; return () => { confirm = null; }; },
    } as unknown as Platform);
    unwire = wireQuitGuard();
  });

  afterEach(() => {
    unwire();
    setPlatform(null);
    resetOwnSessionsForTests();
  });

  it('answers main with this window\'s grids, row edits and open transactions (named; other windows\' sessions left out)', () => {
    expect(query).toBeTypeOf('function');
    expect(query!()).toEqual({ grids: 0, edits: 0, transactions: [] });
    useEdits.getState().setCell(dataGridKey('t1'), 0, 1, 'x', 'y');
    useEdits.getState().setCell(dataGridKey('t1'), 1, 1, 'x', 'y');
    useEdits.getState().setCell(dataGridKey('t2'), 0, 2, 'a', 'b');
    useEdits.getState().setCell(dataGridKey('gone'), 0, 2, 'a', 'b'); // its tab is closed: not counted
    useSessions.setState({
      sessions: {
        s1: { sessionId: 's1', connectionId: 'c1', txOpen: true } as never,
        s2: { sessionId: 's2', connectionId: 'c2', txOpen: false } as never,
        s3: { sessionId: 's3', connectionId: 'c2', txOpen: true, orphan: false } as never, // another window's
      },
    });
    expect(query!()).toEqual({ grids: 2, edits: 3, transactions: [{ sessionId: 's1', connection: 'Prod' }] });
  });

  it('wiring twice registers once; unwiring removes the handlers', () => {
    expect(wireQuitGuard()()).toBeUndefined();
    unwire();
    expect(query).toBeNull();
    expect(confirm).toBeNull();
    unwire = wireQuitGuard();
    expect(query).toBeTypeOf('function');
  });

  it('quit: a danger confirmation (Cancel focused) naming what is lost; Cancel answers false', async () => {
    const p = confirm!(req({ grids: 2, edits: 5, transactions: [{ sessionId: 's1', connection: 'Prod' }] })) as Promise<boolean>;
    await vi.waitFor(() => expect(useUi.getState().confirm).not.toBeNull());
    const c = useUi.getState().confirm!;
    expect(c.title).toBe('Quit Rowlit?');
    expect(c.danger).toBe(true);
    expect(c.confirmLabel).toBe('Discard and quit');
    expect(c.cancelLabel).toBe('Cancel');
    expect(c.message).toBe('You have 5 unsaved edits in 2 grids and an open transaction on Prod. If you quit now, the edits are discarded and the transaction is rolled back. Your consoles are kept.');
    useUi.getState().resolveConfirm(false);
    await expect(p).resolves.toBe(false);
  });

  it('quit: confirming answers true', async () => {
    const p = confirmDiscard(req({ grids: 1, edits: 1 }));
    await vi.waitFor(() => expect(useUi.getState().confirm).not.toBeNull());
    useUi.getState().resolveConfirm(true);
    await expect(p).resolves.toBe(true);
  });

  it('closing a window, and work spread over several windows', async () => {
    const p = confirmDiscard(req({ transactions: [{ sessionId: 'a', connection: 'Prod' }, { sessionId: 'b', connection: 'Dev' }] }, 'close-window', 2));
    await vi.waitFor(() => expect(useUi.getState().confirm).not.toBeNull());
    const c = useUi.getState().confirm!;
    expect(c.title).toBe('Close this window?');
    expect(c.confirmLabel).toBe('Discard and close');
    expect(c.message).toBe('You have 2 open transactions on Prod and Dev (in all windows). If you close the window now, the transactions are rolled back.');
    useUi.getState().resolveConfirm(false);
    await expect(p).resolves.toBe(false);
  });

  it('nothing to lose: goes on without a dialog', async () => {
    await expect(confirmDiscard(req({}))).resolves.toBe(true);
    expect(useUi.getState().confirm).toBeNull();
  });

  it('describes many connections briefly', () => {
    const tx = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ sessionId: `s${i}`, connection: n }));
    expect(describeUnsavedWork(work({ transactions: tx }))).toBe('5 open transactions on A, B, C and 2 more');
    expect(describeUnsavedWork(work({ transactions: [{ sessionId: 'x', connection: '' }] }))).toBe('an open transaction');
    expect(describeUnsavedWork(work({ grids: 1, edits: 1 }))).toBe('1 unsaved edit in 1 grid');
  });
});
