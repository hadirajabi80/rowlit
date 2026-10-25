// A server-side export: the engine runs a SELECT on a session and streams every row to a file (POST /export, progress
// and the end arrive as export.progress / export.done over the socket). The events are subscribed to before the request
// goes out and matched to its id afterwards, so a small export that finishes before the response is not missed.
import { api } from '../../api/client';
import type { ExportFormat, ExportOptions, QueryParam, WsEvent } from '../../api/types';
import { engineSocket } from '../../api/ws';

export interface ServerExportRequest {
  sessionId: string;
  sql: string;
  params: QueryParam[];
  format: ExportFormat;
  path: string;
  options: ExportOptions;
  /** Rows written so far (about twice a second). */
  onProgress?: (rows: number) => void;
  /** Called with a function that cancels the export once it is running. */
  onStarted?: (cancel: () => void) => void;
}

export interface ServerExportOutcome {
  status: 'ok' | 'error' | 'cancelled';
  rows: number;
  path: string;
  error: string | null;
}

type DoneEvent = Extract<WsEvent, { type: 'export.done' }>;

/** How long a cancelled export may stay silent before it is reported as cancelled anyway (the socket may be down). */
export const CANCEL_GRACE_MS = 8000;

export async function runServerExport(r: ServerExportRequest): Promise<ServerExportOutcome> {
  let exportId: string | null = null;
  const earlyProgress = new Map<string, number>();
  const earlyDone = new Map<string, DoneEvent>();
  let finish!: (ev: DoneEvent) => void;
  const finished = new Promise<DoneEvent>((res) => { finish = res; });

  const offProgress = engineSocket.on('export.progress', (ev) => {
    if (exportId === null) earlyProgress.set(ev.exportId, ev.rows);
    else if (ev.exportId === exportId) r.onProgress?.(ev.rows);
  });
  const offDone = engineSocket.on('export.done', (ev) => {
    if (exportId === null) earlyDone.set(ev.exportId, ev);
    else if (ev.exportId === exportId) finish(ev);
  });
  // The end can no longer be observed once the socket is gone: report it instead of waiting for ever.
  const offStatus = engineSocket.onStatus((s) => {
    if (exportId !== null && (s === 'reconnecting' || s === 'closed' || s === 'unauthorized')) {
      finish({ type: 'export.done', ts: new Date().toISOString(), exportId, path: r.path, rows: 0, status: 'error', error: 'Connection to the engine was lost; the export may still be running.' });
    }
  });
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = await api.exportQuery({ sessionId: r.sessionId, sql: r.sql, format: r.format, path: r.path, options: r.options, params: r.params.length ? r.params : undefined });
    exportId = started.exportId;
    r.onStarted?.(() => {
      void api.cancel(r.sessionId).catch(() => undefined);
      cancelTimer ??= setTimeout(() => finish({
        type: 'export.done', ts: new Date().toISOString(), exportId: started.exportId, path: r.path, rows: 0, status: 'cancelled', error: null,
      }), CANCEL_GRACE_MS);
    });
    const progress = earlyProgress.get(started.exportId);
    if (progress !== undefined) r.onProgress?.(progress);
    const done = earlyDone.get(started.exportId);
    if (done) finish(done);
    const ev = await finished;
    return { status: ev.status, rows: ev.rows, path: ev.path || r.path, error: ev.error };
  } finally {
    clearTimeout(cancelTimer);
    offProgress();
    offDone();
    offStatus();
  }
}
