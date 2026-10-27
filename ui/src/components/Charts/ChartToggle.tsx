// The only eager part of the charts feature: the "Grid | Chart" switch of a result set and the Suspense wrapper that
// loads the chart module on first use. Everything else lives in the lazy ChartPanel chunk.
import { ChartColumn, LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useChartMode } from './chartMode';
import type { ChartPanelProps } from './ChartPanel';
import './chartToggle.css';

const LazyPanel = lazy(() => import('./ChartPanel'));

/** Segmented "Grid | Chart" switch for the result set toolbar. */
export function ChartToggle({ viewKey, disabled }: { viewKey: string; disabled?: boolean }) {
  const chart = useChartMode((s) => !!s.on[viewKey]);
  const set = useChartMode((s) => s.set);
  return (
    <div className="segmented chart-toggle" role="group" aria-label="Result view">
      <button className={chart ? '' : 'on'} aria-pressed={!chart} onClick={() => set(viewKey, false)}>
        Grid
      </button>
      <button className={chart ? 'on' : ''} aria-pressed={chart} disabled={disabled} onClick={() => set(viewKey, true)} title="Chart this result">
        <ChartColumn size={12} /> Chart
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
