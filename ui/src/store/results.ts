import { create } from 'zustand';
import type { CellValue, WsEvent } from '../api/types';
import { ChunkedList } from '../lib/chunked';
import { EMPTY_VIEW, type GridViewModel } from '../lib/filter';
import { applyEvents, failExecution, isRunning, type ExecutionState, type ReleasedRows } from './resultsReducer';

export type ResultView = number | 'messages';

/**
 * Results of executions, keyed by a local id (assigned before the engine returns an executionId) and
 * indexed by tab. Engine events are buffered and applied once per animation frame so 100k-row streams
 * cost one React update per frame, not one per WS message.
 */
interface ResultsState {
  executions: Record<string, ExecutionState>;
  byTab: Record<string, string>;
  activeView: Record<string, ResultView>;
  views: Record<string, GridViewModel>;
  begin(exec: ExecutionState): void;
  attach(localId: string, executionId: string): void;
  fail(localId: string, text: string, code?: string | null): void;
  ingest(ev: WsEvent): void;
  flush(): void;
  setActiveView(tabId: string, v: ResultView): void;
  setGridView(key: string, v: Partial<GridViewModel>): void;
  clearTab(tabId: string): void;
  /**
   * Resources (docs/resources.md): keeps only the first `keep` rows of every finished result set of the execution
   * (`ResultSetState.released`). Returns the number of rows dropped (0 while it runs or when nothing is beyond `keep`).
   */
  releaseRows(localId: string, keep: number, reason: ReleasedRows['reason'], now?: number): number;
  /** Reload: rows fetched back from the engine's copy, appended after the kept ones; `complete` ends the release. */
  restoreRows(localId: string, rsId: number, rows: CellValue[][], complete: boolean): void;
  patchReleased(localId: string, rsId: number, patch: Partial<ReleasedRows>): void;
}

const xidToLocal = new Map<string, string>();
/** Events for executionIds we have not seen yet (WS can beat the POST /execute response). */
const orphans = new Map<string, { at: number; events: WsEvent[] }>();
const queue = new Map<string, WsEvent[]>();
let scheduled = false;

const raf: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(() => cb()) : (cb) => setTimeout(cb, 16);

export const viewKey = (localId: string, rsId: number) => `${localId}:${rsId}`;

