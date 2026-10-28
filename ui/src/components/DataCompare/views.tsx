// Lazy Data compare tab view (every workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./DataCompareView').then((m) => ({ default: m.DataCompareView })));

export function DataCompareTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading data compare" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
