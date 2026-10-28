// Lazy local history tab view (docs: every new workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./LocalHistoryView').then((m) => ({ default: m.LocalHistoryView })));

export function LocalHistoryTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading local history" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
