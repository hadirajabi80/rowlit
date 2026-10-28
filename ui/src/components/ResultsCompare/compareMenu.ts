// "Compare with…" menu of a result set. Lazy: the results toolbar loads it on the first click (pin.ts showCompareMenu), the
// palette command imports it directly; it carries the comparison registry (sources.ts) and the tab opener (open.ts).
import type { MenuItem } from '../common/Menu';
import { openComparison } from './open';
import type { ShownResult } from './pin';
import { compareChoices, currentSet, type CompareChoice } from './sources';

/** Menu items: the other result sets of the run, then the pinned results of every console. */
export function compareMenu(tabId: string, shown: ShownResult): MenuItem[] {
  const choices = compareChoices(tabId, shown);
  const from = currentSet(tabId, shown);
  const items: MenuItem[] = [];
  const add = (group: CompareChoice['group'], heading: string) => {
    const list = choices.filter((c) => c.group === group);
    if (!list.length) return;
    if (items.length) items.push({ separator: true });
    items.push({ label: heading, disabled: true });
    // The chosen result is the baseline (A), the one being looked at the newer one (B): "added" reads as new in this result.
    for (const c of list) items.push({ label: `${c.label}  ·  ${c.detail}`, onClick: () => from && openComparison(c.set, from) });
  };
  add('run', 'Result sets of this run');
  add('pinned', 'Pinned results');
  if (!items.length) items.push({ label: 'Nothing to compare with yet: pin a result, run again, then compare', disabled: true });
  return items;
}
