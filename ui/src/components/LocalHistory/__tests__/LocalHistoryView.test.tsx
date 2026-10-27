// The history view over the MSW mock engine, with the Monaco diff replaced by a probe that exposes its two texts.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommands } from '../../../commands';
import { getCommand, runCommand } from '../../../commands/registry';
import { until } from '../../../mocks/m15/testServer';
import { localHistoryStore } from '../../../mocks/localHistory';
import { DEFAULT_SETTINGS, useSettings } from '../../../store/settings';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import { installMockEngine } from '../../../test/mockServer';
import { localHistoryApi } from '../api';
import { stopLocalHistoryCapture } from '../capture';
import { historyKeys } from '../keys';
import { LocalHistoryView } from '../LocalHistoryView';
import { LOCAL_HISTORY_VIEW } from '../open';

vi.mock('../SnapshotDiff', () => ({
  default: (p: { snapshot: string; current: string }) => <div data-testid="diff" data-snapshot={p.snapshot} data-current={p.current} />,
}));

const mock = installMockEngine();

let tabId: string;

async function seed(key: string, items: { text: string; reason?: 'run' | 'save' | 'auto'; label?: string }[]) {
  for (const i of items) await localHistoryApi.add({ key, text: i.text, reason: i.reason ?? 'run', label: i.label, title: 'Console 1' });
}

function open(): ViewTab {
  const id = runCommand('editor.localHistory', { tabId });
  void id;
  return useTabs.getState().tabs.find((t) => t.kind === 'view' && t.view === LOCAL_HISTORY_VIEW) as ViewTab;
}

const diff = () => screen.getByTestId('diff');

beforeEach(async () => {
  await initCommands();
  stopLocalHistoryCapture(); // the tests drive the store themselves
  localHistoryStore(mock.ctx.engine).length = 0;
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useTabs.setState({ tabs: [], activeId: null, mru: [], closed: [] });
  tabId = useTabs.getState().newConsole({ connectionId: 'c_shop', database: null });
  useTabs.getState().updateText(tabId, 'select * from orders where total > 100');
});
afterEach(() => {
  cleanup();
  useUi.setState({ confirm: null });
});

describe('Local history command', () => {
  it('is registered with Ctrl+Alt+H, only enabled for a console, and opens one tab per editor', () => {
    const c = getCommand('editor.localHistory')!;
    expect(c.shortcut).toBe('Mod+Alt+H');
    expect(c.when?.({ tabId })).toBe(true);
    expect(c.when?.({ tabId: 'nope' })).toBe(false);
    const view = open();
    expect(view.state).toMatchObject({ tabId, keys: [`t:${tabId}`], title: 'Console 1' });
    open();
    expect(useTabs.getState().tabs.filter((t) => t.kind === 'view' && t.view === LOCAL_HISTORY_VIEW)).toHaveLength(1);
  });
});

