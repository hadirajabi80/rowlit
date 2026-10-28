// Pin / compare helpers used by the results pane (tab strip, toolbar) and the palette commands. Eager and tiny: the
// comparison code itself (compareMenu.ts, sources.ts, the view) loads on first use.
import { useResults } from '../../store/results';
import { toast } from '../../store/ui';
import { showMenuBelow } from '../common/Menu';

/** What a results pane shows: a result set of the console's latest run, or one of its pinned results. */
export interface ShownResult {
  rsId?: number;
  pinId?: string;
}

/**
 * Pin the result set, or unpin the pinned result, that the pane shows. Returns true when it pinned, false when it
 * unpinned, null when nothing changed (the reason is toasted).
 */
export function togglePin(tabId: string, shown: ShownResult): boolean | null {
  const r = useResults.getState();
  if (shown.pinId !== undefined) {
    r.unpin(tabId, shown.pinId);
    return false;
  }
  if (shown.rsId === undefined) return null;
  const out = r.pin(tabId, shown.rsId);
  if ('error' in out) {
    toast('info', 'Cannot pin this result', out.error);
    return null;
  }
  return true;
}

/** Opens the "Compare with…" menu below `el` (loads the comparison code on the first call). */
export async function showCompareMenu(el: HTMLElement, tabId: string, shown: ShownResult): Promise<void> {
  const { compareMenu } = await import('./compareMenu');
  showMenuBelow(el, compareMenu(tabId, shown));
}
