// Excel export is offered wherever CSV is (results pane and Data tab Export menu, toolbars, palette) and runs the
// grid controller's export with the 'xlsx' format.
import { describe, expect, it, vi } from 'vitest';
import { getCommand, runCommand } from '../../commands/registry';
import { registerGridController, type GridController } from '../Grid/controller';
import { DATATAB_TOOLBAR, GRID_EXPORT_MENU, RESULTS_TOOLBAR } from '../ResultsPane/toolbarModel';
import { GRID_COMMANDS, registerGridCommands } from './commands';

const ids = (entries: typeof GRID_EXPORT_MENU) => entries.flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));

describe('grid export commands', () => {
  it('registers Export Excel next to Export CSV', () => {
    const exports = GRID_COMMANDS.filter((c) => c.id.startsWith('grid.export.')).map((c) => c.id);
    expect(exports).toEqual(['grid.export.csv', 'grid.export.xlsx', 'grid.export.json', 'grid.export.sqlInsert']);
    const xlsx = GRID_COMMANDS.find((c) => c.id === 'grid.export.xlsx')!;
    expect(xlsx.title).toBe('Export Excel (.xlsx)…');
    expect(xlsx.keywords).toMatch(/excel/);
    for (const menu of [GRID_EXPORT_MENU, RESULTS_TOOLBAR, DATATAB_TOOLBAR]) {
      const list = ids(menu);
      expect(list.indexOf('grid.export.xlsx')).toBe(list.indexOf('grid.export.csv') + 1);
    }
  });

  it('"Export data…" opens the export dialog of the grid and heads the Export menu', async () => {
    expect(ids(GRID_EXPORT_MENU)[0]).toBe('grid.export');
    registerGridCommands();
    const openExport = vi.fn();
    const off = registerGridController({ key: 'g-dlg', editable: false, openExport } as unknown as GridController);
    await runCommand('grid.export', { gridKey: 'g-dlg' });
    expect(openExport).toHaveBeenCalledOnce();
    off();
  });

  it("runs the grid's exportAs with the xlsx format", async () => {
    registerGridCommands();
    expect(getCommand('grid.export.xlsx')).toBeTruthy();
    const exportAs = vi.fn();
    const off = registerGridController({ key: 'g-xlsx', editable: false, exportAs } as unknown as GridController);
    await runCommand('grid.export.xlsx', { gridKey: 'g-xlsx' });
    expect(exportAs).toHaveBeenCalledWith('xlsx');
    off();
  });
});
