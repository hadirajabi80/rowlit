// Data compare commands (auto-loaded by commands/index.ts). Kept tiny: the view itself is a lazy chunk (./views.tsx).
//   data.compare  "Compare data…"  explorer table / view (source pre-filled, pick the other side), schema / database /
//                                  connection, the Database menu and the palette
import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { DATA_COMPARE_VIEW_ID, dataCompareSourceOf, openDataCompare } from './open';
import { DataCompareTab } from './views';

const KEYWORDS = 'data compare diff rows sync synchronize synchronization table records redgate navicat datagrip';

export const DATA_COMPARE_COMMANDS: Command<never>[] = [
  {
    id: 'data.compare', title: 'Compare data…', category: 'Database', icon: 'Rows3', keywords: KEYWORDS,
    // From an explorer node: only relational tables / views / containers. Elsewhere: always (the pickers start empty).
    when: (args?: unknown) => !(args && typeof args === 'object' && 'kind' in args) || !!dataCompareSourceOf(args),
    run: (args?: unknown) => {
      openDataCompare(dataCompareSourceOf(args));
    },
  },
];

let registered = false;

export function registerDataCompareCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(DATA_COMPARE_VIEW_ID, { component: DataCompareTab, icon: 'Rows3' });
  registerCommands(DATA_COMPARE_COMMANDS);
  const entry = { command: 'data.compare', optional: true, hideDisabled: true };
  for (const menu of ['explorer.table', 'explorer.view', 'explorer.container']) extendContextMenu(menu, [entry]);
}
