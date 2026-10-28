// Lazy Data Transfer tab view (every workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./TransferView').then((m) => ({ default: m.TransferView })));

export function TransferTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading data transfer" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
