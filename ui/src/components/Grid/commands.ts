// Value viewer commands (auto-loaded by commands/index.ts). They act on the grid named by `args.gridKey` (menus pass
// it) or else on the grid that last had focus; the hosts (results pane, Data tab) provide the methods through the grid
// controller, because the viewer panel is theirs.
import type { Command } from '../../commands/registry';
import { activeGridController, gridController, type GridController } from './controller';

const gridOf = (args?: unknown): GridController | undefined => {
  const k = args && typeof args === 'object' ? (args as { gridKey?: string }).gridKey : undefined;
  return k ? gridController(k) : activeGridController();
};

export const commands: Command<never>[] = [
  {
    // Opens the value viewer on the focused cell; in edit mode when the cell can be written.
    id: 'grid.editInViewer', title: 'Edit cell in the value viewer', category: 'Data', shortcut: 'Shift+Enter', scope: 'grid', icon: 'PanelRight',
    keywords: 'edit json xml text blob image hex view value editor',
    when: (a?: unknown) => !!gridOf(a)?.editInViewer, run: (a?: unknown) => gridOf(a)?.editInViewer?.(),
  },
  {
    id: 'grid.saveCellToFile', title: 'Save cell value to file…', category: 'Data', scope: 'grid', icon: 'Download',
    keywords: 'export blob image binary text json xml download',
    when: (a?: unknown) => !!gridOf(a)?.saveCellToFile, run: (a?: unknown) => gridOf(a)?.saveCellToFile?.(),
  },
  {
    id: 'grid.loadCellFromFile', title: 'Load cell value from file…', category: 'Data', scope: 'grid', icon: 'FolderOpen',
    keywords: 'import blob image binary text json xml upload replace',
    when: (a?: unknown) => !!gridOf(a)?.loadCellFromFile, run: (a?: unknown) => gridOf(a)?.loadCellFromFile?.(),
  },
];
