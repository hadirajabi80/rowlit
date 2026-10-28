import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { http, api, errorMessage } from '../../api/client';
import { engineSocket } from '../../api/ws';
import type { CellValue, ColumnInfo, JobDoneEvent } from '../../api/types';
import type { ColumnStats, ColumnStatsRequest, ColumnStatsResult } from '../../api/types.stats';
import './columnStats.css';

type Props = {
  column: ColumnInfo;
  values: CellValue[];
  request?: Omit<ColumnStatsRequest, 'columns'>;
  onClose(): void;
};

const text = (v: CellValue): string => {
  if (v === null) return '';
  if (typeof v === 'object') {
    if ('$bin' in v) return `[${v.len} bytes]`;
    if ('$trunc' in v) return v.$trunc;
    return '[cursor]';
  }
  return String(v);
};

const numeric = (v: CellValue): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  return null;
};

export function clientColumnStats(column: ColumnInfo, values: CellValue[]): ColumnStats {
  const present = values.filter((v) => v !== null);
  const counts = new Map<string, number>();
  for (const v of present) counts.set(text(v), (counts.get(text(v)) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([value, count]) => ({ value, count }));
  const nums = present.map(numeric).filter((v): v is number => v !== null);
  const strings = present.map(text);
  const minText = strings.length ? strings.reduce((a, b) => a.localeCompare(b) <= 0 ? a : b) : null;
  const maxText = strings.length ? strings.reduce((a, b) => a.localeCompare(b) >= 0 ? a : b) : null;
  return {
    name: column.name, type: column.dbType, kind: column.kind, rows: values.length, nulls: values.length - present.length,
    distinct: counts.size, min: nums.length ? String(Math.min(...nums)) : minText, max: nums.length ? String(Math.max(...nums)) : maxText,
    avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    sum: nums.length ? String(nums.reduce((a, b) => a + b, 0)) : null,
    minLength: strings.length ? Math.min(...strings.map((s) => s.length)) : null,
    maxLength: strings.length ? Math.max(...strings.map((s) => s.length)) : null,
    top,
  };
}

function wait(jobId: string): Promise<ColumnStatsResult> {
  return new Promise((resolve, reject) => {
    const off = engineSocket.onJob(jobId, (ev) => {
      if (ev.type !== 'job.done') return;
      off();
      const done = ev as JobDoneEvent;
      if (done.status === 'ok' && done.result) resolve(done.result as ColumnStatsResult);
      else reject(new Error(done.error || (done.status === 'cancelled' ? 'Statistics cancelled' : 'Statistics failed')));
    });
  });
}

export function ColumnStatsPopover({ column, values, request, onClose }: Props) {
  const local = useMemo(() => clientColumnStats(column, values), [column, values]);
  const [stats, setStats] = useState<ColumnStats | null>(request ? null : local);
  const [meta, setMeta] = useState<ColumnStatsResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    let live = true;
    void http.json<{ jobId: string }>('POST', '/stats/columns', { body: { ...request, columns: [column.name] } })
      .then(async ({ jobId: id }) => {
        if (!live) { void api.cancelJob(id); return; }
        setJobId(id);
        const result = await wait(id);
        if (live) { setMeta(result); setStats(result.columns[0] ?? null); setJobId(null); }
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [column.name, request]);

  const pct = stats?.rows ? (stats.nulls / stats.rows) * 100 : 0;
  const maxTop = Math.max(1, ...(stats?.top ?? []).map((v) => v.count));
  return (
    <div className="column-stats-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="column-stats" role="dialog" aria-modal="true" aria-label={`Statistics for ${column.name}`}>
        <header><div><strong>{column.name}</strong><span>{column.dbType}</span></div><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
        {jobId && <div className="column-stats-loading"><span className="spinner" /> Profiling on the server… <button className="btn btn-xs" onClick={() => void api.cancelJob(jobId)}>Cancel</button></div>}
        {error && <div className="error-banner">{error}</div>}
        {stats && <>
          {meta?.sampleNote && <div className="info-banner">{meta.sampleNote}</div>}
          {!request && <div className="info-banner">Loaded rows only ({values.length.toLocaleString()}).</div>}
          <div className="column-stats-cards">
            <div><b>{stats.rows.toLocaleString()}</b><span>Rows</span></div><div><b>{stats.nulls.toLocaleString()} · {pct.toFixed(1)}%</b><span>NULL</span></div>
            <div><b>{stats.distinct?.toLocaleString() ?? '—'}</b><span>Distinct</span></div><div><b>{stats.avg == null ? '—' : stats.avg.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b><span>Average</span></div>
          </div>
          <dl className="column-stats-range"><dt>Minimum</dt><dd>{stats.min ?? '—'}</dd><dt>Maximum</dt><dd>{stats.max ?? '—'}</dd>{stats.sum != null && <><dt>Sum</dt><dd>{stats.sum}</dd></>}{stats.minLength != null && <><dt>Length</dt><dd>{stats.minLength}–{stats.maxLength}</dd></>}</dl>
          {!!stats.top.length && <div className="column-stats-section"><h4>Top values</h4>{stats.top.map((v) => <div className="column-stats-bar" key={v.value}><span title={v.value}>{v.value || '(empty)'}</span><i><em style={{ width: `${v.count / maxTop * 100}%` }} /></i><b>{v.count.toLocaleString()}</b></div>)}</div>}
          {!!stats.histogram?.buckets.length && <div className="column-stats-section"><h4>Distribution</h4><div className="column-stats-hist">{stats.histogram.buckets.map((b, i) => <i key={i} title={`${b.from}–${b.to}: ${b.count}`} style={{ height: `${Math.max(3, b.count / Math.max(1, ...stats.histogram!.buckets.map((x) => x.count)) * 100)}%` }} />)}</div></div>}
          {stats.warning && <div className="warning-banner">{stats.warning}</div>}{stats.error && <div className="error-banner">{stats.error}</div>}
        </>}
      </section>
    </div>
  );
}
