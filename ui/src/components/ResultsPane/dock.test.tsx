// The results / messages pane's position: bottom / right / left, its own tab, hidden; kept per console kind in
// settings.ui, "Edit:" consoles start with it hidden, runs open it unless "Open automatically" is off (errors always do).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommands } from '../../commands';
import { CONTEXT_MENUS, MENUS } from '../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../commands/registry';
import { useDesignerUi } from '../../designer/store';
import { isDetachable } from '../../app/detach';
import { useConnections } from '../../store/connections';
import { useResults } from '../../store/results';
import { createExecution } from '../../store/resultsReducer';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { installMockEngine } from '../../test/mockServer';
import { MenuHost } from '../common/Menu';
import { ConsoleView } from '../layout/ConsoleView';
import { getTabView } from '../layout/tabViews';
import { Toolbar } from '../Toolbar/Toolbar';
import {
  autoOpenFrom, dockFrom, hasEditDock, openResultsInTab, outputMessages, resultsTabOf, revealResultsForRun, setResultsAutoOpen, setResultsDock, setResultsShown,
} from './dock';
import { ResultsTabView } from './ResultsTabView';

vi.mock('../../editor/SqlEditor', () => ({
  SqlEditor: forwardRef(function SqlEditorStub() {
    return <div data-testid="sql-editor" />;
  }),
}));

const mock = installMockEngine({ frameDelay: 0 });
beforeAll(() => initCommands(), 60_000);

const consoleTab = (id = 't1', over: Partial<ConsoleTab> = {}): ConsoleTab => ({
  kind: 'console', id, title: `Console ${id}`, connectionId: 'c_shop', database: null, text: 'SELECT 1', savedText: '', filePath: null, txMode: 'auto', maxRows: null, ...over,
});

const ref = { database: null, schema: 'main', name: 'refresh_totals', type: 'proc' as const };
const makeEdit = (id: string) => useDesignerUi.getState().registerEdit(id, { connectionId: 'c_shop', database: null, ref, serverDdl: '', dialect: 'sqlite' });

function run(tabId: string, localId = 'l1') {
  act(() => {
    useResults.getState().begin(createExecution({
      localId, tabId, connectionId: 'c_shop', sessionId: null, label: 'statement', batches: [{ sql: 'SELECT 1', line: 1, col: 1 }], maxRows: 100,
    }));
  });
  return localId;
}

function finish(localId: string, status: 'ok' | 'error') {
  act(() => {
    useResults.setState((s) => ({ executions: { ...s.executions, [localId]: { ...s.executions[localId], status, errorCount: status === 'error' ? 1 : 0, endedAt: Date.now(), elapsedMs: 5 } } }));
  });
}

beforeEach(async () => {
  mock.reset();
  localStorage.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useUi.setState({ resultsVisible: true, resultsMaximized: false, tabResultsShown: {}, toasts: [] });
  useDesignerUi.setState({ edits: {}, editRunInFlight: {} });
  useResults.setState({ executions: {}, byTab: {}, activeView: {}, views: {} });
  useTabs.setState({ tabs: [consoleTab()], activeId: 't1', seq: 1, mru: [], closed: [] });
  await useConnections.getState().load();
});

afterEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
});

describe('the stored position', () => {
  it('defaults to the bottom; query consoles and "Edit:" consoles are kept apart; junk is ignored', () => {
    expect(dockFrom(DEFAULT_SETTINGS.ui, false)).toBe('bottom');
    setResultsDock(false, 'right');
    const ui = () => useSettings.getState().settings.ui;
    expect(dockFrom(ui(), false)).toBe('right');
    expect(dockFrom(ui(), true)).toBe('right'); // "Edit:" consoles follow until they get their own
    expect(hasEditDock(ui())).toBe(false);
    setResultsDock(true, 'left');
    expect(dockFrom(ui(), true)).toBe('left');
    expect(dockFrom(ui(), false)).toBe('right');
    expect(hasEditDock(ui())).toBe(true);
    expect(ui().resultsLayout).toEqual({ dock: 'right', editDock: 'left' });
    expect(dockFrom({ resultsLayout: { dock: 'diagonal', editDock: 7 } }, true)).toBe('bottom');
    expect(dockFrom({ resultsLayout: 'x' }, false)).toBe('bottom');
    expect(autoOpenFrom(DEFAULT_SETTINGS.ui)).toBe(true);
    setResultsAutoOpen(false);
    expect(autoOpenFrom(ui())).toBe(false);
    expect(ui().resultsLayout).toMatchObject({ dock: 'right', editDock: 'left', autoOpen: false });
  });
});

