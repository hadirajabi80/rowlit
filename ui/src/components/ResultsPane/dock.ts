// Where a console's results / messages pane lives and when it is open.
//
//   dock      bottom (default) | right | left of the editor, or "in a tab" (a `results` view tab that shows the console's
//             results and messages, so it can sit in a split editor group). Kept in settings.ui.resultsLayout: one
//             position for query consoles, and (optional) its own for F4 "Edit:" consoles, so a procedure's editor can
//             keep its results on the right while queries keep them at the bottom.
//   shown     ordinary consoles share one flag (View > Toggle results pane, store/ui `resultsVisible`); "Edit:" consoles
//             (procedures, functions, views, triggers) start with the pane hidden and open it per console, because
//             saving an object produces messages, not a result worth a quarter of the editor.
//   auto-open a run opens the pane unless the user turned "Open results automatically" off; an error always does.
//
// Pure helpers over the stores (no React component), importable from the console, the toolbar and the run code.
import { peekEditSession } from '../../designer/editSession';
import { useResults } from '../../store/results';
import { isRunning, type ExecMessage, type ExecutionState } from '../../store/resultsReducer';
import { useSettings } from '../../store/settings';
import { useTabs, type ConsoleTab, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';

export type ResultsDock = 'bottom' | 'right' | 'left';

export const RESULTS_DOCKS: readonly ResultsDock[] = ['bottom', 'right', 'left'];
export const RESULTS_DOCK_LABEL: Record<ResultsDock, string> = { bottom: 'Bottom', right: 'Right', left: 'Left' };
export const RESULTS_LAYOUT_KEY = 'resultsLayout';
/** The view id of the "results in a tab" page. */
export const RESULTS_VIEW = 'results';

interface StoredLayout {
  dock?: unknown;
  editDock?: unknown;
  autoOpen?: unknown;
}

function stored(ui: Record<string, unknown> | undefined): StoredLayout {
  const r = ui?.[RESULTS_LAYOUT_KEY];
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as StoredLayout) : {};
}

const asDock = (v: unknown): ResultsDock | null => (RESULTS_DOCKS as readonly unknown[]).includes(v) ? (v as ResultsDock) : null;

/** The dock of query consoles, or of "Edit:" consoles (their own when set, else the query consoles'). */
export function dockFrom(ui: Record<string, unknown> | undefined, edit: boolean): ResultsDock {
  const s = stored(ui);
  return (edit ? asDock(s.editDock) : null) ?? asDock(s.dock) ?? 'bottom';
}

/** Whether the "Edit:" consoles have their own position (the menu then marks it as theirs). */
export function hasEditDock(ui: Record<string, unknown> | undefined): boolean {
  return asDock(stored(ui).editDock) !== null;
}

export function autoOpenFrom(ui: Record<string, unknown> | undefined): boolean {
  return stored(ui).autoOpen !== false;
}

export function useResultsDock(edit: boolean): ResultsDock {
  return useSettings((s) => dockFrom(s.settings.ui, edit));
}

export function useResultsAutoOpen(): boolean {
  return useSettings((s) => autoOpenFrom(s.settings.ui));
}

function save(patch: StoredLayout): void {
  const cur = stored(useSettings.getState().settings.ui);
  useSettings.getState().update({ ui: { [RESULTS_LAYOUT_KEY]: { ...cur, ...patch } } });
}

/** Sets the position for query consoles, or for "Edit:" consoles (`edit`). */
export function setResultsDock(edit: boolean, dock: ResultsDock): void {
  save(edit ? { editDock: dock } : { dock });
}

/** Back to the query consoles' position for "Edit:" consoles. */
export function clearEditDock(): void {
  const cur = { ...stored(useSettings.getState().settings.ui) };
  delete cur.editDock;
  useSettings.getState().update({ ui: { [RESULTS_LAYOUT_KEY]: cur } });
}

export function setResultsAutoOpen(on: boolean): void {
  save({ autoOpen: on });
}

// ------------------------------------------------------------------------------------------------ kind and visibility

/** True for F4 "Edit:" consoles (procedure, function, view, trigger…). */
export function isEditConsole(tabId: string): boolean {
  return !!peekEditSession(tabId);
}

/** The console a results command acts on: the target tab, the console behind a results tab, else the active console. */
export function consoleOfResults(tabId: string | null | undefined): ConsoleTab | undefined {
  const s = useTabs.getState();
  const t = s.tabs.find((x) => x.id === (tabId ?? s.activeId));
  if (t?.kind === 'console') return t;
  if (t?.kind === 'view' && t.view === RESULTS_VIEW) {
    const id = (t.state as { consoleTabId?: string } | null)?.consoleTabId;
    const c = s.tabs.find((x) => x.id === id);
    return c?.kind === 'console' ? c : undefined;
  }
  return undefined;
}

