// Executed-query commands of a result grid (console result set, Data tab): auto-loaded by commands/index.ts. They act
// on the grid named by `args.gridKey` (the query line under the grid passes it), else on the grid that last had focus.
// No shortcuts: Copy / Open in console are one click on the line under the grid.
import { lazy } from 'react';
import { registerCommands, type Command } from '../../commands/registry';
import type { ContextEntry } from '../../commands/menuModel';
import { displayShortcut } from '../../commands/keys';
import { isTabTarget } from '../../commands/types';
import { useSettings } from '../../store/settings';
import { toast } from '../../store/ui';
import { registerTabView } from '../layout/tabViews';
import {
  autoOpenFrom, clearEditDock, consoleOfResults, dockResultsBack, isEditConsole, openResultsInTab, RESULTS_VIEW, resultsTabOf, setResultsAutoOpen,
  setResultsDock, setResultsShown, type ResultsDock,
} from './dock';
import { copyExecutedQuery, executedQueryOf, hasBinds, openExecutedQueryInConsole } from './executedQuery';

export const RESULTS_QUERY_COMMANDS: Command<never>[] = [
  {
    id: 'results.copyQuery', title: 'Copy executed query', category: 'Query', icon: 'Copy',
    keywords: 'copy sql statement clipboard result grid inline parameters values',
    when: (a?: unknown) => !!executedQueryOf(a),
    run: (a?: unknown) => {
      const q = executedQueryOf(a);
      return q ? copyExecutedQuery(q) : undefined;
    },
  },
  {
    id: 'results.copyQueryWithParams', title: 'Copy executed query with parameters', category: 'Query', icon: 'Variable',
    keywords: 'copy sql statement clipboard bind placeholders',
    when: (a?: unknown) => {
      const q = executedQueryOf(a);
      return !!q && hasBinds(q);
    },
    run: (a?: unknown) => {
      const q = executedQueryOf(a);
      return q ? copyExecutedQuery(q, true) : undefined;
    },
  },
  {
    id: 'results.openQueryInConsole', title: 'Open executed query in console', category: 'Query', icon: 'SquareTerminal',
    keywords: 'new console tab edit sql statement result grid',
    when: (a?: unknown) => !!executedQueryOf(a),
    run: (a?: unknown) => {
      const q = executedQueryOf(a);
      return q ? openExecutedQueryInConsole(q) : undefined;
    },
  },
];

// ---------- the results pane's position (dock.ts): bottom / right / left / its own tab ----------

/** The console a dock command acts on: a tab target (the pane's header), else the active console (or the one behind a results tab). */
function consoleIdOf(args: unknown): string | null {
  return consoleOfResults(isTabTarget(args) ? args.tabId : null)?.id ?? null;
}

/** Docks the console's pane: remembers the position for its kind (query / "Edit:" consoles) and brings the pane back from a tab. */
function dockTo(args: unknown, dock: ResultsDock): void {
  const id = consoleIdOf(args);
  if (!id) return;
  setResultsDock(isEditConsole(id), dock);
  if (resultsTabOf(id)) dockResultsBack(id);
  setResultsShown(id, true);
}

const dockCommand = (id: string, dock: ResultsDock, title: string, icon: string): Command<never> => ({
  id, title, category: 'View', icon, keywords: 'results messages pane position move layout split side panel',
  when: (a?: unknown) => !!consoleIdOf(a),
  run: (a?: unknown) => dockTo(a, dock),
});

export const RESULTS_DOCK_COMMANDS: Command<never>[] = [
  dockCommand('results.dockBottom', 'bottom', 'Dock results at the bottom', 'PanelBottom'),
  dockCommand('results.dockRight', 'right', 'Dock results on the right', 'PanelRight'),
  dockCommand('results.dockLeft', 'left', 'Dock results on the left', 'PanelLeft'),
  {
    id: 'results.dockSame', title: 'Edit: consoles: same results position as query consoles', category: 'View', icon: 'PanelBottom', palette: false,
    when: (a?: unknown) => { const id = consoleIdOf(a); return !!id && isEditConsole(id); },
    run: () => clearEditDock(),
  },
  {
    id: 'results.openInTab', title: 'Open results in a new tab', category: 'View', icon: 'ExternalLink',
    keywords: 'results messages separate page window detach split',
    when: (a?: unknown) => { const id = consoleIdOf(a); return !!id && !resultsTabOf(id); },
    run: (a?: unknown) => {
      const id = consoleIdOf(a);
      if (id) openResultsInTab(id);
    },
  },
  {
    id: 'results.toggleAutoOpen', title: 'Toggle: open results automatically when a query runs', category: 'View', icon: 'PanelBottom',
    keywords: 'results messages pane auto open show run errors',
    run: () => {
      const on = !autoOpenFrom(useSettings.getState().settings.ui);
      setResultsAutoOpen(on);
      toast('info', on ? 'Results open automatically when a query runs' : 'Results stay closed when a query runs', on ? undefined : `Errors still open them; use the Results button or ${displayShortcut('Mod+R')}.`);
    },
  },
];

/** The results of a console in a tab of their own (lazy: loaded when the first one opens). */
const ResultsTabView = lazy(() => import('./ResultsTabView').then((m) => ({ default: m.ResultsTabView })));

export function registerResultsDockCommands(): void {
  registerCommands(RESULTS_DOCK_COMMANDS);
  // The tab shows a console's live results; another window has none of them, so it cannot be moved out of this one.
  registerTabView(RESULTS_VIEW, { component: ResultsTabView, icon: 'Rows3', detachable: false });
}

/** "…" / right-click menu of the query line under a result grid. */
export const RESULTS_QUERY_MENU: ContextEntry[] = [
  { command: 'results.copyQuery', label: 'Copy query' },
  { command: 'results.copyQueryWithParams', label: 'Copy with parameters', hideDisabled: true },
  'separator',
  { command: 'results.openQueryInConsole', label: 'Open in console' },
];

export function registerResultsQueryCommands(): void {
  registerCommands(RESULTS_QUERY_COMMANDS);
}
