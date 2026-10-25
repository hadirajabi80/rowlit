import { useSyncExternalStore } from 'react';
import type { DataGridProps } from './DataGrid';

// The data grid (glide-data-grid with its lodash / marked / carousel dependencies, about 100 KB gzipped) is a chunk of
// its own, kept out of the initial load (docs/PLAN-M2.md D10): the welcome screen and every view without a result grid
// never need it. It is fetched in the background shortly after boot (preloadDataGrid), so the first result rarely
// waits for it; until it arrives the grid area stays empty. Tests load it up front (src/test/setup.ts).
type GridComponent = typeof import('./DataGrid').DataGrid;
let grid: GridComponent | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadDataGrid(): Promise<void> {
  loading ??= import('./DataGrid').then((m) => {
    grid = m.DataGrid;
    listeners.forEach((l) => l());
  });
  return loading;
}

/** Fetches the grid chunk once the app is idle (called at the end of boot). */
export function preloadDataGrid(): void {
  const go = () => void loadDataGrid().catch(() => { loading = null; });
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 1500);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  void loadDataGrid().catch(() => { loading = null; });
  return () => {
    listeners.delete(l);
  };
}

/** DataGrid, loaded on first use. */
export function DataGrid(p: DataGridProps) {
  const Grid = useSyncExternalStore(subscribe, () => grid);
  return Grid ? <Grid {...p} /> : null;
}
