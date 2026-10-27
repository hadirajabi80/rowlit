// Closing a Data tab with pending edits: Save and close / Discard / Cancel (the same prompt as Close connection).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGridSaver } from '../../app/pendingGrids';
import { useEdits } from '../../store/edits';
import { useTabs, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { getTabView } from '../layout/tabViews';
import { registerGridCommands } from './commands';
import { dataGridKey } from './open';

const TAB: ViewTab = { kind: 'view', id: 'dt1', title: 'customers', view: 'data', connectionId: 'c_shop', database: null, state: { schema: 'main', name: 'customers', type: 'table' } };
let choice: ReturnType<typeof vi.fn>;
let confirm: ReturnType<typeof vi.fn>;
const offs: (() => void)[] = [];

beforeAll(() => registerGridCommands());
beforeEach(() => {
  useTabs.setState({ tabs: [TAB], activeId: TAB.id, mru: [], closed: [] });
  useEdits.setState({ buffers: {} });
  useUi.setState({ toasts: [] });
  choice = vi.fn(async () => 'ok');
  confirm = vi.fn(async () => true);
  useUi.setState({ askConfirm: confirm as never, askConfirmChoice: choice as never });
  useEdits.getState().addInsert(dataGridKey(TAB.id), 2);
});
afterEach(() => offs.splice(0).forEach((off) => off()));

const beforeClose = () => Promise.resolve(getTabView('data')!.beforeClose!(TAB));

describe('Data tab beforeClose', () => {
  it('nothing pending closes without asking', async () => {
    useEdits.getState().reset(dataGridKey(TAB.id));
    expect(await beforeClose()).toBe(true);
    expect(choice).not.toHaveBeenCalled();
  });

  it('Save and close saves through the tab, then closes', async () => {
    const save = vi.fn(async () => true);
    offs.push(registerGridSaver(dataGridKey(TAB.id), save));
    expect(await beforeClose()).toBe(true);
    expect(choice.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Save and close', altLabel: 'Discard', cancelLabel: 'Cancel' });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a save that fails keeps the tab open and says so', async () => {
    offs.push(registerGridSaver(dataGridKey(TAB.id), async () => false));
    expect(await beforeClose()).toBe(false);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('“customers” could not be saved') });
  });

  it('Discard closes without saving, Cancel keeps the tab', async () => {
    const save = vi.fn(async () => true);
    offs.push(registerGridSaver(dataGridKey(TAB.id), save));
    choice.mockResolvedValueOnce('alt');
    expect(await beforeClose()).toBe(true);
    choice.mockResolvedValueOnce('cancel');
    expect(await beforeClose()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('a tab nobody can save for (not mounted) offers Discard or Cancel only', async () => {
    confirm.mockResolvedValueOnce(false);
    expect(await beforeClose()).toBe(false);
    expect(choice).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Close and discard', danger: true });
  });
});