describe('what a run said', () => {
  it('outputMessages leaves out the run summary and blank lines, keeps PRINT output and errors', () => {
    const msg = (seq: number, text: string, over: object = {}) => ({ seq, ts: 0, severity: 'info', text, line: null, col: null, code: null, source: 'engine', batchIndex: 0, ...over });
    const e = { messages: [msg(1, 'Hello from PRINT'), msg(2, '  '), msg(3, 'Completed in 7 ms', { source: 'client', batchIndex: null }), msg(4, 'Invalid object', { severity: 'error', line: 3 })] };
    expect(outputMessages(e as never).map((m) => m.text)).toEqual(['Hello from PRINT', 'Invalid object']);
  });
});

describe('the layout of a console', () => {
  const split = (c: HTMLElement) => c.querySelector<HTMLElement>('.console-split')!;
  const order = (c: HTMLElement) => [...split(c).children].map((e) => (e.classList.contains('splitter') ? 'splitter' : [...e.classList].find((x) => x.endsWith('-host'))));

  it('bottom by default, then right and left: same editor element, results and splitter moved', () => {
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    expect(split(container).dataset.dock).toBe('bottom');
    expect(order(container)).toEqual(['editor-host', 'splitter', 'results-host']);
    expect(container.querySelector('.splitter')).toHaveAttribute('aria-orientation', 'horizontal');
    const editor = screen.getByTestId('sql-editor');

    act(() => setResultsDock(false, 'right'));
    expect(split(container).dataset.dock).toBe('right');
    expect(order(container)).toEqual(['editor-host', 'splitter', 'results-host']);
    expect(container.querySelector('.splitter')).toHaveAttribute('aria-orientation', 'vertical');

    act(() => setResultsDock(false, 'left'));
    expect(split(container).dataset.dock).toBe('left');
    expect(order(container)).toEqual(['results-host', 'splitter', 'editor-host']);
    // moving the pane does not rebuild the editor (its undo stack, cursor and scroll live in it)
    expect(screen.getByTestId('sql-editor')).toBe(editor);
  });

  it('the side width follows the per-console fraction, and the splitter resets it on double click', () => {
    setResultsDock(false, 'right');
    useUi.getState().setTabSplit('t1:w', 0.3);
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    expect(container.querySelector<HTMLElement>('.results-host')!.style.flexBasis).toBe('30%');
    expect(container.querySelector<HTMLElement>('.editor-host')!.style.flexBasis).toBe('70%');
    fireEvent.doubleClick(container.querySelector('.splitter')!);
    expect(useUi.getState().tabSplits['t1:w']).toBeUndefined();
    expect(container.querySelector<HTMLElement>('.results-host')!.style.flexBasis).toBe('45%');
  });

  it('the header has a visible × and a dock menu, even before the first run', () => {
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    const head = container.querySelector<HTMLElement>('.results-host')!;
    expect(within(head).getByRole('button', { name: 'Hide results' })).toBeTruthy();
    expect(within(head).getByRole('button', { name: 'Results position' })).toBeTruthy();
    fireEvent.click(within(head).getByRole('button', { name: 'Hide results' }));
    expect(container.querySelector('.results-host')).toBeNull();
    expect(container.querySelector('.splitter')).toBeNull();
    expect(useUi.getState().resultsVisible).toBe(false);
  });

  it('an "Edit:" console starts with the pane hidden and has its own position', () => {
    makeEdit('t1');
    setResultsDock(false, 'bottom');
    setResultsDock(true, 'right');
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    expect(container.querySelector('.results-host')).toBeNull();
    expect(split(container).dataset.dock).toBe('bottom'); // nothing docked while hidden
    act(() => setResultsShown('t1', true));
    expect(split(container).dataset.dock).toBe('right');
    expect(container.querySelector('.results-host')).not.toBeNull();
    expect(useUi.getState().resultsVisible).toBe(true); // the global flag of ordinary consoles is untouched
    act(() => setResultsShown('t1', false));
    expect(container.querySelector('.results-host')).toBeNull();
    expect(useUi.getState().resultsVisible).toBe(true);
  });

  it('maximize still fills the console whatever the dock', () => {
    setResultsDock(false, 'left');
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    act(() => useUi.getState().setResultsMaximized(true));
    expect(split(container)).toHaveClass('results-maximized');
  });
});

