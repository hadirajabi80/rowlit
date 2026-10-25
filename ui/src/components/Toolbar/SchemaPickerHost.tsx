// Loads the schema picker the first time it opens (the picker is a lazy chunk, so the toolbar pill costs the initial
// bundle only the pill itself).
import { lazy, Suspense } from 'react';
import { useUi } from '../../store/ui';

const SchemaPicker = lazy(() => import('./SchemaPicker').then((m) => ({ default: m.SchemaPicker })));

export function SchemaPickerHost() {
  const sw = useUi((s) => s.switcher);
  if (!sw || sw.mode !== 'schema') return null;
  return (
    <Suspense fallback={null}>
      <SchemaPicker key={sw.tabId} />
    </Suspense>
  );
}
