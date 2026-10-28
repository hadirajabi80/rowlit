// Waits for a generate job: `job.progress` (message = JSON GenerateProgress) and `job.done` (result = GenerateSummary). A
// fast job can finish before the 202 arrives, so recent `job.done` events are remembered (same approach as
// Transfer/jobs.ts and ImportWizard/jobs.ts).
import type { JobDoneEvent } from '../../api/types';
import type { GenerateProgress, GenerateSummary } from '../../api/types.generate';
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

/** The GenerateProgress JSON of a job.progress message, or null. */
export function parseProgress(message: string | null | undefined): GenerateProgress | null {
  if (!message) return null;
  try {
    const v = JSON.parse(message) as Partial<GenerateProgress> | null;
    return v && typeof v === 'object' && typeof v.phase === 'string' ? (v as GenerateProgress) : null;
  } catch {
    return null;
  }
}

export interface GenerateJobEnd {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  summary: GenerateSummary | null;
}

export function waitForGenerateJob(jobId: string, onProgress: (p: GenerateProgress | null) => void): Promise<GenerateJobEnd> {
  listenForJobs();
  return new Promise<GenerateJobEnd>((resolve) => {
    const finish = (done: JobDoneEvent) =>
      resolve({ status: done.status, error: done.error ?? null, summary: (done.result as GenerateSummary | null | undefined) ?? null });
    const early = recentDone.get(jobId);
    if (early) return finish(early);
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type === 'job.progress') return onProgress(parseProgress(ev.message));
      off();
      finish(ev as JobDoneEvent);
    });
  });
}
