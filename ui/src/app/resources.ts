// Resources (docs/resources.md), window side: releases the rows of background result tabs (not viewed for a while,
// over the row budget, under memory pressure), evicts cached catalogs nobody shows, follows the engine's
// resources.* events (toasts for connections closed to free resources) and polls the status-bar snapshot.
import { api, isApiError } from '../api/client';
import type { MemoryLevel, WsEventOf } from '../api/types';
import { engineSocket } from '../api/ws';
import { useExplorer } from '../components/Explorer/explorerStore';
import { useCatalog, type DbCatalog } from '../store/catalog';
import { hasPending, useEdits } from '../store/edits';
import { formatBytes, useResources } from '../store/resources';
import { useResults, viewKey } from '../store/results';
import { isRunning, type ExecutionState } from '../store/resultsReducer';
import { useSessions } from '../store/sessions';
import { DEFAULT_RESOURCES, useSettings } from '../store/settings';
import { useTabs } from '../store/tabs';
import { toast } from '../store/ui';

/** Rows a released result set keeps (the first page of the grid). */
export const RELEASE_KEEP_ROWS = 1000;
/** Rows fetched per request when a released result reloads from the engine's copy. */
const RELOAD_PAGE = 5000;
const POLICY_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------- tab visibility

/** Last time each tab was on screen (active in an editor group); visible tabs read "now". */
const lastViewed = new Map<string, number>();

/** Tabs on screen: the active tab of every editor group, and the globally active one. */
export function visibleTabIds(): Set<string> {
  const t = useTabs.getState();
  const ids = new Set<string>();
  if (t.activeId) ids.add(t.activeId);
  for (const g of t.groups ?? []) if (g.activeId) ids.add(g.activeId);
  return ids;
}

let prevVisible = new Set<string>();
function trackVisibility(now = Date.now()): Set<string> {
  const visible = visibleTabIds();
  // A tab that just left the screen starts its idle time now.
  for (const id of prevVisible) if (!visible.has(id)) lastViewed.set(id, now);
  for (const id of visible) lastViewed.set(id, now);
  prevVisible = visible;
  return visible;
}

/** Tests: forget the visibility history. */
export function resetResourcePolicyForTests(): void {
  lastViewed.clear();
  prevVisible = new Set();
}

/** Tests: pretend a tab was last on screen at `at`. */
export function setLastViewedForTests(tabId: string, at: number): void {
  lastViewed.set(tabId, at);
}

// ---------------------------------------------------------------- results

function rowsOf(e: ExecutionState): number {
  return e.resultSets.reduce((n, rs) => n + rs.rows.length, 0);
}

/** A background, finished console result without unsaved grid edits: its rows beyond the first page may go. */
function releasable(e: ExecutionState, visible: Set<string>): boolean {
  if (visible.has(e.tabId) || isRunning(e) || !e.executionId) return false;
  if (!e.resultSets.some((rs) => rs.done && rs.rows.length > RELEASE_KEEP_ROWS)) return false;
  const buffers = useEdits.getState().buffers;
  // Unsaved edits, and saved ones the grid overlays on its rows (row indices must stay valid).
  return !e.resultSets.some((rs) => {
    const b = buffers[viewKey(e.localId, rs.id)];
    if (!b) return false;
    const c = b.committed;
    return hasPending(b) || !!b.savedInTx || Object.keys(c.patched).length > 0 || Object.keys(c.hidden).length > 0 || c.appended.length > 0;
  });
}

export interface PolicyOptions {
  now?: number;
  level?: MemoryLevel;
}

/**
 * One pass of the window's policies. Results: background tabs not viewed for `releaseResultsMinutes` release their
 * rows beyond the first page; above `resultRowBudget` rows in total the least recently viewed go first; under memory
 * pressure every background result goes. The active tab, running queries and grids with unsaved edits are never
 * touched. Catalog: cached databases no open tab or expanded explorer node uses are evicted beyond the budget.
 * Returns the number of rows released.
 */
export function runResourcePolicy(opts: PolicyOptions = {}): number {
  const now = opts.now ?? Date.now();
  const level = opts.level ?? useResources.getState().level;
  const settings = { ...DEFAULT_RESOURCES, ...useSettings.getState().settings.resources };
  const visible = trackVisibility(now);
  const results = useResults.getState();
  const candidates = Object.values(results.executions).filter((e) => releasable(e, visible));
  candidates.sort((a, b) => (lastViewed.get(a.tabId) ?? 0) - (lastViewed.get(b.tabId) ?? 0));
  let released = 0;
  const release = (e: ExecutionState, reason: 'idle' | 'budget' | 'pressure') => {
    released += useResults.getState().releaseRows(e.localId, RELEASE_KEEP_ROWS, reason, now);
  };

  if (settings.autoRelease) {
    const pressure = level !== 'normal' && settings.trimUnderPressure;
    const idleMs = settings.releaseResultsMinutes > 0 ? settings.releaseResultsMinutes * 60_000 : Infinity;
    let total = Object.values(results.executions).reduce((n, e) => n + rowsOf(e), 0);
    for (const e of candidates) {
      const idle = now - (lastViewed.get(e.tabId) ?? now) >= idleMs;
      const over = total > settings.resultRowBudget;
      if (!pressure && !idle && !over) continue;
      const before = rowsOf(e);
      release(e, pressure ? 'pressure' : over && !idle ? 'budget' : 'idle');
      total -= before - rowsOf(useResults.getState().executions[e.localId] ?? e);
    }
  }

  evictCatalogs(settings.catalogCacheMb, level, now);
  return released;
}

