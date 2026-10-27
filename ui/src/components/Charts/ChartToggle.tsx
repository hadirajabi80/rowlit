// The only eager part of the charts feature: the "Grid | Chart" switch of a result set and the Suspense wrapper that
// loads the chart module on first use. Everything else lives in the lazy ChartPanel chunk.
import { ChartColumn, Columns2, LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useChartMode, useResultView } from './chartMode';
import type { ChartPanelProps } from './ChartPanel';
import './chartToggle.css';

const LazyPanel = lazy(() => import('./ChartPanel'));

/** Segmented "Grid | Chart | Both" switch for the result set toolbar. */
export function ChartToggle({ viewKey, disabled }: { viewKey: string; disabled?: boolean }) {
  const view = useResultView(viewKey);
  const set = useChartMode((s) => s.set);
  return (
    <div className="segmented chart-toggle" role="group" aria-label="Result view">
      <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => set(viewKey, 'grid')}>
        Grid
      </button>
      <button className={view === 'chart' ? 'on' : ''} aria-pressed={view === 'chart'} disabled={disabled} onClick={() => set(viewKey, 'chart')} title="Chart this result">
        <ChartColumn size={12} /> Chart
      </button>
      <button className={view === 'both' ? 'on' : ''} aria-pressed={view === 'both'} disabled={disabled} onClick={() => set(viewKey, 'both')} title="Show the grid and the chart side by side" aria-label="Grid and chart">
        <Columns2 size={12} />
      </button>
    </div>
  );
}

export function ChartPanel(props: ChartPanelProps) {
  return (
    <Suspense
      fallback={
        <div className="chart-loading" role="status">
          <LoaderCircle size={16} className="spin" aria-label="Loading chart" />
        </div>
      }
    >
      <LazyPanel {...props} />
    </Suspense>
  );
}
