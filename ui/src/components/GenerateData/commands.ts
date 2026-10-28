// Generate data commands (auto-loaded by commands/index.ts). Tiny: the tab is a lazy chunk (./views.tsx).
//   data.generate  "Generate data…"   explorer tables, the table's Data tab toolbar, the palette (active table)
// The explorer entry is added with extendContextMenu (not by editing the shell's menu model).
import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { generateContext, GENERATE_VIEW_ID, openGenerateData } from './open';
import { GenerateDataTab } from './views';

const KEYWORDS = 'generate mock test fake sample random seed data fill rows populate faker';

export const GENERATE_COMMANDS: Command<never>[] = [
  {
    id: 'data.generate', title: 'Generate data…', category: 'Database', icon: 'Dices', keywords: KEYWORDS,
    when: (args?: unknown) => !!generateContext(args),
    run: (args?: unknown) => {
      const ctx = generateContext(args);
      if (ctx) openGenerateData(ctx);
    },
  },
];

let registered = false;

export function registerGenerateDataCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(GENERATE_VIEW_ID, { component: GenerateDataTab, icon: 'Dices' });
  registerCommands(GENERATE_COMMANDS);
  extendContextMenu('explorer.table', [{ command: 'data.generate', optional: true, hideDisabled: true }]);
}
