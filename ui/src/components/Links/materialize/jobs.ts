// Waits for a materialize job: `job.progress` and `job.done` events. A fast job can finish before the 202 arrives, so
// `job.done` events are remembered from the moment anything listens (same approach as the Import Wizard).
import type { JobDoneEvent, JobProgressEvent } from '../../../api/types';
import { engineSocket } from '../../../api/ws';
import { readEnd, readProgress, type MaterializeEnd, type MaterializeProgress } from './model';

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

export function waitForMaterializeJob(jobId: string, onProgress: (p: MaterializeProgress, ev: JobProgressEvent) => void): Promise<MaterializeEnd> {
  listenForJobs();
  return new Promise<MaterializeEnd>((resolve) => {
    const early = recentDone.get(jobId);
    if (early) return resolve(readEnd(early));
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') return onProgress(readProgress(ev), ev);
      off();
      resolve(readEnd(ev as JobDoneEvent));
    });
  });
}
