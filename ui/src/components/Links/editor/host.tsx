// Host of the links dialogs (link editor, "Add to linked database…" chooser): a React root of its own in a body-level
// container, so the shell needs no links-specific mount point. One dialog at a time.
import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LinkEditorDialog } from './LinkEditorDialog';
import type { LinkEditorRequest } from './open';

type Render = (close: () => void) => ReactNode;

let root: Root | null = null;
let current: { id: number; render: Render } | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function Host() {
  const c = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  if (!c) return null;
  return <div key={c.id}>{c.render(() => closeIf(c.id))}</div>;
}

function closeIf(id: number): void {
  if (current?.id !== id) return;
  current = null;
  emit();
}

/** Shows a dialog (replacing the one shown); `render` receives `close`. */
export function showLinksDialog(render: Render): void {
  if (!root) {
    const el = document.createElement('div');
    el.className = 'links-dialog-root';
    document.body.appendChild(el);
    root = createRoot(el);
    root.render(<Host />);
  }
  current = { id: ++seq, render };
  emit();
}

export function closeLinksDialog(): void {
  current = null;
  emit();
}

/** Opens the link editor dialog for a request (new / edit / duplicate, optional tables to add). */
export function showLinkEditor(req: LinkEditorRequest): void {
  showLinksDialog((close) => <LinkEditorDialog req={req} onClose={close} />);
}
