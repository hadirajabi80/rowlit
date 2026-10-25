// Data tabs hold one engine session each (released after a few idle minutes). With "Sessions per connection" (default 8)
// reached, opening one more table must not fail with SESSION_LIMIT while other data tabs only sit on idle sessions: the
// least recently used idle one is released (its tab opens a new session the next time it loads) and the open goes on.
import { hasPending, useEdits } from '../../store/edits';
import { useSessions } from '../../store/sessions';
import { useTabs } from '../../store/tabs';
import { dataGridKey, DATA_VIEW } from './open';

interface Activity {
  /** A statement is running, or queued, on the tab's session. */
  busy: () => boolean;
  /** Epoch ms of the tab's last statement. */
  lastUse: () => number;
}

const tabs = new Map<string, Activity>();

/** A mounted Data tab reports its activity here (and unregisters on unmount). */
export function registerDataTabActivity(tabId: string, a: Activity): () => void {
  tabs.set(tabId, a);
  return () => {
    if (tabs.get(tabId) === a) tabs.delete(tabId);
  };
}

/**
 * Releases ONE session of `connectionId` that nothing needs: an unused session no tab owns, else the idle session of the
 * least recently used Data tab (auto mode, no open transaction, no pending edits, not running, not `exceptTabId`).
 * Returns false when there was nothing safe to release.
 */
export async function releaseIdleDataSession(connectionId: string, exceptTabId: string): Promise<boolean> {
  const sessions = useSessions.getState();
  const orphan = sessions.orphans(connectionId).find((s) => !s.txOpen && s.state !== 'executing');
  if (orphan) {
    await sessions.closeSession(orphan.sessionId, false).catch(() => undefined);
    return true;
  }
  const open = useTabs.getState().tabs;
  const candidates = Object.entries(sessions.byTab)
    .filter(([tabId, sid]) => {
      if (tabId === exceptTabId) return false;
      const t = open.find((x) => x.id === tabId);
      if (!t || t.kind !== 'view' || t.view !== DATA_VIEW) return false;
      const s = sessions.sessions[sid];
      if (!s || s.connectionId !== connectionId || s.txMode !== 'auto' || s.txOpen || s.state === 'executing') return false;
      const a = tabs.get(tabId);
      if (a?.busy()) return false;
      return !hasPending(useEdits.getState().get(dataGridKey(tabId)));
    })
    .map(([tabId]) => ({ tabId, lastUse: tabs.get(tabId)?.lastUse() ?? 0 }))
    .sort((a, b) => a.lastUse - b.lastUse);
  const victim = candidates[0];
  if (!victim) return false;
  await sessions.close(victim.tabId, true).catch(() => undefined);
  return true;
}