describe('the dock menu', () => {
  it('lists the positions of the console kind, marks the current one and runs the commands', () => {
    const { container } = render(<><ConsoleView tab={consoleTab()} theme="light" visible /><MenuHost /></>);
    fireEvent.click(container.querySelector('[data-testid="results-dock"]')!);
    const labels = [...document.querySelectorAll('.menu-label')].map((i) => i.textContent);
    expect(labels).toEqual(['Position in query consoles', 'Bottom', 'Right', 'Left', 'Open in a new tab', 'Hide results', 'Open results automatically when a query runs']);
    const row = (label: string) => screen.getByText(label).closest('[role^="menuitem"]')!;
    expect(row('Bottom')).toHaveAttribute('aria-checked', 'true');
    expect(row('Right')).toHaveAttribute('aria-checked', 'false');
    expect(row('Open results automatically when a query runs')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Right'));
    expect(dockFrom(useSettings.getState().settings.ui, false)).toBe('right');
    expect(container.querySelector<HTMLElement>('.console-split')!.dataset.dock).toBe('right');
  });

  it('in an "Edit:" console the choice is that kind\'s own', () => {
    makeEdit('t1');
    useUi.setState({ tabResultsShown: { t1: true } });
    const { container } = render(<><ConsoleView tab={consoleTab()} theme="light" visible /><MenuHost /></>);
    fireEvent.click(container.querySelector('[data-testid="results-dock"]')!);
    expect(screen.getByText('Position in Edit: consoles')).toBeTruthy();
    fireEvent.click(screen.getByText('Left'));
    const ui = useSettings.getState().settings.ui;
    expect(dockFrom(ui, true)).toBe('left');
    expect(dockFrom(ui, false)).toBe('bottom');
    // and it can go back to following the query consoles
    fireEvent.click(container.querySelector('[data-testid="results-dock"]')!);
    fireEvent.click(screen.getByText('Same position as query consoles'));
    expect(hasEditDock(useSettings.getState().settings.ui)).toBe(false);
  });

  it('the commands are in the palette and the View menu, and act on the active console', () => {
    for (const id of ['results.dockBottom', 'results.dockRight', 'results.dockLeft', 'results.openInTab', 'results.toggleAutoOpen']) expect(getCommand(id), id).toBeTruthy();
    const view = MENUS.find((m) => m.id === 'view')!.items.filter((i) => 'command' in i).map((i) => 'command' in i && i.command);
    expect(view).toEqual(expect.arrayContaining(['results.dockBottom', 'results.dockRight', 'results.dockLeft', 'results.openInTab']));
    expect(CONTEXT_MENUS).toBeTruthy();
    expect(isEnabled('results.dockRight')).toBe(true);
    runCommand('results.dockRight');
    expect(dockFrom(useSettings.getState().settings.ui, false)).toBe('right');
    useTabs.setState({ tabs: [], activeId: null });
    expect(isEnabled('results.dockRight')).toBe(false);
  });
});

describe('opening and hiding on a run', () => {
  it('a run opens a hidden pane (automatic opening is on by default)', () => {
    useUi.setState({ resultsVisible: false });
    const id = run('t1');
    revealResultsForRun('t1', id);
    expect(useUi.getState().resultsVisible).toBe(true);
  });

  it('with automatic opening off a run leaves it closed; an error opens it on Messages', () => {
    setResultsAutoOpen(false);
    useUi.setState({ resultsVisible: false });
    const id = run('t1');
    revealResultsForRun('t1', id);
    expect(useUi.getState().resultsVisible).toBe(false);
    finish(id, 'ok');
    expect(useUi.getState().resultsVisible).toBe(false);

    const id2 = run('t1', 'l2');
    revealResultsForRun('t1', id2);
    useResults.getState().setActiveView('t1', 0);
    finish(id2, 'error');
    expect(useUi.getState().resultsVisible).toBe(true);
    expect(useResults.getState().activeView.t1).toBe('messages');
  });

  it('a quiet run (saving an object) leaves an "Edit:" console\'s pane closed unless it fails', () => {
    makeEdit('t1');
    const id = run('t1');
    revealResultsForRun('t1', id, true);
    finish(id, 'ok');
    expect(useUi.getState().tabResultsShown.t1 ?? false).toBe(false);
    const id2 = run('t1', 'l2');
    revealResultsForRun('t1', id2, true);
    finish(id2, 'error');
    expect(useUi.getState().tabResultsShown.t1).toBe(true);
  });

  it('a normal run of an "Edit:" console opens its pane', () => {
    makeEdit('t1');
    const id = run('t1');
    revealResultsForRun('t1', id);
    expect(useUi.getState().tabResultsShown.t1).toBe(true);
  });

  it('Toggle results pane acts on the console in front: an "Edit:" console keeps its own flag', () => {
    makeEdit('t1');
    runCommand('view.toggleResults');
    expect(useUi.getState().tabResultsShown.t1).toBe(true);
    expect(useUi.getState().resultsVisible).toBe(true);
    runCommand('view.toggleResults');
    expect(useUi.getState().tabResultsShown.t1).toBe(false);
    useTabs.setState({ tabs: [consoleTab('t2')], activeId: 't2' });
    runCommand('view.toggleResults');
    expect(useUi.getState().resultsVisible).toBe(false);
  });

  it('the toolbar button reflects it, with a dot when output is waiting', () => {
    useUi.setState({ resultsVisible: false });
    const { container, rerender } = render(<Toolbar tab={consoleTab()} />);
    const btn = () => container.querySelector<HTMLButtonElement>('[data-command="view.toggleResults"]')!;
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    expect(btn().querySelector('.tb-results-dot')).toBeNull();
    run('t1');
    rerender(<Toolbar tab={consoleTab()} />);
    expect(btn().querySelector('.tb-results-dot')).not.toBeNull();
    expect(btn()).toHaveAccessibleName('Show results, there is output');
    fireEvent.click(btn());
    expect(useUi.getState().resultsVisible).toBe(true);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('results in their own tab', () => {
  const tabs = () => useTabs.getState().tabs;

  it('opens one tab per console that shows the console\'s latest results; the console says so and keeps the editor', () => {
    run('t1');
    const id = openResultsInTab('t1')!;
    expect(id).toBeTruthy();
    const t = tabs().find((x) => x.id === id)!;
    expect(t).toMatchObject({ kind: 'view', view: 'results', title: 'Results: Console t1', connectionId: 'c_shop', state: { consoleTabId: 't1' } });
    expect(openResultsInTab('t1')).toBe(id); // the same tab again
    expect(resultsTabOf('t1')?.id).toBe(id);

    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    expect(container.querySelector('.results-host')).toBeNull();
    expect(container.querySelector('.results-elsewhere')).not.toBeNull();
    expect(screen.getByTestId('sql-editor')).toBeTruthy();
    // a run while it is a tab does not open the console's pane
    useUi.setState({ resultsVisible: false });
    revealResultsForRun('t1', 'l1');
    expect(useUi.getState().resultsVisible).toBe(false);
  });

  it('"Dock here" and closing the tab bring the pane back', () => {
    const id = openResultsInTab('t1')!;
    const { container } = render(<ConsoleView tab={consoleTab()} theme="light" visible />);
    fireEvent.click(screen.getByRole('button', { name: 'Dock here' }));
    expect(tabs().some((x) => x.id === id)).toBe(false);
    expect(container.querySelector('.results-host')).not.toBeNull();
    expect(container.querySelector('.results-elsewhere')).toBeNull();
    expect(useTabs.getState().activeId).toBe('t1');
  });

  it('the results tab page: the same pane with a dock menu and no ×, it follows new runs, and closes with its console', () => {
    run('t1');
    const id = openResultsInTab('t1')!;
    const tab = tabs().find((x) => x.id === id) as Extract<ReturnType<typeof tabs>[number], { kind: 'view' }>;
    const { container } = render(<><ResultsTabView tab={tab} theme="light" visible /><MenuHost /></>);
    expect(screen.getByRole('tablist', { name: 'Results' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hide results' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Maximize results' })).toBeNull();
    // the dock menu docks it back at the chosen side
    fireEvent.click(container.querySelector('[data-testid="results-dock"]')!);
    expect(screen.getByText('Open in a new tab').closest('[role^="menuitem"]')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('Hide results')).toBeNull();
    fireEvent.click(screen.getByText('Right'));
    expect(tabs().some((x) => x.id === id)).toBe(false);
    expect(dockFrom(useSettings.getState().settings.ui, false)).toBe('right');
    expect(useUi.getState().resultsVisible).toBe(true);

    // a results tab whose console is gone closes itself
    const id2 = openResultsInTab('t1')!;
    const tab2 = tabs().find((x) => x.id === id2) as typeof tab;
    render(<ResultsTabView tab={tab2} theme="light" visible />);
    act(() => useTabs.setState({ tabs: tabs().filter((x) => x.id !== 't1') }));
    expect(tabs().some((x) => x.id === id2)).toBe(false);
  });

  it('is a tab view of this window only: it can sit in any group but cannot be moved to another window', () => {
    expect(getTabView('results')).toMatchObject({ detachable: false });
    const id = openResultsInTab('t1')!;
    expect(isDetachable(id)).toBe(false);
    expect(isDetachable('t1')).toBe(true);
    expect(isEnabled('view.openInNewWindow', { kind: 'tab', tabId: id })).toBe(false);
  });
});
