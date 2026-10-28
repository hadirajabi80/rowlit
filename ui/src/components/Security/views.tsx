import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';
const View = lazy(() => import('./SecurityView').then((m) => ({ default: m.SecurityView })));
export function SecurityTab(p: TabViewProps) { return <Suspense fallback={null}><View {...p}/></Suspense>; }
