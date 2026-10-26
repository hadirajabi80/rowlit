// Lazy query builder tab view (the builder itself is its own chunk) and the clean-up when the tab closes.
import { lazy } from 'react';
import type { ViewTab } from '../../../store/tabs';
import type { TabViewProps } from '../../layout/tabViews';

const LazyView = lazy(() => import('./BuilderView').then((m) => ({ default: m.BuilderView })));

export function BuilderTab(p: TabViewProps) {
  return <LazyView {...p} />;
}

/** The tab closed: its session, results and undo history go. */
export function disposeBuilderTab(tab: ViewTab): void {
  void import('./actions').then((m) => m.disposeBuilder(tab.id));
}
