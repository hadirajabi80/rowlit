// Import Wizard commands (auto-loaded by commands/index.ts). Kept tiny: the wizard itself is a lazy chunk (./views.tsx).
//   import.open      "Import data…"            explorer table -> load into it; schema / database / connection, the active tab or
//                                              the palette -> choose the table in the wizard
//   import.openNew   "Import into new table…"  explorer schema / database / connection (and tables: the table's schema)
//   import.openFile  "Import data from file…"  palette: asks for the file first
import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { getPlatform } from '../../platform';
import { registerTabView } from '../layout/tabViews';
import { IMPORT_FILE_FILTERS } from './files';
import { importContext, IMPORT_VIEW_ID, openImportWizard } from './open';
import { ImportWizardTab } from './views';

const KEYWORDS = 'import csv tsv excel xlsx json ndjson file load wizard table data navicat';

export const IMPORT_COMMANDS: Command<never>[] = [
  {
    id: 'import.open', title: 'Import data…', category: 'Database', icon: 'FileInput', keywords: KEYWORDS,
    when: (args?: unknown) => !!importContext(args),
    run: (args?: unknown) => {
      const ctx = importContext(args);
      if (ctx) openImportWizard(ctx);
    },
  },
  {
    id: 'import.openNew', title: 'Import into new table…', category: 'Database', icon: 'FileInput', keywords: KEYWORDS,
    when: (args?: unknown) => !!importContext(args, { forceNew: true }),
    run: (args?: unknown) => {
      const ctx = importContext(args, { forceNew: true });
      if (ctx) openImportWizard(ctx);
    },
  },
  {
    id: 'import.openFile', title: 'Import data from file…', category: 'Database', icon: 'FileInput', keywords: KEYWORDS,
    when: (args?: unknown) => !!importContext(args),
    run: async (args?: unknown) => {
      const ctx = importContext(args);
      if (!ctx) return;
      const platform = getPlatform();
      let path: string | null = null;
      if (platform.hasFileSystem) {
        path = await platform.showOpenDialog({ title: 'Import data from file', filters: IMPORT_FILE_FILTERS });
        if (!path) return;
      }
      openImportWizard(ctx, path);
    },
  },
];

let registered = false;

export function registerImportCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(IMPORT_VIEW_ID, { component: ImportWizardTab, icon: 'FileInput' });
  registerCommands(IMPORT_COMMANDS);
  const entry = (command: string) => ({ command, optional: true, hideDisabled: true });
  extendContextMenu('explorer.table', [entry('import.open')]);
  extendContextMenu('explorer.container', [entry('import.openNew')]);
  extendContextMenu('explorer.connection', [entry('import.openNew')]);
}
