// Waits for a transfer job: `job.progress` (message = JSON TransferProgress, done / total = rows overall) and
// `job.done` (result = TransferResult). A fast job can finish before the 202 arrives, so recent `job.done` events are
// remembered (same approach as ImportWizard/jobs.ts).
import type { JobDoneEvent, JobProgressEvent } from '../../api/types';
import type { TransferProgress, TransferResult } from '../../api/types.transfer';
import { engineSocket } from '../../api/ws';

const recentDone = new Map<string, JobDoneEvent>();
let listening = false;

/** Makes sure `job.done` events are remembered from now on (call before starting the job). */
export function listenForJobs(): void {
  if (listening) return;
  listening = true;
  engineSocket.on('job.done', (ev) => {
    recentDone.set(ev.jobId, ev);
    if (recentDone.size > 50) recentDone.delete(recentDone.keys().next().value as string);
  });
}

/** The TransferProgress JSON of a job.progress message, or null. */
export function parseProgress(message: string | null | undefined): TransferProgress | null {
  if (!message) return null;
  try {
    const v = JSON.parse(message) as Partial<TransferProgress> | null;
    return v && typeof v === 'object' && typeof v.phase === 'string' ? (v as TransferProgress) : null;
  } catch {
    return null;
  }
}

export interface TransferJobEnd {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  result: TransferResult | null;
}

export function waitForTransferJob(jobId: string, onProgress: (p: TransferProgress | null, ev: JobProgressEvent) => void): Promise<TransferJobEnd> {
  listenForJobs();
  return new Promise<TransferJobEnd>((resolve) => {
    const finish = (done: JobDoneEvent) =>
      resolve({ status: done.status, error: done.error ?? null, result: (done.result as TransferResult | null | undefined) ?? null });
    const early = recentDone.get(jobId);
    if (early) return finish(early);
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') return onProgress(parseProgress(ev.message), ev);
      off();
      finish(ev as JobDoneEvent);
    });
  });
}
