// Loads the "Set colour…" dialog the first time it opens (the dialog is a lazy chunk).
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useScopeColorDialog } from './dialogStore';

const ScopeColorDialog = lazy(() => import('./ScopeColorDialog').then((m) => ({ default: m.ScopeColorDialog })));

export function ScopeColorDialogHost() {
  const request = useScopeColorDialog((s) => s.request);
  if (!request) return null;
  return (
    <ErrorBoundary area="the colour dialog" variant="dialog" onClose={() => useScopeColorDialog.getState().close()}>
      <Suspense fallback={null}>
        <ScopeColorDialog request={request} />
      </Suspense>
    </ErrorBoundary>
  );
}
