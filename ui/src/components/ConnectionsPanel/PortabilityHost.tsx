// Mounts the export / import connections dialogs on demand (this module and both dialogs are a lazy chunk: nothing here is
// in the initial bundle). Each dialog gets its own React root in #portal, like the export dialog, so opening one needs no
// state in the app shell. One dialog at a time.
import { createRoot, type Root } from 'react-dom/client';
import { ExportConnectionsDialog } from './ExportConnectionsDialog';
import { ImportConnectionsDialog } from './ImportConnectionsDialog';

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closePortabilityDialog(): void {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  root.unmount();
  host.remove();
}

function mount(render: (close: () => void) => React.ReactElement): void {
  closePortabilityDialog();
  const host = document.createElement('div');
  host.className = 'cp-host';
  (document.getElementById('portal') ?? document.body).appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(render(closePortabilityDialog));
}

/** `preselect`: ids ticked on open (a folder's or one connection); none = all. */
export function showExportConnections(preselect?: string[]): void {
  mount((close) => <ExportConnectionsDialog preselect={preselect} onClose={close} />);
}

export function showImportConnections(): void {
  mount((close) => <ImportConnectionsDialog onClose={close} />);
}
