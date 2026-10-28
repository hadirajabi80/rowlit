import { lazy, Suspense } from 'react';
import type { TabViewProps } from '../layout/tabViews';
const View = lazy(() => import('./BookmarksView').then((m) => ({ default: m.BookmarksView })));
export function BookmarksTab(p: TabViewProps) { return <Suspense fallback={null}><View {...p} /></Suspense>; }
