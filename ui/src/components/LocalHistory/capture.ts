// Takes the local-history snapshots of console tabs without touching the editor or the stores: it only subscribes to
//   - the tabs store: a new console (baseline of an opened file / restored workspace), a saved text (Save, Save as,
//     Save query, "Edit:" console saved to the database) and a closed console (its last text);
//   - the results store: a new execution in a console (Run);
//   - the text itself: at most one "auto" snapshot per AUTO_INTERVAL_MS while the text keeps changing.
// Identical texts are dropped here (per key) and again by the engine (against the key's latest snapshot).
// Nothing here imports Monaco, so it stays in the initial bundle at a few hundred bytes.
import { useResults } from '../../store/results';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { localHistoryApi, type SnapshotInput, type SnapshotReason } from './api';
import { primaryKey } from './keys';
import { localHistoryEnabled, retentionDays } from './settings';

/** At most one automatic snapshot per this long while the text changes. */
export const AUTO_INTERVAL_MS = 2 * 60 * 1000;

/** The engine refuses larger texts (LocalHistoryService.MaxTextChars). */
const MAX_TEXT = 5_000_000;

type Send = (input: SnapshotInput) => Promise<unknown>;

interface Capture {
  /** Takes a snapshot of the console now (no-op while history is off, the text is blank or unchanged for its key). */
  now(tab: ConsoleTab, text: string, reason: SnapshotReason): void;
  /** Snapshots of consoles with pending automatic captures, now. */
  flush(): void;
  stop(): void;
}

let active: Capture | null = null;

export interface CaptureOptions {
  /** Defaults to the engine REST call. */
  send?: Send;
  /** Defaults to the engine REST call; runs once, after the first stored snapshot. */
  prune?: (days: number) => Promise<unknown>;
  intervalMs?: number;
}

/** Idempotent: a second call returns the running capture. */
export function startLocalHistoryCapture(opts: CaptureOptions = {}): Capture {
  if (active) return active;
  const send: Send = opts.send ?? ((i) => localHistoryApi.add(i));
  const interval = opts.intervalMs ?? AUTO_INTERVAL_MS;
  const prune = opts.prune ?? ((days: number) => localHistoryApi.prune(days));
  const lastByKey = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let pruned = false;
  let warned = false;

  const now: Capture['now'] = (tab, text, reason) => {
    if (!localHistoryEnabled() || text.trim() === '' || text.length > MAX_TEXT) return;
    const key = primaryKey(tab);
    if (lastByKey.get(key) === text) return;
    lastByKey.set(key, text);
    send({ key, text, reason, title: tab.title })
      .then(() => {
        if (pruned) return;
        pruned = true;
        void prune(retentionDays()).catch(() => undefined);
      })
      .catch((e) => {
        lastByKey.delete(key); // try again with the next trigger
        if (!warned) {
          warned = true;
          console.warn('[local history] could not store a snapshot', e);
        }
      });
  };

  const cancel = (tabId: string) => {
    const t = timers.get(tabId);
    if (t) clearTimeout(t);
    timers.delete(tabId);
  };

  const fire = (tabId: string) => {
    timers.delete(tabId);
    const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
    if (tab?.kind === 'console') now(tab, tab.text, 'auto');
  };

  const schedule = (tabId: string) => {
    if (timers.has(tabId)) return;
    timers.set(tabId, setTimeout(() => fire(tabId), interval));
  };

  const offTabs = useTabs.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    const before = new Map<string, ConsoleTab>();
    for (const t of prev.tabs) if (t.kind === 'console') before.set(t.id, t);
    const ids = new Set<string>();
    for (const t of s.tabs) {
      if (t.kind !== 'console') continue;
      ids.add(t.id);
      const p = before.get(t.id);
      if (!p) {
        now(t, t.text, 'auto'); // baseline: the text a file / saved query / object was opened with
        continue;
      }
      if (t.text !== p.text) schedule(t.id);
      if (t.savedText !== p.savedText || t.edit?.savedText !== p.edit?.savedText) {
        cancel(t.id);
        now(t, t.text, 'save');
      }
    }
    for (const [id, p] of before) {
      if (ids.has(id)) continue;
      cancel(id);
      now(p, p.text, 'close');
    }
  });

  const offResults = useResults.subscribe((s, prev) => {
    if (s.byTab === prev.byTab) return;
    for (const [tabId, localId] of Object.entries(s.byTab)) {
      if (prev.byTab[tabId] === localId) continue;
      const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
      if (tab?.kind !== 'console') continue;
      cancel(tabId);
      now(tab, tab.text, 'run');
    }
  });

  const flush = () => {
    for (const id of [...timers.keys()]) {
      cancel(id);
      fire(id);
    }
  };
  const onHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHidden);

  // consoles that exist already (a workspace restored before the commands loaded)
  for (const t of useTabs.getState().tabs) if (t.kind === 'console') now(t, t.text, 'auto');

  active = {
    now,
    flush,
    stop() {
      offTabs();
      offResults();
      for (const id of [...timers.keys()]) cancel(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHidden);
      active = null;
    },
  };
  return active;
}

/** Stops the running capture (tests, hot reload). */
export function stopLocalHistoryCapture(): void {
  active?.stop();
}

/** A snapshot of the console now (palette "Local history" opens with the editor's latest text stored). */
export function captureNow(tab: ConsoleTab, reason: SnapshotReason): void {
  startLocalHistoryCapture().now(tab, tab.text, reason);
}
