import { describe, expect, it, vi } from 'vitest';
import type { WsEvent } from '../../../api/types';
import { engineSocket } from '../../../api/ws';
import { listenForJobs, parseProgress, waitForGenerateJob } from '../jobs';

const progress = (jobId: string, message: string | null): WsEvent =>
  ({ type: 'job.progress', ts: '', jobId, kind: 'generate.run', done: 0, total: null, message }) as WsEvent;
const done = (jobId: string, status: 'ok' | 'error' | 'cancelled', result: unknown = null, error: string | null = null): WsEvent =>
  ({ type: 'job.done', ts: '', jobId, kind: 'generate.run', status, error, result }) as WsEvent;

describe('generate jobs', () => {
  it('parses progress JSON and ignores anything else', () => {
    expect(parseProgress('{"phase":"generating","rows":5,"total":10}')).toMatchObject({ phase: 'generating', rows: 5 });
    expect(parseProgress('hello')).toBeNull();
    expect(parseProgress('{"x":1}')).toBeNull();
    expect(parseProgress(null)).toBeNull();
  });

  it('reports progress and resolves with the summary', async () => {
    const onProgress = vi.fn();
    const p = waitForGenerateJob('g-a', onProgress);
    engineSocket.dispatch(progress('g-a', JSON.stringify({ phase: 'generating', rows: 3, total: 9, written: 3, skipped: 0, errors: 0, rate: 5 })));
    expect(onProgress.mock.calls[0][0]).toMatchObject({ phase: 'generating', rows: 3, total: 9 });
    engineSocket.dispatch(done('g-a', 'ok', { outcome: 'completed', rowsWritten: 9 }));
    await expect(p).resolves.toEqual({ status: 'ok', error: null, summary: { outcome: 'completed', rowsWritten: 9 } });
  });

  it('resolves failures and remembers a job that ended before the 202', async () => {
    const failed = waitForGenerateJob('g-b', vi.fn());
    engineSocket.dispatch(done('g-b', 'error', null, 'boom'));
    await expect(failed).resolves.toEqual({ status: 'error', error: 'boom', summary: null });
    const cancelled = waitForGenerateJob('g-c', vi.fn());
    engineSocket.dispatch(done('g-c', 'cancelled'));
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled', summary: null });
    listenForJobs();
    engineSocket.dispatch(done('g-fast', 'ok', { outcome: 'completed' }));
    await expect(waitForGenerateJob('g-fast', vi.fn())).resolves.toMatchObject({ status: 'ok', summary: { outcome: 'completed' } });
  });
});
