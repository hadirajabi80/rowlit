// Mounts the export dialog on demand (this module is a lazy chunk: nothing here is in the initial bundle). The dialog
// gets its own React root in #portal, so opening it needs no state in the app shell.
import { createRoot, type Root } from 'react-dom/client';
import { ExportDialog } from './ExportDialog';
import { buildQuerySource, buildTableSource } from './sources';
import type { ExportContext, ExportSource } from './types';

let mounted: { root: Root; host: HTMLElement } | null = null;

export function sourceOf(ctx: ExportContext): ExportSource {
  return ctx.kind === 'table' ? buildTableSource(ctx) : buildQuerySource(ctx);
}

export function closeExportDialog(): void {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  root.unmount();
  host.remove();
}

export function showExportDialog(source: ExportSource): void {
  closeExportDialog();
  const host = document.createElement('div');
  host.className = 'ex-host';
  (document.getElementById('portal') ?? document.body).appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(<ExportDialog source={source} onClose={closeExportDialog} />);
}

export function openFromContext(ctx: ExportContext): void {
  showExportDialog(sourceOf(ctx));
}
