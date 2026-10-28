// Web Worker running diffResults off the UI thread (sets over DIFF_WORKER_ROWS rows). Protocol:
//   in:  { id, left: DiffInput, right: DiffInput, options }
//   out: { id, result: DiffResult } or { id, error: string }
import { diffResults, type DiffOptions } from './diff';
import type { DiffInput } from './diffRunner';

interface Req { id: number; left: DiffInput; right: DiffInput; options: DiffOptions }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown): void };

const side = (s: DiffInput) => ({ columns: s.columns, rows: { length: s.rows.length, get: (i: number) => s.rows[i] } });

ctx.onmessage = (e) => {
  const { id, left, right, options } = e.data;
  try {
    ctx.postMessage({ id, result: diffResults(side(left), side(right), options) });
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
