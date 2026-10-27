// The chart builder: type, X axis, Y series with aggregation, group-by, sort, Top-N and display switches.
import { Plus, Sparkles, X } from 'lucide-react';
import { useId } from 'react';
import type { ColumnInfo } from '../../api/types';
import { Select, type SelectOption } from '../common/Select';
import { AGGS, BUCKETS, CHART_TYPES, SORTS, type Agg, type Bucket, type ChartSpec, type ChartType, type SortMode } from './types';
import { classifyColumn } from './values';

interface Props {
  columns: readonly ColumnInfo[];
  spec: ChartSpec;
  onChange(spec: ChartSpec): void;
  onSuggest(): void;
}

const MAX_Y = 6;

export function ChartBuilder({ columns, spec, onChange, onSuggest }: Props) {
  const uid = useId();
  const set = (patch: Partial<ChartSpec>) => onChange({ ...spec, ...patch });
  const kpi = spec.type === 'kpi';
  const pie = spec.type === 'pie' || spec.type === 'donut';
  const colOptions: SelectOption[] = columns.map((c) => ({ value: c.name, label: c.name, hint: c.dbType }));
  const numeric = columns.filter((c) => classifyColumn(c) === 'number');
  const yOptions: SelectOption[] = [...numeric, ...columns.filter((c) => !numeric.includes(c))].map((c) => ({ value: c.name, label: c.name, hint: c.dbType }));
  const xCol = columns.find((c) => c.name === spec.x);
  const timeX = !!xCol && classifyColumn(xCol) === 'time' && !kpi;
  const maxY = pie ? 1 : MAX_Y;

  const onType = (type: ChartType) => {
    const next: Partial<ChartSpec> = { type };
    if (type === 'pie' || type === 'donut') {
      next.y = spec.y.slice(0, 1);
      next.group = null;
      next.labels = true;
      next.log = false;
      next.topN = spec.topN || 8;
    }
    if (type === 'stacked') next.log = false;
    set(next);
  };

  const setY = (i: number, patch: Partial<ChartSpec['y'][number]>) => set({ y: spec.y.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const addY = () => {
    const used = new Set(spec.y.map((s) => s.column));
    const c = numeric.find((n) => !used.has(n.name)) ?? numeric[0] ?? columns[0];
    if (c) set({ y: [...spec.y, { column: c.name, agg: spec.y[spec.y.length - 1]?.agg ?? 'sum' }] });
  };

  return (
    <div className="chart-builder" role="group" aria-label="Chart settings">
      <div className="cb-field">
        <label id={`${uid}-type`}>Chart type</label>
        <Select aria-labelledby={`${uid}-type`} size="sm" value={spec.type} options={CHART_TYPES.map((t) => ({ value: t.id, label: t.label }))} onChange={(v) => onType(v as ChartType)} />
      </div>
      {!kpi && (
        <div className="cb-field">
          <label id={`${uid}-x`}>{pie ? 'Category' : 'X axis'}</label>
          <Select aria-labelledby={`${uid}-x`} size="sm" value={spec.x ?? ''} options={[{ value: '', label: '(none)' }, ...colOptions]} onChange={(v) => set({ x: v || null })} />
        </div>
      )}
      {timeX && (
        <div className="cb-field">
          <label id={`${uid}-bucket`}>Group dates by</label>
          <Select aria-labelledby={`${uid}-bucket`} size="sm" value={spec.bucket} options={BUCKETS.map((b) => ({ value: b.id, label: b.label }))} onChange={(v) => set({ bucket: v as Bucket })} />
        </div>
      )}
      <div className="cb-field">
        <label>{pie || kpi ? 'Value' : 'Y series'}</label>
        {spec.y.map((s, i) => (
          <div className="cb-series" key={i}>
            <Select aria-label={`Series ${i + 1} column`} size="sm" value={s.column} options={yOptions} onChange={(v) => setY(i, { column: v })} />
            <Select aria-label={`Series ${i + 1} aggregation`} size="sm" value={s.agg} options={AGGS.map((a) => ({ value: a.id, label: a.label }))} onChange={(v) => setY(i, { agg: v as Agg })} />
            <button className="icon-btn xs" aria-label={`Remove series ${i + 1}`} title="Remove series" onClick={() => set({ y: spec.y.filter((_, k) => k !== i) })}>
              <X size={12} />
            </button>
          </div>
        ))}
        {spec.y.length < maxY && (
          <button className="btn btn-xs" onClick={addY} disabled={!columns.length}>
            <Plus size={12} /> Add series
          </button>
        )}
      </div>
      {!kpi && !pie && (
        <div className="cb-field">
          <label id={`${uid}-group`}>Group by (series)</label>
          <Select aria-labelledby={`${uid}-group`} size="sm" value={spec.group ?? ''} options={[{ value: '', label: '(none)' }, ...colOptions]} onChange={(v) => set({ group: v || null })} />
        </div>
      )}
      {!kpi && (
        <div className="cb-row">
          <div className="cb-field">
            <label id={`${uid}-sort`}>Sort</label>
            <Select aria-labelledby={`${uid}-sort`} size="sm" value={spec.sort} options={SORTS.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => set({ sort: v as SortMode })} />
          </div>
          <div className="cb-field cb-narrow">
            <label htmlFor={`${uid}-top`}>Top N</label>
            <input
              id={`${uid}-top`} className="input xs" type="number" min={0} max={1000} value={spec.topN || ''} placeholder="All"
              onChange={(e) => set({ topN: Math.max(0, Math.min(1000, Math.floor(Number(e.target.value) || 0))) })}
            />
          </div>
        </div>
      )}
      <div className="cb-checks">
        {!kpi && (
          <label>
            <input type="checkbox" checked={spec.labels} onChange={(e) => set({ labels: e.target.checked })} /> Labels
          </label>
        )}
        {!kpi && (
          <label>
            <input type="checkbox" checked={spec.legend} onChange={(e) => set({ legend: e.target.checked })} /> Legend
          </label>
        )}
        {!kpi && !pie && spec.type !== 'stacked' && (
          <label>
            <input type="checkbox" checked={spec.log} onChange={(e) => set({ log: e.target.checked })} /> Log scale
          </label>
        )}
      </div>
      <button className="btn btn-xs" onClick={onSuggest} title="Pick a chart that fits the columns of this result">
        <Sparkles size={12} /> Suggest a chart
      </button>
    </div>
  );
}
