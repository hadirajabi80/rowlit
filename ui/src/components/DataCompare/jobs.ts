// Waits for a `data.compare` job (progress message = JSON DataCompareProgress; result = DataCompareResult) or a
// `data.sync` job (done / total = statements; result = DataApplyResult). A fast job can finish before the 202 arrives,
// so recent `job.done` events are remembered from the moment anything listens (same approach as Transfer/jobs.ts).
import type { JobDoneEvent, JobProgressEvent } from '../../api/types';
import type { DataCompareProgress } from '../../api/types.dataCompare';
import { engineSocket } from '../../api/ws';

const recentDone = new Map<string, JobDoneEvent>();
let listening = false;

/** Call before starting a job: its `job.done` is remembered even if it arrives before the HTTP answer. */
export function listenForJobs(): void {
  if (listening) return;
  listening = true;
  engineSocket.on('job.done', (ev) => {
    recentDone.set(ev.jobId, ev);
    if (recentDone.size > 50) recentDone.delete(recentDone.keys().next().value as string);
  });
}

/** The DataCompareProgress JSON of a job.progress message, or null. */
export function parseProgress(message: string | null | undefined): DataCompareProgress | null {
  if (!message) return null;
  try {
    const v = JSON.parse(message) as Partial<DataCompareProgress> | null;
    return v && typeof v === 'object' && typeof v.phase === 'string' ? (v as DataCompareProgress) : null;
  } catch {
    return null;
  }
}

export interface JobEnd<T> {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  result: T | null;
}

export function waitForJob<T>(jobId: string, onProgress: (ev: JobProgressEvent) => void): Promise<JobEnd<T>> {
  listenForJobs();
  return new Promise<JobEnd<T>>((resolve) => {
    const finish = (done: JobDoneEvent) => resolve({ status: done.status, error: done.error ?? null, result: (done.result as T | null | undefined) ?? null });
    const early = recentDone.get(jobId);
    if (early) return finish(early);
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') return onProgress(ev as JobProgressEvent);
      off();
      finish(ev as JobDoneEvent);
    });
  });
}
