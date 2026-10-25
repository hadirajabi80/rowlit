// Details side panel of the Objects tab (dependencies of the selected object): persisted state, width maths and the
// per-object dependency cache. Pure and unit-tested; the view is ObjectDetailsPanel.tsx (a lazy chunk).
import type { DependencyGraph } from '../../api/types.objects';

/** Persisted with the tab (workspace): open / closed and the width in px. */
export interface DetailsState {
  open: boolean;
  width: number;
}

export const DETAILS_MIN_W = 260;
export const DETAILS_MAX_W = 640;
export const DETAILS_DEFAULT_W = 340;
/** The list keeps at least this much room next to the panel. */
export const LIST_MIN_W = 360;
/** Below this tab width the panel is hidden (the toolbar toggle still shows it as an overlay). */
export const DETAILS_NARROW_BELOW = 720;
/** Selection → dependency request delay (arrowing through the list does not request every row). */
export const DETAILS_DEBOUNCE_MS = 150;

export const DEFAULT_DETAILS: DetailsState = { open: true, width: DETAILS_DEFAULT_W };

export function clampDetailsWidth(width: number, containerWidth?: number): number {
  const w = Number.isFinite(width) ? width : DETAILS_DEFAULT_W;
  const max = containerWidth ? Math.max(DETAILS_MIN_W, Math.min(DETAILS_MAX_W, containerWidth - LIST_MIN_W)) : DETAILS_MAX_W;
  return Math.round(Math.max(DETAILS_MIN_W, Math.min(max, w)));
}

/** The persisted value, repaired (a workspace from another build, a hand-edited file). */
export function detailsOf(raw: unknown): DetailsState {
  if (!raw || typeof raw !== 'object') return DEFAULT_DETAILS;
  const r = raw as Partial<DetailsState>;
  return {
    open: typeof r.open === 'boolean' ? r.open : DEFAULT_DETAILS.open,
    width: typeof r.width === 'number' ? clampDetailsWidth(r.width) : DEFAULT_DETAILS.width,
  };
}

// ------------------------------------------------------------------------------------- toggle requests (palette)

const toggleListeners = new Set<(tabId: string) => void>();

/** The "Show / hide details panel" command asks the Objects tab with this id to toggle; the mounted list answers. */
export function requestDetailsToggle(tabId: string): void {
  for (const l of [...toggleListeners]) l(tabId);
}

export function onDetailsToggle(fn: (tabId: string) => void): () => void {
  toggleListeners.add(fn);
  return () => void toggleListeners.delete(fn);
}

// ----------------------------------------------------------------------------------------------- dependency cache

const TTL_MS = 60_000;
const MAX_ENTRIES = 80;
const cache = new Map<string, { at: number; graph: DependencyGraph }>();

/** The graph fetched for `key` less than a minute ago (the key carries the catalog version, so a DDL change misses). */
export function cachedDetails(key: string, now = Date.now()): DependencyGraph | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key); // most recently used last
  cache.set(key, hit);
  return hit.graph;
}

export function rememberDetails(key: string, graph: DependencyGraph, now = Date.now()): void {
  cache.delete(key);
  cache.set(key, { at: now, graph });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

export function forgetDetails(key?: string): void {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}