/** Cached databases in use: an open tab on the connection, or the database's node expanded in the explorer. */
function catalogInUse(): (d: DbCatalog) => boolean {
  const tabConns = new Set(useTabs.getState().tabs.map((t) => t.connectionId).filter((c): c is string => !!c));
  const expanded = useExplorer.getState().expanded;
  return (d) => {
    if (tabConns.has(d.connectionId)) return true;
    if (!expanded.has(`c:${d.connectionId}`)) return false;
    return d.database === null || expanded.has(`d:${d.connectionId}:${d.database}`);
  };
}

function evictCatalogs(budgetMb: number, level: MemoryLevel, now: number): void {
  const divisor = level === 'critical' ? 4 : level === 'high' ? 2 : 1;
  const minIdleMs = level === 'critical' ? 0 : level === 'high' ? 2 * 60_000 : 10 * 60_000;
  const evicted = useCatalog.getState().evict({ budgetBytes: (budgetMb * 1024 * 1024) / divisor, minIdleMs, inUse: catalogInUse(), now });
  if (evicted.length) console.info(`[resources] evicted ${evicted.length} cached catalog(s)`);
}

/**
 * "Reload" of a released result: fetches the rows beyond the kept ones back from the engine's copy (no re-run). When
 * the engine no longer has them (404: expired, evicted, session closed) the banner offers Re-run instead.
 */
export async function reloadReleased(localId: string): Promise<boolean> {
  const e = useResults.getState().executions[localId];
  if (!e?.executionId) return false;
  let ok = true;
  for (const rs of e.resultSets) {
    if (!rs.released) continue;
    useResults.getState().patchReleased(localId, rs.id, { reloading: true });
    try {
      let offset = rs.rows.length;
      for (;;) {
        const page = await api.rows(e.executionId, rs.id, offset, RELOAD_PAGE);
        offset += page.rows.length;
        const complete = offset >= rs.released.total;
        const last = complete || page.rows.length < RELOAD_PAGE;
        useResults.getState().restoreRows(localId, rs.id, page.rows, complete);
        if (!last) continue;
        // The engine kept fewer rows than the grid had (its memory cap): only a re-run shows them all.
        if (!complete) {
          ok = false;
          useResults.getState().patchReleased(localId, rs.id, { reloading: false, unavailable: true });
        }
        break;
      }
    } catch (err) {
      ok = false;
      useResults.getState().patchReleased(localId, rs.id, { reloading: false, unavailable: true });
      if (!isApiError(err, 'NOT_FOUND')) console.warn('[resources] reloading released rows failed', err);
    }
  }
  return ok;
}

/**
 * Resources popover "Free memory now": the engine runs its policies as under critical pressure (idle sessions without
 * transactions or temporary objects, caches, GC) and this window releases every background result.
 */
export async function freeMemoryNow(): Promise<void> {
  const released = runResourcePolicy({ level: 'critical' });
  try {
    const before = useResources.getState().snapshot?.memory.usedBytes ?? null;
    const snap = await api.resources.trim();
    useResources.setState({ snapshot: snap, level: snap.memory.level });
    useSessions.getState().refreshSoon(200);
    const freed = before !== null ? Math.max(0, before - snap.memory.usedBytes) : 0;
    toast('info', 'Freed memory', [freed > 0 ? `${formatBytes(freed)} returned by the engine` : null,
      released ? `${released.toLocaleString()} result rows released` : null].filter(Boolean).join(' · ') || undefined);
  } catch (e) {
    toast('error', 'Could not free memory', e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- engine events, timers

function onReleased(ev: WsEventOf<'resources.released'>): void {
  useSessions.getState().refreshSoon(300);
  if (ev.reason === 'idle') return; // the tabs say "disconnected (idle)"; no toast for the routine case
  toast('info', `Closed ${ev.connectionName} to free resources`,
    ev.reason === 'limit' ? 'Too many open connections. It reconnects on its next use.' : 'Memory is running low. It reconnects on its next use.');
  void useResources.getState().refresh();
}

let lastPressureToast = 0;
function onPressure(ev: WsEventOf<'resources.pressure'>): void {
  useResources.getState().setLevel(ev.level);
  if (ev.level === 'normal') return;
  runResourcePolicy({ level: ev.level });
  if (ev.level === 'critical' && Date.now() - lastPressureToast > 10 * 60_000) {
    lastPressureToast = Date.now();
    toast('warning', 'Memory use is above the limit', 'Idle connections, cached catalogs and background results are being released.');
  }
}

let wired = false;

/** Engine events + the periodic policy and snapshot poll. Idempotent; timers are not started under tests. */
export function wireResources(): void {
  if (wired) return;
  wired = true;
  engineSocket.on('resources.released', onReleased);
  engineSocket.on('resources.pressure', onPressure);
  useTabs.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId || s.groups !== prev.groups) trackVisibility();
  });
  if (import.meta.env?.MODE === 'test' || typeof window === 'undefined') return;
  setInterval(() => {
    void useResources.getState().refresh().finally(() => runResourcePolicy());
  }, POLICY_INTERVAL_MS);
  setTimeout(() => void useResources.getState().refresh(), 3_000);
}
