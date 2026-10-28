// Runs diffResults in diff.worker.ts when the two sets are big (the keyed merge over 200k rows blocks the UI for a
// second or more); small sets, and environments without Workers (tests, a worker that failed to start), diff on the
// calling thread.
import type { CellValue, ColumnInfo } from '../../api/types';
import { diffResults, type DiffOptions, type DiffResult, type DiffSide } from './diff';

/** Plain, structured-clonable form of a side. */
export interface DiffInput {
  columns: Pick<ColumnInfo, 'name' | 'kind' | 'isKey'>[];
  rows: CellValue[][];
}

/** Total rows (both sets) above which the diff runs in a Worker. */
export const DIFF_WORKER_ROWS = 50_000;

type Pending = { resolve: (r: DiffResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module', name: 'results-diff' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result?: DiffResult; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? 'Compare failed'));
  };
  worker.onerror = (e) => {
    // a worker that cannot load falls back to the calling thread for this and later diffs
    workerBroken = true;
    worker?.terminate();
    worker = null;
    const all = [...pending.values()];
    pending.clear();
    e.preventDefault?.();
    for (const p of all) p.reject(new Error('worker-failed'));
  };
  return worker;
}

function toInput(s: DiffSide): DiffInput {
  const rows: CellValue[][] = new Array(s.rows.length);
  for (let i = 0; i < s.rows.length; i++) rows[i] = s.rows.get(i) ?? [];
  return { columns: s.columns.map((c) => ({ name: c.name, kind: c.kind, isKey: c.isKey })), rows };
}

/** Diffs two sets; big ones in a Worker (the result is the same either way). */
export async function runDiff(left: DiffSide, right: DiffSide, options: DiffOptions): Promise<DiffResult> {
  const total = left.rows.length + right.rows.length;
  const w = total > DIFF_WORKER_ROWS ? getWorker() : null;
  if (!w) return diffResults(left, right, options);
  const id = ++seq;
  try {
    return await new Promise<DiffResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, left: toInput(left), right: toInput(right), options });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'worker-failed') return diffResults(left, right, options);
    throw e;
  }
}
