// What an update restart (or a quit) would lose: unsaved grid edits of tabs that are still open, and open transactions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataGridKey } from '../components/DataTab/open';
import { useEdits } from '../store/edits';
import { useSessions } from '../store/sessions';
import { useTabs, type ConsoleTab } from '../store/tabs';
import { useUi } from '../store/ui';
import { describeUnsavedWork, unsavedWork } from './unsavedWork';
import { restartToUpdate } from './updates';

const platform = vi.hoisted(() => ({ quitAndInstall: vi.fn(async () => true) }));
vi.mock('../platform', async (orig) => ({ ...(await orig<typeof import('../platform')>()), getPlatform: () => ({ ...(platformBase()), ...platform }) }));
function platformBase() {
  return { appVersion: '1.0.0', showNotification: undefined };
}

function consoleTab(id: string): ConsoleTab {
  return { kind: 'console', id, title: id, connectionId: null, database: null, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null };
}

describe('unsaved work', () => {
  beforeEach(() => {
    useEdits.setState({ buffers: {}, activeGrid: null });
    useSessions.setState({ sessions: {}, byTab: {} });
    useTabs.setState({ tabs: [consoleTab('t1')], activeId: 't1', mru: [], closed: [] });
    useUi.setState({ confirm: null });
    platform.quitAndInstall.mockClear();
  });

  it('is empty when nothing is pending', () => {
    expect(unsavedWork()).toEqual({ pendingGrids: 0, openTransactions: 0 });
    expect(describeUnsavedWork()).toBeNull();
  });

  it('counts grids with unsubmitted edits of open tabs only, and open transactions', () => {
    useEdits.getState().setCell(dataGridKey('t1'), 0, 1, 'x', 'y');
    useEdits.getState().setCell(dataGridKey('closed-tab'), 0, 1, 'x', 'y'); // its tab is gone: not counted
    useSessions.setState({
      sessions: {
        s1: { sessionId: 's1', txOpen: true } as never,
        s2: { sessionId: 's2', txOpen: false } as never,
        s3: { sessionId: 's3', txOpen: true, released: true } as never,
      },
    });
    expect(unsavedWork()).toEqual({ pendingGrids: 1, openTransactions: 1 });
    expect(describeUnsavedWork()).toBe('1 unsaved edit in 1 grid and an open transaction');
  });

  it('Restart to update asks first when something would be lost, and restarts only after a yes', async () => {
    useEdits.getState().setCell(dataGridKey('t1'), 0, 1, 'x', 'y');
    const p = restartToUpdate();
    await vi.waitFor(() => expect(useUi.getState().confirm?.title).toBe('Restart Rowlit to update?'));
    expect(useUi.getState().confirm?.danger).toBe(true);
    expect(platform.quitAndInstall).not.toHaveBeenCalled();
    useUi.getState().resolveConfirm(false);
    await p;
    expect(platform.quitAndInstall).not.toHaveBeenCalled();

    const q = restartToUpdate();
    await vi.waitFor(() => expect(useUi.getState().confirm).not.toBeNull());
    useUi.getState().resolveConfirm(true);
    await q;
    expect(platform.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('Restart to update goes straight ahead when nothing would be lost', async () => {
    await restartToUpdate();
    expect(useUi.getState().confirm).toBeNull();
    expect(platform.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