export function resultsShownFor(tabId: string): boolean {
  const ui = useUi.getState();
  return isEditConsole(tabId) ? ui.tabResultsShown[tabId] ?? false : ui.resultsVisible;
}

export function useResultsShown(tabId: string, edit: boolean): boolean {
  return useUi((s) => (edit ? s.tabResultsShown[tabId] ?? false : s.resultsVisible));
}

export function setResultsShown(tabId: string, shown: boolean): void {
  const ui = useUi.getState();
  if (isEditConsole(tabId)) ui.setTabResultsShown(tabId, shown);
  else if (ui.resultsVisible !== shown) ui.toggle('resultsVisible');
}

/** Opens the pane of a console (and its Messages tab when asked); out of a results tab it brings that tab forward. */
export function showResults(tabId: string, view?: 'messages'): void {
  if (view) useResults.getState().setActiveView(tabId, view);
  const inTab = resultsTabOf(tabId);
  if (inTab) useTabs.getState().activate(inTab.id);
  else setResultsShown(tabId, true);
}

export function hideResults(tabId: string): void {
  setResultsShown(tabId, false);
}

export function toggleResultsFor(tabId: string): void {
  setResultsShown(tabId, !resultsShownFor(tabId));
}

// ------------------------------------------------------------------------------------------------------- results tab

/** The `results` view tab of a console, when its results were moved into a tab. */
export function resultsTabOf(consoleTabId: string): ViewTab | undefined {
  return useTabs.getState().tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === RESULTS_VIEW && (t.state as { consoleTabId?: string } | null)?.consoleTabId === consoleTabId);
}

export function useResultsTabId(consoleTabId: string): string | null {
  return useTabs((s) => {
    const t = s.tabs.find((x) => x.kind === 'view' && x.view === RESULTS_VIEW && (x.state as { consoleTabId?: string } | null)?.consoleTabId === consoleTabId);
    return t?.id ?? null;
  });
}

/** Moves the results and messages of a console into their own tab (one per console; the tab follows later runs). */
export function openResultsInTab(consoleTabId: string): string | null {
  const c = consoleOfResults(consoleTabId);
  if (!c) return null;
  useUi.getState().setResultsMaximized(false);
  return useTabs.getState().openView({
    view: RESULTS_VIEW, title: resultsTabTitle(c.title), connectionId: c.connectionId, database: c.database, state: { consoleTabId: c.id },
    key: `${RESULTS_VIEW}:${c.id}`,
  });
}

export const resultsTabTitle = (consoleTitle: string) => `Results: ${consoleTitle}`;

/** Puts the results back into their console (closes the results tab). */
export function dockResultsBack(consoleTabId: string): void {
  const t = resultsTabOf(consoleTabId);
  if (t) useTabs.getState().close(t.id);
  const c = consoleOfResults(consoleTabId);
  if (c) useTabs.getState().activate(c.id);
}

const SUMMARY_RE = /^(Completed|Cancelled|Finished with errors) in /;

/** What a finished run said (PRINT, NOTICE, warnings, errors): its messages without the run summary line ("Completed in 7 ms"). */
export function outputMessages(e: ExecutionState): ExecMessage[] {
  return e.messages.filter((m) => m.text.trim() && !(m.source === 'client' && m.batchIndex === null && SUMMARY_RE.test(m.text)));
}

// ---------------------------------------------------------------------------------------------------- run reveal

/**
 * Called when a run starts: opens the pane unless the user turned automatic opening off or the run is `quiet`
 * (saving an object: the caller shows its messages itself). A run that fails opens it either way, on Messages.
 */
export function revealResultsForRun(tabId: string, localId: string, quiet = false): void {
  if (!quiet && autoOpenFrom(useSettings.getState().settings.ui)) {
    if (!resultsTabOf(tabId)) setResultsShown(tabId, true);
    return;
  }
  let done = false; // showResults itself changes the store, which calls this again
  const check = (): boolean => {
    if (done) return true;
    const e = useResults.getState().executions[localId];
    if (!e) return true; // cleared
    if (isRunning(e)) return false;
    done = true;
    if (e.status === 'error' || e.errorCount > 0) showResults(tabId, 'messages');
    return true;
  };
  if (check()) return;
  const unsub = useResults.subscribe(() => {
    if (check()) unsub();
  });
}
