import { describe, expect, it, vi } from 'vitest';
import type { WsEvent } from '../../../api/types';
import { engineSocket } from '../../../api/ws';
import { listenForJobs, parseProgress, waitForTransferJob } from '../jobs';

const progress = (jobId: string, message: string | null, done = 0, total: number | null = null): WsEvent =>
  ({ type: 'job.progress', ts: '', jobId, kind: 'transfer.run', done, total, message }) as WsEvent;
const done = (jobId: string, status: 'ok' | 'error' | 'cancelled', result: unknown = null, error: string | null = null): WsEvent =>
  ({ type: 'job.done', ts: '', jobId, kind: 'transfer.run', status, error, result }) as WsEvent;

describe('transfer jobs', () => {
  it('parses progress JSON and ignores anything else', () => {
    expect(parseProgress('{"phase":"data","table":"a","tableIndex":1}')).toMatchObject({ phase: 'data', table: 'a' });
    expect(parseProgress('Counting rows')).toBeNull();
    expect(parseProgress('{"x":1}')).toBeNull();
    expect(parseProgress(null)).toBeNull();
  });

  it('reports progress and resolves with the result', async () => {
    const onProgress = vi.fn();
    const p = waitForTransferJob('t-a', onProgress);
    engineSocket.dispatch(progress('t-a', JSON.stringify({ phase: 'data', table: 'a', tableIndex: 1, tableCount: 1, tableDone: 3, tableTotal: 9, rowsPerSecond: 1, message: null }), 3, 9));
    expect(onProgress.mock.calls[0][0]).toMatchObject({ phase: 'data', tableDone: 3 });
    expect(onProgress.mock.calls[0][1].total).toBe(9);
    engineSocket.dispatch(done('t-a', 'ok', { status: 'ok', totalRows: 9 }));
    await expect(p).resolves.toEqual({ status: 'ok', error: null, result: { status: 'ok', totalRows: 9 } });
  });

  it('resolves failures and remembers a job that ended before the 202', async () => {
    const failed = waitForTransferJob('t-b', vi.fn());
    engineSocket.dispatch(done('t-b', 'error', null, 'Directory does not exist'));
    await expect(failed).resolves.toEqual({ status: 'error', error: 'Directory does not exist', result: null });
    listenForJobs();
    engineSocket.dispatch(done('t-fast', 'ok', { status: 'ok' }));
    await expect(waitForTransferJob('t-fast', vi.fn())).resolves.toMatchObject({ status: 'ok', result: { status: 'ok' } });
  });
});