describe('LocalHistoryView', () => {
  it('shows an explanation when nothing was stored yet', async () => {
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    expect(await screen.findByText('No snapshots yet.')).toBeInTheDocument();
  });

  it('lists the snapshots newest first and diffs the selected one against the current text', async () => {
    await seed(`t:${tabId}`, [{ text: 'select 1', reason: 'run' }, { text: 'select * from orders', reason: 'save' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    const opts = await screen.findAllByRole('option');
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveTextContent('Save');
    expect(opts[1]).toHaveTextContent('Run');
    await until(() => !!screen.queryByTestId('diff'));
    expect(diff()).toHaveAttribute('data-snapshot', 'select * from orders');
    expect(diff()).toHaveAttribute('data-current', 'select * from orders where total > 100');

    fireEvent.click(opts[1]);
    await until(() => screen.queryByTestId('diff')?.getAttribute('data-snapshot') === 'select 1');
  });

  it('ArrowDown walks to the next older snapshot', async () => {
    await seed(`t:${tabId}`, [{ text: 'one' }, { text: 'two' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => screen.queryByTestId('diff')?.getAttribute('data-snapshot') === 'two');
    fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'ArrowDown' });
    await until(() => screen.queryByTestId('diff')?.getAttribute('data-snapshot') === 'one');
  });

  it('unions the snapshots of every key of the editor (a console that became a file)', async () => {
    useTabs.getState().markSaved(tabId, 'C:\\sql\\report.sql', 'report.sql');
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId)!;
    expect(historyKeys(tab as never)).toEqual(['f:C:\\sql\\report.sql', `t:${tabId}`]);
    await seed(`t:${tabId}`, [{ text: 'before it was a file' }]);
    await seed('f:C:\\sql\\report.sql', [{ text: 'after', reason: 'save' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    expect(await screen.findAllByRole('option')).toHaveLength(2);
  });

  it('Restore puts the snapshot into the editor and keeps the text it replaced in the history', async () => {
    await seed(`t:${tabId}`, [{ text: 'select 42' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => !!screen.queryByTestId('diff'));
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await until(() => (useTabs.getState().tabs.find((t) => t.id === tabId) as { text: string }).text === 'select 42');
    await until(() => screen.queryAllByRole('option').length === 2);
    const texts = localHistoryStore(mock.ctx.engine).map((s) => [s.text, s.reason]);
    expect(texts).toContainEqual(['select * from orders where total > 100', 'restore']);
    // the restored snapshot equals the editor now: nothing left to restore
    await until(() => screen.queryByText(/identical to the text in the editor/) !== null || screen.getByRole('button', { name: /Restore/ }).hasAttribute('disabled'));
  });

  it('labels and unlabels a snapshot', async () => {
    await seed(`t:${tabId}`, [{ text: 'select 1' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => !!screen.queryByTestId('diff'));
    fireEvent.click(screen.getByRole('button', { name: /Label/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'v1 release' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save label' }));
    await until(() => screen.queryAllByRole('option')[0]?.textContent?.includes('v1 release') === true);
    expect(localHistoryStore(mock.ctx.engine)[0].label).toBe('v1 release');

    fireEvent.click(screen.getByRole('button', { name: /Label/ }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear label' }));
    await until(() => localHistoryStore(mock.ctx.engine)[0].label === null);
  });

  it('deletes one snapshot and selects its neighbour', async () => {
    await seed(`t:${tabId}`, [{ text: 'one' }, { text: 'two' }, { text: 'three' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => screen.queryByTestId('diff')?.getAttribute('data-snapshot') === 'three');
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await until(() => screen.queryAllByRole('option').length === 2);
    await until(() => screen.queryByTestId('diff')?.getAttribute('data-snapshot') === 'two');
    expect(localHistoryStore(mock.ctx.engine).map((s) => s.text)).toEqual(['one', 'two']);
  });

  it('Clear history asks first and then removes everything of the editor', async () => {
    await seed(`t:${tabId}`, [{ text: 'one' }, { text: 'two' }]);
    await seed('t:other', [{ text: 'not mine' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => screen.queryAllByRole('option').length === 2);
    fireEvent.click(screen.getByRole('button', { name: /Clear history/ }));
    await until(() => useUi.getState().confirm !== null);
    expect(useUi.getState().confirm?.danger).toBe(true);
    useUi.getState().resolveConfirm(true);
    await screen.findByText('No snapshots yet.');
    expect(localHistoryStore(mock.ctx.engine).map((s) => s.key)).toEqual(['t:other']);
  });

  it('cancelling the confirmation keeps the history', async () => {
    await seed(`t:${tabId}`, [{ text: 'one' }]);
    render(<LocalHistoryView tab={open()} theme="light" visible />);
    await until(() => screen.queryAllByRole('option').length === 1);
    fireEvent.click(screen.getByRole('button', { name: /Clear history/ }));
    await until(() => useUi.getState().confirm !== null);
    useUi.getState().resolveConfirm(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(localHistoryStore(mock.ctx.engine)).toHaveLength(1);
  });

  it('tells that history is off, and that a closed editor can only be read', async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: { localHistory: false } } });
    await seed(`t:${tabId}`, [{ text: 'old' }]);
    const view = open();
    useTabs.getState().close(tabId);
    render(<LocalHistoryView tab={view} theme="light" visible />);
    expect(await screen.findByText(/turned off/)).toBeInTheDocument();
    expect(screen.getByText(/editor was closed/)).toBeInTheDocument();
    await until(() => !!screen.queryByTestId('diff'));
    expect(screen.getByRole('button', { name: /Restore/ })).toBeDisabled();
    expect(within(screen.getByTestId('local-history')).getByRole('button', { name: /Copy/ })).toBeEnabled();
  });
});
