import { lazy, Suspense, type ComponentProps } from 'react';

// The value viewer (modes, editor, image preview, file helpers) is a chunk of its own: it is only needed once a cell is
// opened in it, so the result views keep it out of the initial load. Monaco, for editing, loads on top of that.
const Viewer = lazy(() => import('./CellViewer').then((m) => ({ default: m.CellViewer })));

/** CellViewer, loaded on first use. */
export function CellViewer(p: ComponentProps<typeof Viewer>) {
  return (
    <Suspense fallback={<div className="cell-viewer-empty">Loading…</div>}>
      <Viewer {...p} />
    </Suspense>
  );
}
