// How each result set is shown (by view key): the grid, the chart, or both side by side. Eager and tiny: the result
// toolbar, the palette commands and the data tab read it.
import { create } from 'zustand';
import type { MenuItem } from '../common/Menu';

export type ResultView = 'grid' | 'chart' | 'both';

interface ChartModeState {
  view: Record<string, ResultView>;
  set(key: string, view: ResultView): void;
}

export const useChartMode = create<ChartModeState>((set) => ({
  view: {},
  set: (key, view) =>
    set((s) => {
      if ((s.view[key] ?? 'grid') === view) return s;
      const next = { ...s.view };
      if (view === 'grid') delete next[key];
      else next[key] = view;
      return { view: next };
    }),
}));

/** The current view of one result set (a hook for components, `chartViewOf` for commands). */
export const useResultView = (key: string): ResultView => useChartMode((s) => s.view[key] ?? 'grid');
export const chartViewOf = (key: string): ResultView => useChartMode.getState().view[key] ?? 'grid';

/** Class names of the result body for a view: `chart-on` hides the grid, `chart-both` keeps it next to the chart. */
export const chartBodyClass = (view: ResultView): string => (view === 'grid' ? '' : view === 'both' ? ' chart-on chart-both' : ' chart-on');

/** Grid <-> chart toggle used by the palette command (keeps "both" as chart-only first, a second press returns to the grid). */
export function toggleChart(key: string): ResultView {
  const next: ResultView = chartViewOf(key) === 'grid' ? 'chart' : 'grid';
  useChartMode.getState().set(key, next);
  return next;
}

/** Items of the overflow ("...") menu while the Grid | Chart | Both switch is collapsed. */
export function chartToggleMenu(viewKey: string, disabled?: boolean): MenuItem[] {
  const cur = chartViewOf(viewKey);
  const set = (v: ResultView) => () => useChartMode.getState().set(viewKey, v);
  return [
    { label: 'Show grid', checked: cur === 'grid', onClick: set('grid') },
    { label: 'Show chart', checked: cur === 'chart', disabled, onClick: set('chart') },
    { label: 'Show grid and chart', checked: cur === 'both', disabled, onClick: set('both') },
  ];
}
