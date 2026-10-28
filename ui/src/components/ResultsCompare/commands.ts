// Pinned results and result comparison (WP-7), auto-loaded by commands/index.ts. The view is a lazy chunk (views.tsx);
// this file, pin.ts, open.ts and sources.ts stay small because the result toolbar and the palette use them eagerly.
//   results.pin       Mod+Alt+K   pin the shown result (a run of the console no longer replaces it) / unpin it
//   results.compare               compare the shown result with another result set or a pinned result
// Mod+Alt+P is the query parameters dialog, so pin takes K.
import { registerCommands, type Command } from '../../commands/registry';
import { isTabTarget } from '../../commands/types';
import { useResults } from '../../store/results';
import { useTabs } from '../../store/tabs';
import { showContextMenu } from '../common/Menu';
import { registerTabView } from '../layout/tabViews';
import { COMPARE_VIEW, type CompareTabState } from './open';
import { compareMenu } from './compareMenu';
import { togglePin, type ShownResult } from './pin';
import { releaseComparison } from './sources';
import { ResultsCompareTab } from './views';

interface PinArgs {
  /** The console (or results tab) to act on; default: the active one. */
  tabId?: string;
}
const argsOf = (a?: unknown): PinArgs => (a && typeof a === 'object' && !isTabTarget(a) ? (a as PinArgs) : {});

/**
 * The console a results command acts on: the target tab, the console behind a results tab (view "results", see
 * ResultsPane/dock.ts consoleOfResults; not imported from there so this module stays out of that chunk), else the active one.
 */
function consoleIdOf(tabId: string | undefined): string | null {
  const s = useTabs.getState();
  const t = s.tabs.find((x) => x.id === (tabId ?? s.activeId));
  if (t?.kind === 'console') return t.id;
  if (t?.kind === 'view' && t.view === 'results') {
    const id = (t.state as { consoleTabId?: string } | null)?.consoleTabId;
    return s.tabs.some((x) => x.id === id && x.kind === 'console') ? id ?? null : null;
  }
  return null;
}

/** The console and what its results pane shows: a result set of the latest run, or a pinned result. */
function shown(a?: unknown): ({ tabId: string } & ShownResult) | null {
  const id = consoleIdOf(isTabTarget(a) ? a.tabId : argsOf(a).tabId);
  if (!id) return null;
  const v = useResults.getState().activeView[id];
  if (typeof v === 'number') return { tabId: id, rsId: v };
  if (typeof v === 'string' && v.startsWith('pin:')) return { tabId: id, pinId: v.slice(4) };
  return null;
}

export const RESULTS_COMPARE_COMMANDS: Command<never>[] = [
  {
    id: 'results.pin', title: 'Pin result (keep it when the query runs again)', category: 'Grid', icon: 'Pin', shortcut: 'Mod+Alt+K',
    keywords: 'pin unpin keep result tab freeze compare snapshot',
    when: (a?: unknown) => !!shown(a),
    run: (a?: unknown) => {
      const s = shown(a);
      if (s) togglePin(s.tabId, s);
    },
  },
  {
    id: 'results.compare', title: 'Compare result with…', category: 'Grid', icon: 'GitCompare',
    keywords: 'compare diff result sets pinned differences rows',
    when: (a?: unknown) => !!shown(a),
    run: (a?: unknown) => {
      const s = shown(a);
      if (!s) return;
      const r = (document.querySelector('[data-region="results"], .results') ?? document.body).getBoundingClientRect();
      showContextMenu({ clientX: r.left + Math.min(240, r.width / 3), clientY: r.top + 60 }, compareMenu(s.tabId, s));
    },
  },
];

/** Pinned results go with their console (closed, or moved to another window): whatever way the tab left. */
function dropPinsOfClosedTabs(): void {
  const { pinned } = useResults.getState();
  const open = new Set(useTabs.getState().tabs.map((t) => t.id));
  for (const tabId of Object.keys(pinned)) if (!open.has(tabId)) useResults.getState().dropPins(tabId);
}

let wired = false;

export function registerResultsCompareCommands(): void {
  registerCommands(RESULTS_COMPARE_COMMANDS);
  if (!wired) {
    wired = true;
    useTabs.subscribe((s, prev) => {
      if (s.tabs !== prev.tabs) dropPinsOfClosedTabs();
    });
  }
  // The snapshots live in this window's memory: the tab cannot move to another one.
  registerTabView(COMPARE_VIEW, {
    component: ResultsCompareTab, icon: 'GitCompare', detachable: false,
    onClosed: (tab) => releaseComparison((tab.state as CompareTabState | null)?.compareId),
  });
}
