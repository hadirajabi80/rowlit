// Lazy result-comparison tab view (docs/PLAN-M2.md D10: every new workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./ResultsCompareView').then((m) => ({ default: m.ResultsCompareView })));

export function ResultsCompareTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading comparison" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
