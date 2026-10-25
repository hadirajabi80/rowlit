// Waits for an import job: `job.progress` (message = JSON ImportProgress) and `job.done`. A fast job can finish before
// the 202 arrives, so recent `job.done` events are remembered (same approach as the other job-driven dialogs).
import type { JobDoneEvent, JobProgressEvent } from '../../api/types';
import { engineSocket } from '../../api/ws';
import { parseProgress } from './model';
import type { ImportProgress, ImportSummary } from './types';

const recentDone = new Map<string, JobDoneEvent>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  engineSocket.on('job.done', (ev) => {
    recentDone.set(ev.jobId, ev);
    if (recentDone.size > 50) recentDone.delete(recentDone.keys().next().value as string);
  });
}

/** Makes sure `job.done` events are remembered from now on (call before starting the job). */
export function listenForJobs(): void {
  listen();
}

export interface JobEnd {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  summary: ImportSummary | null;
}

export function waitForImportJob(jobId: string, onProgress: (p: ImportProgress | null, ev: JobProgressEvent) => void): Promise<JobEnd> {
  listen();
  return new Promise<JobEnd>((resolve) => {
    const finish = (done: JobDoneEvent) =>
      resolve({ status: done.status, error: done.error ?? null, summary: (done.result as ImportSummary | null | undefined) ?? null });
    const early = recentDone.get(jobId);
    if (early) return finish(early);
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') return onProgress(parseProgress(ev.message), ev);
      off();
      finish(ev as JobDoneEvent);
    });
  });
}
