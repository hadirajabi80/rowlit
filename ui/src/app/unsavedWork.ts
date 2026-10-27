// What would be lost if this window went away right now (an update restart, a quit, closing the window): edits in a
// grid that were not submitted, and open transactions (the engine session ends, the server rolls the transaction back).
// Consoles are not listed: their text lives in the workspace file and comes back on the next start.
import { pluralize } from '../components/common/text';
import { dataGridKey } from '../components/DataTab/open';
import type { UnsavedWorkReport } from '../platform/bridge';
import { getConnection } from '../store/connections';
import { hasPending, pendingCount, useEdits } from '../store/edits';
import { useResults, viewKey } from '../store/results';
import { isForeignSession, useSessions } from '../store/sessions';
import { useTabs } from '../store/tabs';

export type { UnsavedWorkReport };

export interface UnsavedWork {
  /** Grids with edits that were not submitted. */
  pendingGrids: number;
  /** Sessions with an open transaction. */
  openTransactions: number;
}

/** Edit-buffer keys of grids that are still on screen somewhere: the data tabs, and the result sets of live executions. */
function liveGridKeys(): Set<string> {
  const keys = new Set<string>();
  for (const t of useTabs.getState().tabs) keys.add(dataGridKey(t.id));
  for (const e of Object.values(useResults.getState().executions)) for (const rs of e.resultSets) keys.add(viewKey(e.localId, rs.id));
  return keys;
}

export function unsavedWork(): UnsavedWork {
  const r = unsavedWorkReport({ foreign: true });
  return { pendingGrids: r.grids, openTransactions: r.transactions.length };
}

/**
 * The full report: grids, row edits, and the open transactions with their connection's name. `foreign: false` leaves
 * out sessions another live window uses (they are that window's to report, and closing this one does not end them).
 */
export function unsavedWorkReport(opts: { foreign?: boolean } = {}): UnsavedWorkReport {
  const live = liveGridKeys();
  let grids = 0;
  let edits = 0;
  for (const [key, b] of Object.entries(useEdits.getState().buffers)) {
    if (!live.has(key) || !hasPending(b)) continue;
    grids++;
    edits += pendingCount(b.pending);
  }
  const transactions = Object.values(useSessions.getState().sessions)
    .filter((s) => s.txOpen && !s.released && (opts.foreign !== false || !isForeignSession(s)))
    .map((s) => ({ sessionId: s.sessionId, connection: getConnection(s.connectionId)?.name ?? '' }));
  return { grids, edits, transactions };
}

export function hasUnsavedWork(r: UnsavedWorkReport): boolean {
  return r.grids > 0 || r.transactions.length > 0;
}

/** "Prod", "Prod and Dev", "Prod, Dev, QA and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.length > 3 ? names.slice(0, 3) : names.slice(0, -1);
  const rest = names.length > 3 ? `${names.length - 3} more` : names[names.length - 1];
  return `${shown.join(', ')} and ${rest}`;
}

/**
 * "5 unsaved edits in 2 grids and an open transaction on Prod", or null when nothing would be lost. Works on a
 * report of this window (unsavedWork) or the merged report of every window main asked.
 */
export function describeUnsavedWork(r: UnsavedWorkReport = unsavedWorkReport({ foreign: true })): string | null {
  const parts: string[] = [];
  if (r.grids) {
    const edits = Math.max(r.edits, r.grids);
    parts.push(`${pluralize(edits, 'unsaved edit')} in ${pluralize(r.grids, 'grid')}`);
  }
  const tx = r.transactions.length;
  if (tx) {
    const names = [...new Set(r.transactions.map((t) => t.connection).filter(Boolean))];
    const on = names.length ? ` on ${nameList(names)}` : '';
    parts.push(tx === 1 ? `an open transaction${on}` : `${pluralize(tx, 'open transaction')}${on}`);
  }
  return parts.length ? parts.join(' and ') : null;
}
