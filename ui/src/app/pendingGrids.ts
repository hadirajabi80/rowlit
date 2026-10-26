// Grids with unsaved edits (Data tabs and editable console results), for "Close connection" / "Close database" /
// "Disconnect all": those must not silently lose their edits, so the user chooses Save / Discard / Cancel first.
import { DATA_VIEW, dataGridKey } from '../components/DataTab/open';
import { hasPending, useEdits } from '../store/edits';
import { useResults, viewKey } from '../store/results';
import { useSessions } from '../store/sessions';
import { useTabs } from '../store/tabs';

export interface PendingGrid {
  gridKey: string;
  tabId: string;
  /** "customers" / "Console 1". */
  title: string;
  connectionId: string;
  /** Registered by a mounted Data tab: saves its edits; null for console results (they can only be discarded here). */
  save: (() => Promise<boolean>) | null;
}

const savers = new Map<string, () => Promise<boolean>>();

/** A mounted Data tab registers how to save its pending edits (true = saved, or nothing to save). Returns the unregister. */
export function registerGridSaver(gridKey: string, save: () => Promise<boolean>): () => void {
  savers.set(gridKey, save);
  return () => {
    if (savers.get(gridKey) === save) savers.delete(gridKey);
  };
}

const sameDb = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Grids of this window with pending edits on the connection (one database of it when given; every connection when omitted). */
export function pendingGrids(connectionId?: string, database?: string | null): PendingGrid[] {
  const out: PendingGrid[] = [];
  const edits = useEdits.getState();
  const sessions = useSessions.getState();
  const tabs = useTabs.getState().tabs;
  for (const t of tabs) {
    if (t.kind !== 'view' || t.view !== DATA_VIEW || !t.connectionId) continue;
    if (connectionId && t.connectionId !== connectionId) continue;
    if (database != null && !sameDb(sessions.forTab(t.id)?.database ?? t.database, database)) continue;
    const key = dataGridKey(t.id);
    if (hasPending(edits.get(key))) out.push({ gridKey: key, tabId: t.id, title: t.title, connectionId: t.connectionId, save: savers.get(key) ?? null });
  }
  const { executions } = useResults.getState();
  for (const e of Object.values(executions)) {
    if (!e.connectionId || (connectionId && e.connectionId !== connectionId)) continue;
    if (database != null && !sameDb(sessions.forTab(e.tabId)?.database, database)) continue;
    for (const rs of e.resultSets) {
      const key = viewKey(e.localId, rs.id);
      if (!hasPending(edits.get(key))) continue;
      out.push({ gridKey: key, tabId: e.tabId, title: tabs.find((t) => t.id === e.tabId)?.title ?? 'A console', connectionId: e.connectionId, save: null });
    }
  }
  return out;
}
