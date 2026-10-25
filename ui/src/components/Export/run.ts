// Runs an export for the scope and settings the dialog chose, and reports how it ended.
//   - filtered / all / rerun: an engine job (a SELECT streamed to the file, no row cap, progress, cancel);
//   - loaded rows of an unchanged console result: the engine writes its stored copy (full values, every row);
//   - loaded rows / selection otherwise: the grid's rows are rendered here and saved directly.
import { api, errorMessage } from '../../api/client';
import { EXPORT_EXT, EXPORT_FILTER_NAME, EXPORT_MIME } from '../../lib/exportFormats';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { renderClientFile } from './clientRender';
import { exportFileName, exportOptions, isServerScope } from './model';
import { runServerExport } from './serverExport';
import type { ExportScopeId, ExportSettings, ExportSource } from './types';

export interface RunInput {
  source: ExportSource;
  scope: ExportScopeId;
  settings: ExportSettings;
  /** File to write; null in the browser build for the client-side scopes (the file is downloaded). */
  path: string | null;
  onProgress?: (rows: number) => void;
  /** Receives a function that cancels the export once it is running (engine jobs only). */
  onCancelable?: (cancel: () => void) => void;
}

export interface RunOutcome {
  status: 'ok' | 'cancelled' | 'error';
  rows: number;
  /** Where the file went (a path, or the name of a download). */
  path: string | null;
  /** Something the user should know although the file was written (values left truncated, rows over Excel's limit). */
  warning: string | null;
  error: string | null;
}

const fail = (error: string): RunOutcome => ({ status: 'error', rows: 0, path: null, warning: null, error });

/** A path typed without an extension gets the format's. */
export function pathWithExtension(path: string, format: ExportSettings['format']): string {
  const p = path.trim();
  const name = p.split(/[\\/]/).pop() ?? p;
  return name.includes('.') ? p : `${p}.${EXPORT_EXT[format]}`;
}

export async function runExport(i: RunInput): Promise<RunOutcome> {
  const { source, scope, settings } = i;
  const format = settings.format;
  const options = exportOptions(settings, { sheetName: source.baseName });
  const path = i.path ? pathWithExtension(i.path, format) : null;
  try {
    if (isServerScope(scope)) {
      const q = source.serverQuery(scope as 'filtered' | 'all' | 'rerun');
      if (!q) return fail('This scope cannot be exported from the server.');
      if (!path) return fail('Choose the file to write.');
      const out = await source.withSession((sessionId) => runServerExport({
        sessionId, sql: q.sql, params: q.params, format, path, options, onProgress: i.onProgress, onStarted: i.onCancelable,
      }));
      return { status: out.status, rows: out.rows, path: out.path, warning: null, error: out.error };
    }

    if (scope === 'loaded' && source.stored && path && getPlatform().hasFileSystem) {
      const r = await api.exportResultSet(source.stored.executionId, source.stored.resultSetId, { format, path, options });
      if ('path' in r) return { status: 'ok', rows: r.rows, path: r.path, warning: null, error: null };
    }

    const block = source.clientRows(scope === 'selection' ? 'selection' : 'loaded');
    if (!block) return fail('The grid is no longer open.');
    const rendered = await renderClientFile({
      format, columns: block.columns, rows: block.rows, settings, dialect: source.dialect, defaultTable: source.defaultTable,
      sheetName: source.baseName, locate: block.locate, fetch: block.fetch,
    });
    if (!rendered.ok) return fail(`Cannot export as SQL INSERT: ${rendered.message}`);
    const platform = getPlatform();
    let saved: string | null;
    if (path) {
      const c = rendered.content;
      await platform.writeTextFile(path, (typeof c === 'string' ? c : new Uint8Array(await c.arrayBuffer())) as unknown as string);
      saved = path;
    } else {
      saved = await platform.saveFile({
        suggestedName: exportFileName(source.baseName, format), content: rendered.content, mime: EXPORT_MIME[format],
        filters: [{ name: EXPORT_FILTER_NAME[format], extensions: [EXPORT_EXT[format]] }],
      });
      if (!saved) return { status: 'cancelled', rows: 0, path: null, warning: null, error: null };
    }
    return { status: 'ok', rows: block.rows.length, path: saved, warning: rendered.warning, error: null };
  } catch (e) {
    return fail(errorMessage(e));
  }
}

/** The toast at the end of an export: where the file is, with "Open folder" (desktop), and the file opened if asked. */
export function announceOutcome(o: RunOutcome, opts: { openAfter: boolean }): void {
  const platform = getPlatform();
  if (o.status === 'cancelled') {
    toast('info', 'Export cancelled');
    return;
  }
  if (o.status === 'error') {
    toast('error', 'Export failed', o.error ?? undefined);
    return;
  }
  const path = o.path;
  const openFolder = path && platform.revealInFolder ? { label: 'Open folder', run: () => void platform.revealInFolder!(path).catch(() => undefined) } : undefined;
  toast(o.warning ? 'warning' : 'success', `Exported ${o.rows.toLocaleString('en-US')} row${o.rows === 1 ? '' : 's'}`, [path, o.warning].filter(Boolean).join(' · ') || undefined, openFolder);
  if (opts.openAfter && path && platform.openPath) {
    void platform.openPath(path).catch((e) => toast('warning', 'Could not open the file', errorMessage(e)));
  }
}
