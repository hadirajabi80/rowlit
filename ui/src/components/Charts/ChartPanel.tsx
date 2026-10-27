// The chart view of one result set (lazy chunk): builder, responsive SVG chart, export. The module is loaded the
// first time the user switches a result to "Chart", so it adds nothing to the initial bundle.
import { ChevronDown, Copy, Download, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnInfo } from '../../api/types';
import { formatCount } from '../../lib/format';
import { showMenuBelow } from '../common/Menu';
import { buildChartData } from './aggregate';
import { ChartBuilder } from './ChartBuilder';
import { ChartSvg } from './ChartSvg';
import { copyChart, saveChart } from './exportChart';
import { buildScene } from './scene';
import { loadSpec, saveSpec } from './settings';
import { defaultSpec, suggestSpec } from './suggest';
import type { ChartSpec, RowSource } from './types';
import './charts.css';

export interface ChartPanelProps {
  columns: ColumnInfo[];
  rows: RowSource;
  /** Bumped whenever rows are appended (streaming results). */
  rev: number;
  done: boolean;
  truncated: boolean;
  /** The SQL that produced the result: settings are remembered per hash of this text. */
  queryText: string;
  /** Base of exported file names. */
  name: string;
}

export default function ChartPanel(props: ChartPanelProps) {
  const { columns, rows, rev, done, truncated, queryText, name } = props;
  const [saved] = useState(() => loadSpec(queryText, columns));
  /** The user's own choice; until there is one, the remembered settings or a suggestion from the columns apply. */
  const [chosen, setChosen] = useState<ChartSpec | null>(null);
  const deferredRev = useDeferredValue(rev);
  // Rows that arrive after the panel opened (a running query) can still change the suggestion.
  const auto = useMemo(() => (chosen || saved ? null : suggestSpec(columns, rows) ?? defaultSpec()), [chosen, saved, columns, rows, deferredRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = (chosen ?? saved ?? auto) as ChartSpec;
  const [showBuilder, setShowBuilder] = useState(true);
  const [size, setSize] = useState({ w: 640, h: 360, narrow: false });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const change = useCallback((next: ChartSpec) => {
    setChosen(next);
    saveSpec(queryText, next);
  }, [queryText]);
  const suggest = () => {
    const s = suggestSpec(columns, rows);
    if (s) change(s);
  };

  // Size of the chart area follows its box.
  useEffect(() => {
    const stage = stageRef.current, root = rootRef.current;
    if (!stage || !root) return;
    let raf = 0;
    const measure = () => {
      const w = Math.floor(stage.clientWidth), h = Math.floor(stage.clientHeight);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h && s.narrow === root.clientWidth < 640 ? s : { w, h, narrow: root.clientWidth < 640 }));
    };
    measure();
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); });
    ro.observe(stage);
    ro.observe(root);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [showBuilder]);

  const data = useMemo(() => buildChartData(columns, rows, spec), [columns, rows, spec, deferredRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const scene = useMemo(() => buildScene(data, spec, size.w, size.h), [data, spec, size.w, size.h]);

  const exportMenu = (el: HTMLElement) => {
    const svg = svgRef.current;
    if (!svg) return;
    showMenuBelow(el, [
      { label: 'Save as PNG…', icon: <Download size={14} />, onClick: () => void saveChart(svg, 'png', name) },
      { label: 'Save as SVG…', icon: <Download size={14} />, onClick: () => void saveChart(svg, 'svg', name) },
      { separator: true },
      { label: 'Copy image', icon: <Copy size={14} />, onClick: () => void copyChart(svg) },
    ]);
  };

  const notes: string[] = [];
  if (data.skippedRows) notes.push(`${formatCount(data.skippedRows)} row${data.skippedRows === 1 ? '' : 's'} without a readable X value left out`);
  if (data.droppedCategories && spec.type !== 'pie' && spec.type !== 'donut') notes.push(`${formatCount(data.droppedCategories)} smaller categories hidden by Top N`);
  if (data.droppedSeries) notes.push(`${formatCount(data.droppedSeries)} more groups not shown (the biggest ${12} are)`);
  if (scene.thinned) notes.push(`${formatCount(scene.thinned)} points thinned for display`);
  if (truncated) notes.push('the result is limited to the loaded rows');
  if (!done) notes.push('rows are still loading');

  return (
    <div ref={rootRef} className={`chart-panel${size.narrow ? ' narrow' : ''}`}>
      {showBuilder && (
        <aside className="chart-side">
          <ChartBuilder columns={columns} spec={spec} onChange={change} onSuggest={suggest} />
        </aside>
      )}
      <div className="chart-main">
        <div className="chart-toolbar">
          <button className={`icon-btn sm${showBuilder ? ' on' : ''}`} aria-pressed={showBuilder} aria-label="Chart settings" title="Show or hide the chart settings" onClick={() => setShowBuilder((v) => !v)}>
            <SlidersHorizontal size={14} />
          </button>
          <span className="chart-summary muted" title={scene.desc}>
            {formatCount(data.usedRows)} row{data.usedRows === 1 ? '' : 's'} charted
          </span>
          <div className="flex-1" />
          <button className="btn btn-xs" aria-haspopup="menu" onClick={(e) => exportMenu(e.currentTarget)} disabled={scene.kind === 'empty'} title="Save the chart as an image or copy it">
            <Download size={12} /> Export chart <ChevronDown size={11} />
          </button>
        </div>
        <div className="chart-stage-host" ref={stageRef}>
          {scene.kind === 'empty' ? (
            <div className="chart-empty" role="status">{scene.message}</div>
          ) : (
            <ChartSvg ref={svgRef} scene={scene} />
          )}
        </div>
        {notes.length > 0 && (
          <div className="chart-notes" role="status">
            <TriangleAlert size={12} aria-hidden="true" /> {notes.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
