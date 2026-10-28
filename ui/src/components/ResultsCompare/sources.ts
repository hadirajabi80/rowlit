// What a comparison compares. A compare tab holds two snapshots (the rows as they were when the tab opened), kept in
// memory under the tab's `compareId` and released when the tab closes; the tab's own state is only that id, so it
// serialises with the workspace and, after a restart, finds nothing and says so.
import type { CellValue, ColumnInfo } from '../../api/types';
import type { ExecutionState, PinnedResult, ResultSetState } from '../../store/resultsReducer';
import { useResults } from '../../store/results';
import { useTabs } from '../../store/tabs';

export interface CompareSet {
  title: string;
  /** The statement (or where the rows came from), for the tooltip. */
  detail: string;
  connectionId: string | null;
  columns: ColumnInfo[];
  rows: { readonly length: number; get(i: number): CellValue[] | undefined };
  /** Rows the engine reported for the result (more than `rows.length` when truncated). */
  rowCount: number;
  /** Every row of the result is in `rows`. */
  complete: boolean;
}

export interface Comparison {
  left: CompareSet;
  right: CompareSet;
}

const comparisons = new Map<string, Comparison>();
let seq = 0;

/** Snapshot of a result set. The rows list is shared, not copied (finished result sets are not modified). */
export function setOf(exec: ExecutionState, rs: ResultSetState, title: string): CompareSet {
  const batch = exec.batches[rs.batchIndex];
  return {
    title, detail: batch?.sql ?? title, connectionId: exec.connectionId, columns: rs.columns, rows: rs.rows,
    rowCount: Math.max(rs.rowCount, rs.rows.length), complete: rs.done && !rs.truncated && !rs.released,
  };
}

export function registerComparison(c: Comparison): string {
  const id = `cmp${++seq}`;
  comparisons.set(id, c);
  return id;
}
export const getComparison = (id: string | null | undefined): Comparison | undefined => (id ? comparisons.get(id) : undefined);
export const releaseComparison = (id: string | null | undefined): void => void (id && comparisons.delete(id));
/** Test hook. */
export function clearComparisons(): void {
  comparisons.clear();
}

export interface CompareChoice {
  id: string;
  group: 'run' | 'pinned';
  label: string;
  detail: string;
  set: CompareSet;
}

const pinSet = (p: PinnedResult): CompareSet => setOf(p.exec, p.exec.resultSets[0], p.title);

/**
 * What a result set can be compared with: the other result sets of the console's run, then every pinned result of every
 * console (the one being looked at excluded). `current`: the console tab and, for a pinned result, its pin id.
 */
export function compareChoices(tabId: string, current: { rsId?: number; pinId?: string }): CompareChoice[] {
  const out: CompareChoice[] = [];
  const r = useResults.getState();
  const exec = r.executions[r.byTab[tabId]];
  if (exec) {
    const hidden = new Set((r.pinned[tabId] ?? []).filter((p) => p.origin.localId === exec.localId).map((p) => p.origin.rsId));
    exec.resultSets.forEach((rs, i) => {
      if (!rs.done || rs.columns.length === 0 || hidden.has(rs.id) || (current.pinId === undefined && rs.id === current.rsId)) return;
      const label = `Result ${i + 1}`;
      out.push({ id: `run:${rs.id}`, group: 'run', label, detail: `${rs.rowCount} rows`, set: setOf(exec, rs, label) });
    });
  }
  const tabs = useTabs.getState().tabs;
  for (const [tid, list] of Object.entries(r.pinned)) {
    const tab = tabs.find((t) => t.id === tid);
    for (const p of list) {
      if (p.id === current.pinId) continue;
      const owner = tab?.title ?? 'console';
      out.push({ id: `pin:${p.id}`, group: 'pinned', label: p.title, detail: `${owner} · ${p.exec.resultSets[0].rowCount} rows`, set: pinSet(p) });
    }
  }
  return out;
}

/** The set being looked at (the left side of a comparison started from it). */
export function currentSet(tabId: string, current: { rsId?: number; pinId?: string }): CompareSet | null {
  const r = useResults.getState();
  if (current.pinId !== undefined) {
    const p = (r.pinned[tabId] ?? []).find((x) => x.id === current.pinId);
    return p ? pinSet(p) : null;
  }
  const exec = r.executions[r.byTab[tabId]];
  const i = exec ? exec.resultSets.findIndex((x) => x.id === current.rsId) : -1;
  return exec && i >= 0 ? setOf(exec, exec.resultSets[i], `Result ${i + 1}`) : null;
}
