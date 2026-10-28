// REST client of the engine's local history (engine/src/DbStudio.Core/LocalHistory/LocalHistoryModule.cs).
// Keys are opaque strings (see ./keys.ts); they travel in the query string and the body, never in the path.
import { http } from '../../api/client';

export type SnapshotReason = 'run' | 'save' | 'close' | 'auto' | 'restore' | 'manual';

/** One snapshot without its text. `size` is the length of the text in characters. */
export interface SnapshotInfo {
  id: number;
  key: string;
  /** ISO-8601 UTC. */
  at: string;
  reason: SnapshotReason;
  label: string | null;
  size: number;
  title: string | null;
}

export interface SnapshotText extends SnapshotInfo {
  text: string;
}

export interface SnapshotInput {
  key: string;
  text: string;
  reason: SnapshotReason;
  label?: string | null;
  title?: string | null;
}

const enc = encodeURIComponent;

function keysQuery(keys: readonly string[], extra: Record<string, string | number | undefined> = {}): string {
  const parts = keys.map((k) => `key=${enc(k)}`);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) parts.push(`${k}=${enc(String(v))}`);
  return parts.join('&');
}

export const localHistoryApi = {
  add: (input: SnapshotInput) => http.json<{ id: number; added: boolean }>('POST', '/local-history', { body: input }),
  list: (keys: readonly string[], opts: { limit?: number; before?: number } = {}) =>
    http.json<SnapshotInfo[]>('GET', `/local-history?${keysQuery(keys, { limit: opts.limit, before: opts.before })}`),
  get: (id: number) => http.json<SnapshotText>('GET', `/local-history/${id}`),
  label: (id: number, label: string | null) => http.json<SnapshotText>('PATCH', `/local-history/${id}`, { body: { label } }),
  remove: (id: number) => http.json<void>('DELETE', `/local-history/${id}`),
  clear: (keys: readonly string[]) => http.json<{ removed: number }>('DELETE', `/local-history?${keysQuery(keys)}`),
  prune: (days: number) => http.json<{ removed: number; bytes: number }>('POST', '/local-history/prune', { body: { days } }),
};
