// A self-hosted modal for the links wizards: the shell has no generic dialog host (App.tsx is frozen for this package), so a
// wizard mounts its own React root on <body> when a command opens it and removes it when it closes. The dialog chunk is
// imported by the command, never by the initial bundle.
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from '../../common/ErrorBoundary';

const open = new Map<string, () => void>();

/**
 * Mounts `render(close)` in its own root and returns `close`. One dialog per `key`: opening it again closes the first
 * (a double click on a menu entry must not stack two dialogs).
 */
export function mountDialog(key: string, area: string, render: (close: () => void) => ReactNode): () => void {
  open.get(key)?.();
  const host = document.createElement('div');
  host.dataset.linksDialog = key;
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open.delete(key);
    // unmount after the current event: closing from inside a React handler of this very root
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
  open.set(key, close);
  root.render(
    <ErrorBoundary area={area} variant="dialog" onClose={close}>
      {render(close)}
    </ErrorBoundary>,
  );
  return close;
}
