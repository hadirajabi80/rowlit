// Resources (docs/resources.md): what the engine holds (GET /resources) and how much memory the app uses, for the
// status-bar item and its popover. A window polls every 30 s (every 5 s while the popover is open) and reports the
// Electron processes' memory with the poll, so the engine compares engine + windows with the memory limit.
import { create } from 'zustand';
import { api } from '../api/client';
import type { ResourcesSnapshot } from '../api/resources';
import type { MemoryLevel } from '../api/types';
import { getPlatform } from '../platform';

interface ResourcesState {
  snapshot: ResourcesSnapshot | null;
  /** Pressure level: the snapshot's, or the last `resources.pressure` event. */
  level: MemoryLevel;
  /** Electron processes (desktop) or the page's JS heap (browser, when the browser tells), bytes; null when unknown. */
  appBytes: number | null;
  error: string | null;
  refresh(): Promise<ResourcesSnapshot | null>;
  setLevel(level: MemoryLevel): void;
  /** The status-bar Resources popover (also opened by the "Resources and memory…" command). */
  open: boolean;
  setOpen(open: boolean): void;
}

interface PerformanceMemory { usedJSHeapSize?: number }

/** Memory of this app outside the engine: Electron's processes, else Chrome's JS heap of this page. */
export async function readAppBytes(): Promise<number | null> {
  try {
    const p = getPlatform();
    if (p.getAppMemory) return (await p.getAppMemory()).totalBytes;
  } catch {
    // older preload or a failed IPC: fall through
  }
  const heap = (globalThis.performance as (Performance & { memory?: PerformanceMemory }) | undefined)?.memory?.usedJSHeapSize;
  return typeof heap === 'number' && heap > 0 ? heap : null;
}

let refreshing: Promise<ResourcesSnapshot | null> | null = null;

export const useResources = create<ResourcesState>((set) => ({
  snapshot: null,
  level: 'normal',
  appBytes: null,
  error: null,
  refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const appBytes = await readAppBytes();
        const snapshot = appBytes !== null ? await api.resources.report(appBytes) : await api.resources.snapshot();
        set({ snapshot, appBytes, level: snapshot.memory.level, error: null });
        return snapshot;
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },
  open: false,
  setOpen(open) {
    set({ open });
  },
  setLevel(level) {
    set({ level });
  },
}));

/** "1.2 GB" / "340 MB" / "12 KB". */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
