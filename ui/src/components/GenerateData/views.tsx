// Lazy Generate data tab view (every workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./GenerateDataView').then((m) => ({ default: m.GenerateDataView })));

export function GenerateDataTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading data generator" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
