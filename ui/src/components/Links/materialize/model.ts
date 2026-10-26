// Materialize dialog: pure rules (table name validation, the default table name, the engine request and the job events).
// Lazy: imported by the dialog and the commands only after the dialog opens.
import type { JobDoneEvent, JobProgressEvent, QueryParam } from '../../../api/types';
import type { MaterializeMode, MaterializeRequest, MaterializeResult, PlanWarning } from '../../../api/links';

export const MODES: readonly { mode: MaterializeMode; label: string; help: string }[] = [
  { mode: 'create', label: 'Create table', help: 'Creates the table; fails when the name is already taken.' },
  { mode: 'replace', label: 'Replace table', help: 'Drops the table if it exists and creates it again from the result.' },
  { mode: 'append', label: 'Append rows', help: 'Adds the rows to an existing table; columns are matched by name.' },
];

/** What is being materialized: a query, or a saved linked view (the engine runs either with the link's session cache). */
export interface MaterializeSource {
  /** The link (a connection with providerId `linked`). */
  connectionId: string;
  sql?: string | null;
  viewId?: string | null;
  params?: QueryParam[] | null;
  /** Console session whose fetched sources are reused (no second round trip to the member databases). */
  sessionId?: string | null;
  /** Table name proposal (a linked view's name). */
  name?: string | null;
}

export const MAX_TABLE_NAME = 128;

/** The first problem with a table name, or null. `exists` comes from the DDL preview (`tableExists`). */
export function tableNameIssue(name: string, mode: MaterializeMode, exists: boolean | null): string | null {
  if (!name) return 'Enter the name of the table.';
  if (name !== name.trim()) return 'The name cannot start or end with a space.';
  if (name.length > MAX_TABLE_NAME) return `The name is longer than ${MAX_TABLE_NAME} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return 'The name cannot contain control characters.';
  if (mode === 'create' && exists === true) return `A table named "${name}" already exists here. Choose another name, or Replace / Append.`;
  if (mode === 'append' && exists === false) return `There is no table named "${name}" to append to. Choose Create table instead.`;
  return null;
}

/** `customers` of `FROM crm.customers` → `customers_materialized`; falls back to the link-agnostic `query_result`. */
export function defaultTableName(source: Pick<MaterializeSource, 'sql' | 'name'>): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (source.name) {
    const s = slug(source.name);
    if (s) return /^[0-9]/.test(s) ? `v_${s}` : s;
  }
  const m = source.sql ? /\bfrom\s+(?:"([^"]+)"|([A-Za-z_][\w]*))\s*\.\s*(?:"([^"]+)"|([A-Za-z_][\w]*))/i.exec(source.sql) : null;
  const t = m ? slug(m[3] ?? m[4] ?? '') : '';
  return t ? `${t}_materialized` : 'query_result';
}

export interface MaterializeTarget {
  connectionId: string;
  /** Only providers with a database level (SQL Server, PostgreSQL, Snowflake) take one. */
  database: string | null;
  schema: string | null;
  table: string;
  mode: MaterializeMode;
}

/** POST /links/{cid}/materialize[/preview] body. */
export function buildRequest(source: MaterializeSource, target: MaterializeTarget): MaterializeRequest {
  return {
    ...(source.viewId ? { viewId: source.viewId } : { sql: stripTrailingSemicolon(source.sql ?? '') }),
    ...(source.params?.length ? { params: source.params } : {}),
    targetConnectionId: target.connectionId,
    database: target.database,
    schema: target.schema,
    table: target.table,
    mode: target.mode,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
  };
}

export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/[\s;]+$/, '');
}

/** True when the source can be sent: a view id, or non-empty SQL. */
export function hasSource(source: Pick<MaterializeSource, 'sql' | 'viewId'>): boolean {
  return !!source.viewId || !!(source.sql && stripTrailingSemicolon(source.sql).trim());
}

export interface MaterializeProgress {
  rows: number;
  total: number | null;
  message: string | null;
}

/**
 * `job.progress` of a materialize job: `done` is the number of rows written, `total` the expected count when the engine
 * knows it; the message is a short phase text (or JSON `{rows, total, phase}` from newer engines).
 */
export function readProgress(ev: Pick<JobProgressEvent, 'done' | 'total' | 'message'>): MaterializeProgress {
  let rows = ev.done;
  let total = ev.total;
  let message = ev.message ?? null;
  if (message && message.startsWith('{')) {
    try {
      const j = JSON.parse(message) as { rows?: number; total?: number | null; phase?: string; message?: string };
      if (typeof j.rows === 'number') rows = j.rows;
      if (typeof j.total === 'number') total = j.total;
      message = j.phase ?? j.message ?? null;
    } catch {
      // keep the raw text
    }
  }
  return { rows: Math.max(0, rows), total: total != null && total > 0 ? total : null, message };
}

export function progressPercent(p: MaterializeProgress | null): number | null {
  return p && p.total ? Math.max(0, Math.min(100, (p.rows / p.total) * 100)) : null;
}

export interface MaterializeEnd {
  status: 'ok' | 'error' | 'cancelled';
  error: string | null;
  result: MaterializeResult | null;
}

export function readEnd(ev: Pick<JobDoneEvent, 'status' | 'error' | 'result'>): MaterializeEnd {
  const r = ev.result as Partial<MaterializeResult> | null | undefined;
  const result: MaterializeResult | null = r && typeof r === 'object' && typeof r.table === 'string'
    ? {
        targetConnectionId: r.targetConnectionId ?? '', database: r.database ?? null, schema: r.schema ?? null, table: r.table,
        rows: Number(r.rows ?? 0), elapsedMs: Number(r.elapsedMs ?? 0), warnings: (r.warnings ?? []) as PlanWarning[],
      }
    : null;
  return { status: ev.status, error: ev.error ?? null, result };
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${(ms / 1000).toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
