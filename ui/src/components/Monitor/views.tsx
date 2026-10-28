import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';
const View = lazy(() => import('./MonitorView').then((m) => ({ default: m.MonitorView })));
export function MonitorTab(p: TabViewProps) { return <Suspense fallback={null}><View {...p}/></Suspense>; }
