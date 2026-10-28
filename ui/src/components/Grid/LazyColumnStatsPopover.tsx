import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';
import type { ColumnStatsPopover as TypeOnly } from './ColumnStatsPopover';

const View = lazy(() => import('./ColumnStatsPopover').then((m) => ({ default: m.ColumnStatsPopover })));
export function LazyColumnStatsPopover(props: ComponentProps<typeof TypeOnly>) {
  return <Suspense fallback={null}><View {...props} /></Suspense>;
}
