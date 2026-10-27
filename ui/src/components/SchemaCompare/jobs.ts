// Waits for a `schema.compare` job: `job.progress` (done / total objects read, message = the object being read) and
// `job.done` (result = CompareResult). A fast job can finish before the 202 arrives, so recent `job.done` events are
// remembered from the moment anything listens (same approach as the Import Wizard).
import type { JobDoneEvent, JobProgressEvent } from '../../api/types';
import type { CompareResult } from '../../api/types.schemaCompare';
import { engineSocket } from '../../api/ws';

const recentDone = new Map<string, JobDoneEvent>();
let listening = false;

/** Call before starting the job: its `job.done` is remembered even if it arrives before the HTTP answer. */
export function listenForJobs(): void {
  if (listening) return;
  listening = true;
  engineSocket.on('job.done', (ev) => {
    recentDone.set(ev.jobId, ev);
    if (recentDone.size > 50) recentDone.delete(recentDone.keys().next().value as string);
  });
}

export interface CompareProgress {
  done: number;
  total: number | null;
  message: string | null;
}

export interface CompareJobEnd {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  result: CompareResult | null;
}

export function waitForCompareJob(jobId: string, onProgress: (p: CompareProgress) => void): Promise<CompareJobEnd> {
  listenForJobs();
  return new Promise<CompareJobEnd>((resolve) => {
    const finish = (done: JobDoneEvent) =>
      resolve({ status: done.status, error: done.error ?? null, result: (done.result as CompareResult | null | undefined) ?? null });
    const early = recentDone.get(jobId);
    if (early) return finish(early);
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') {
        const p = ev as JobProgressEvent;
        onProgress({ done: p.done, total: p.total, message: p.message });
        return;
      }
      off();
      finish(ev as JobDoneEvent);
    });
  });
}
