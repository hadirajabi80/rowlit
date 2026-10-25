import { describe, expect, it, vi } from 'vitest';
import type { WsEvent } from '../../api/types';
import { engineSocket } from '../../api/ws';
import { listenForJobs, waitForImportJob } from './jobs';

const progress = (jobId: string, message: string | null, done = 0): WsEvent =>
  ({ type: 'job.progress', ts: '', jobId, kind: 'import.run', done, total: null, message }) as WsEvent;
const done = (jobId: string, status: 'ok' | 'error' | 'cancelled', result: unknown = null, error: string | null = null): WsEvent =>
  ({ type: 'job.done', ts: '', jobId, kind: 'import.run', status, error, result }) as WsEvent;

describe('waitForImportJob', () => {
  it('reports parsed progress and resolves with the summary on job.done', async () => {
    const onProgress = vi.fn();
    const p = waitForImportJob('j-a', onProgress);
    const msg = JSON.stringify({ phase: 'importing', rows: 5, written: 5, skipped: 0, errors: 0, rate: 10, bytes: 1, totalBytes: 2 });
    engineSocket.dispatch(progress('j-a', msg, 5));
    engineSocket.dispatch(progress('j-a', 'plain text', 6));
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0]).toMatchObject({ phase: 'importing', rows: 5 });
    expect(onProgress.mock.calls[0][1].done).toBe(5);
    expect(onProgress.mock.calls[1][0]).toBeNull();
    engineSocket.dispatch(done('j-a', 'ok', { outcome: 'completed', rowsRead: 5 }));
    await expect(p).resolves.toEqual({ status: 'ok', error: null, summary: { outcome: 'completed', rowsRead: 5 } });
    // events of other jobs are ignored, and the subscription is gone
    engineSocket.dispatch(progress('j-a', msg));
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('resolves failures and cancellations without a summary', async () => {
    const failed = waitForImportJob('j-b', vi.fn());
    engineSocket.dispatch(done('j-b', 'error', null, 'boom'));
    await expect(failed).resolves.toEqual({ status: 'error', error: 'boom', summary: null });
    const cancelled = waitForImportJob('j-c', vi.fn());
    engineSocket.dispatch(done('j-c', 'cancelled'));
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled', summary: null });
  });

  it('remembers a job that finished before the 202 arrived', async () => {
    listenForJobs();
    engineSocket.dispatch(done('j-fast', 'ok', { outcome: 'completed' }));
    await expect(waitForImportJob('j-fast', vi.fn())).resolves.toMatchObject({ status: 'ok', summary: { outcome: 'completed' } });
  });
});
