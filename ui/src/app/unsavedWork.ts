// What would be lost if this window went away right now (an update restart, a quit): edits in a grid that were not
// submitted, and open transactions (the engine session ends, the server rolls the transaction back). Consoles are not
// listed: their text lives in the workspace file and comes back on the next start.
import { pluralize } from '../components/common/text';
import { dataGridKey } from '../components/DataTab/open';
import { hasPending, useEdits } from '../store/edits';
import { useResults, viewKey } from '../store/results';
import { useSessions } from '../store/sessions';
import { useTabs } from '../store/tabs';

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
  const live = liveGridKeys();
  const pendingGrids = Object.entries(useEdits.getState().buffers).filter(([key, b]) => live.has(key) && hasPending(b)).length;
  const openTransactions = Object.values(useSessions.getState().sessions).filter((s) => s.txOpen && !s.released).length;
  return { pendingGrids, openTransactions };
}

/** "2 grids with unsaved changes and 1 open transaction", or null when nothing would be lost. */
export function describeUnsavedWork(w: UnsavedWork = unsavedWork()): string | null {
  const parts: string[] = [];
  if (w.pendingGrids) parts.push(`${pluralize(w.pendingGrids, 'grid')} with unsaved changes`);
  if (w.openTransactions) parts.push(pluralize(w.openTransactions, 'open transaction'));
  return parts.length ? parts.join(' and ') : null;
}