export const useResults = create<ResultsState>((set, get) => {
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      get().flush();
    });
  };

  const enqueue = (localId: string, evs: WsEvent[]) => {
    const q = queue.get(localId);
    if (q) q.push(...evs);
    else queue.set(localId, [...evs]);
    schedule();
  };

  return {
    executions: {},
    byTab: {},
    activeView: {},
    views: {},

    begin(exec) {
      const s = get();
      const prevLocal = s.byTab[exec.tabId];
      const executions = { ...s.executions, [exec.localId]: exec };
      const views = { ...s.views };
      if (prevLocal) {
        // Only the latest execution per tab is kept; free the previous rows.
        const prev = executions[prevLocal];
        if (prev?.executionId) xidToLocal.delete(prev.executionId);
        delete executions[prevLocal];
        for (const k of Object.keys(views)) if (k.startsWith(`${prevLocal}:`)) delete views[k];
      }
      set({ executions, views, byTab: { ...s.byTab, [exec.tabId]: exec.localId }, activeView: { ...s.activeView, [exec.tabId]: 'messages' } });
    },

    attach(localId, executionId) {
      const e = get().executions[localId];
      if (!e) return;
      xidToLocal.set(executionId, localId);
      set({ executions: { ...get().executions, [localId]: { ...e, executionId, status: e.status === 'starting' ? 'running' : e.status } } });
      const o = orphans.get(executionId);
      if (o) {
        orphans.delete(executionId);
        enqueue(localId, o.events);
        get().flush();
      }
    },

    fail(localId, text, code = null) {
      const e = get().executions[localId];
      if (!e) return;
      set({ executions: { ...get().executions, [localId]: failExecution(e, text, code) } });
    },

    ingest(ev) {
      const xid = (ev as { executionId?: string }).executionId;
      if (!xid) return;
      const localId = xidToLocal.get(xid);
      if (localId) {
        enqueue(localId, [ev]);
        return;
      }
      const now = Date.now();
      const o = orphans.get(xid);
      if (o) o.events.push(ev);
      else orphans.set(xid, { at: now, events: [ev] });
      // Drop orphans of executions that belong to another window / were never attached.
      for (const [k, v] of orphans) if (now - v.at > 30_000) orphans.delete(k);
    },

    flush() {
      if (queue.size === 0) return;
      const s = get();
      const executions = { ...s.executions };
      let activeView: Record<string, ResultView> | null = null;
      for (const [localId, evs] of queue) {
        const prev = executions[localId];
        if (!prev) continue;
        const next = applyEvents(prev, evs);
        executions[localId] = next;
        // Auto-focus: first result set when it appears; Messages when the run ends with errors and no data.
        const cur = s.activeView[next.tabId];
        if (prev.resultSets.length === 0 && next.resultSets.length > 0 && cur === 'messages') {
          activeView ??= { ...s.activeView };
          activeView[next.tabId] = next.resultSets[0].id;
        }
      }
      queue.clear();
      set(activeView ? { executions, activeView } : { executions });
    },

    setActiveView(tabId, v) {
      set({ activeView: { ...get().activeView, [tabId]: v } });
    },

    setGridView(key, v) {
      const cur = get().views[key] ?? EMPTY_VIEW;
      set({ views: { ...get().views, [key]: { ...cur, ...v } } });
    },

    clearTab(tabId) {
      const s = get();
      const localId = s.byTab[tabId];
      if (!localId) return;
      const executions = { ...s.executions };
      const e = executions[localId];
      if (e?.executionId) xidToLocal.delete(e.executionId);
      delete executions[localId];
      const byTab = { ...s.byTab };
      delete byTab[tabId];
      set({ executions, byTab });
    },

    releaseRows(localId, keep, reason, now = Date.now()) {
      const e = get().executions[localId];
      if (!e || isRunning(e)) return 0;
      let dropped = 0;
      const resultSets = e.resultSets.map((rs) => {
        if (!rs.done || rs.rows.length <= keep) return rs;
        dropped += rs.rows.length - keep;
        const total = rs.released ? rs.released.total : rs.rows.length;
        return {
          ...rs, rows: ChunkedList.from(rs.rows.slice(0, keep)), rev: rs.rev + 1,
          released: { kept: keep, total, at: now, reason },
        };
      });
      if (!dropped) return 0;
      set({ executions: { ...get().executions, [localId]: { ...e, resultSets } } });
      return dropped;
    },

    restoreRows(localId, rsId, rows, complete) {
      const e = get().executions[localId];
      if (!e) return;
      const resultSets = e.resultSets.map((rs) => {
        if (rs.id !== rsId || !rs.released) return rs;
        rs.rows.pushAll(rows);
        return { ...rs, rev: rs.rev + 1, released: complete ? null : { ...rs.released, reloading: true } };
      });
      set({ executions: { ...get().executions, [localId]: { ...e, resultSets } } });
    },

    patchReleased(localId, rsId, patch) {
      const e = get().executions[localId];
      if (!e) return;
      const resultSets = e.resultSets.map((rs) => (rs.id === rsId && rs.released ? { ...rs, released: { ...rs.released, ...patch } } : rs));
      set({ executions: { ...get().executions, [localId]: { ...e, resultSets } } });
    },
  };
});

export function useTabExecution(tabId: string | null | undefined): ExecutionState | undefined {
  return useResults((s) => (tabId ? s.executions[s.byTab[tabId]] : undefined));
}

export function executionByXid(xid: string): ExecutionState | undefined {
  const l = xidToLocal.get(xid);
  return l ? useResults.getState().executions[l] : undefined;
}
