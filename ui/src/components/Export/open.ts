// Entry point of the export dialog for the views (Data tab, results pane): loads the dialog on first use, so it adds
// nothing to the initial bundle. `ctx` is the view's state at the moment of "Export…".
import type { ExportContext } from './types';

export function openExportDialog(ctx: ExportContext): Promise<void> {
  return import('./host').then((m) => m.openFromContext(ctx));
}

export type { ExportContext, QueryExportContext, TableExportContext } from './types';
