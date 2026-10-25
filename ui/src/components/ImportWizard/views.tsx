// Lazy Import Wizard tab view (docs/PLAN-M2.md D10: every workspace is a lazy() chunk).
import { LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';

const LazyView = lazy(() => import('./ImportWizardView').then((m) => ({ default: m.ImportWizardView })));

export function ImportWizardTab(p: TabViewProps) {
  return (
    <Suspense
      fallback={p.visible ? (
        <div className="workspace-missing" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading import wizard" />
        </div>
      ) : null}
    >
      <LazyView {...p} />
    </Suspense>
  );
}
