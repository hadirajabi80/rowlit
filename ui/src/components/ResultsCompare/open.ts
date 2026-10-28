// Opens a comparison tab. Eager and tiny (the results toolbar and the palette command use it); the view is lazy.
import { useTabs } from '../../store/tabs';
import { registerComparison, type CompareSet } from './sources';

export const COMPARE_VIEW = 'results-compare';

export interface CompareTabState {
  compareId: string;
}

/** Compare tab for two snapshots: `left` is "A" (the baseline), `right` is "B" (rows only in B are "added"). */
export function openComparison(left: CompareSet, right: CompareSet): string {
  const compareId = registerComparison({ left, right });
  const state: CompareTabState = { compareId };
  return useTabs.getState().openView({
    view: COMPARE_VIEW, title: `Compare: ${left.title} ⇄ ${right.title}`, connectionId: left.connectionId, state, key: compareId,
  });
}
