// Data compare tab: Source and Target pickers (connection › database › schema › table, or a query) with the key and
// compared columns (from the engine's column preview) and options; Compare runs a `data.compare` job (rows read per side);
// the result shows summary cards per class and the differences grid (classified by the engine, paged); "Synchronize…"
// scripts INSERT / UPDATE / DELETE for either side, to copy, open in a console or apply.
import { ArrowLeftRight, LoaderCircle, RefreshCw, Rows3, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../api/client';
import type {
  DataCompareOptions, DataComparePreview, DataCompareProgress, DataCompareResult, DataDiffRow, DataSyncScript,
} from '../../api/types.dataCompare';
import { copyText, newConsole } from '../../app/actions';
import { displayShortcut } from '../../commands/keys';
import { useTabs } from '../../store/tabs';
import type { TabViewProps } from '../layout/tabViews';
import { dataCompareApi } from './api';
import { DiffGrid } from './DiffGrid';
import { listenForJobs, parseProgress, waitForJob } from './jobs';
import {
  availableRows, changedOptions, CLASS_LABEL, countOf, initialRows, sideEndpoint, validateSides, withDefaults, type GridFilter,
} from './model';
import { EMPTY_DATA_SIDE, side, type DataCompareTabState, type DataSideState } from './open';
import { ColumnsPopover, OptionsPopover } from './OptionsPopover';
import { ScriptDialog } from './ScriptDialog';
import { SidePicker } from './SidePicker';
import './dataCompare.css';

export const PREVIEW_DEBOUNCE_MS = 300;
const PAGE = 200;

function readState(raw: unknown): DataCompareTabState {
  const s = (raw ?? {}) as Partial<DataCompareTabState>;
  return { source: side(s.source ?? EMPTY_DATA_SIDE), target: side(s.target ?? EMPTY_DATA_SIDE), options: s.options ?? {} };
}

function n(v: number): string {
  return v.toLocaleString();
}

export function DataCompareView({ tab }: TabViewProps) {
  const initial = useMemo(() => readState(tab.state), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [source, setSource] = useState<DataSideState>(initial.source);
  const [target, setTarget] = useState<DataSideState>(initial.target);
  const [options, setOptions] = useState<DataCompareOptions>(() => withDefaults(initial.options));

  /** The column preview of the sides it was asked for (stale answers are ignored by comparing the key). */
  const [previewState, setPreviewState] = useState<{ key: string; preview?: DataComparePreview; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DataCompareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DataCompareResult | null>(null);
  const [filter, setFilter] = useState<GridFilter>('all');
  const [rows, setRows] = useState<DataDiffRow[]>([]);
  const [rowsBusy, setRowsBusy] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  const alive = useRef(true);
  const compareIdRef = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (compareIdRef.current) void dataCompareApi.discard(compareIdRef.current).catch(() => {});
    };
  }, []);

  // ---------------------------------------------------------------- persisted tab state
  useEffect(() => {
    const state: DataCompareTabState = { source, target, options: changedOptions(options) as Record<string, unknown> };
    useTabs.getState().updateView(tab.id, { state, connectionId: source.connectionId, database: source.database });
  }, [source, target, options, tab.id]);

  const invalid = validateSides(source, target);

  // ---------------------------------------------------------------- column preview (debounced)
  const previewKey = invalid ? null : JSON.stringify([sideEndpoint(source), sideEndpoint(target)]);
  useEffect(() => {
    if (!previewKey) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      const [src, tgt] = JSON.parse(previewKey) as [NonNullable<ReturnType<typeof sideEndpoint>>, NonNullable<ReturnType<typeof sideEndpoint>>];
      dataCompareApi.preview({ source: src, target: tgt }, ac.signal).then(
        (p) => alive.current && !ac.signal.aborted && setPreviewState({ key: previewKey, preview: p }),
        (e) => alive.current && !ac.signal.aborted && setPreviewState({ key: previewKey, error: errorMessage(e) }),
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [previewKey]);
  const current = previewKey && previewState?.key === previewKey ? previewState : null;
  const preview = current?.preview ?? null;
  const previewError = current?.error ?? null;

  const keyMissing = !!preview && !options.keyColumns?.length && preview.keyColumns.length === 0;
  const blocker = invalid ?? previewError ?? (keyMissing ? 'Neither table has a primary key: choose the key columns under Columns.' : null);

  // ---------------------------------------------------------------- compare
  const reset = useCallback(() => {
    if (compareIdRef.current) void dataCompareApi.discard(compareIdRef.current).catch(() => {});
    compareIdRef.current = null;
    setResult(null);
    setRows([]);
    setSyncOpen(false);
  }, []);

  const compare = async () => {
    if (running || blocker) return;
    const src = sideEndpoint(source);
    const tgt = sideEndpoint(target);
    if (!src || !tgt) return;
    reset();
    setError(null);
    setRunning(true);
    setProgress({ phase: 'preparing', sourceRows: 0, targetRows: 0, differences: 0, message: 'Starting' });
    try {
      listenForJobs();
      const opts = changedOptions(options);
      const { jobId: id } = await dataCompareApi.start({ source: src, target: tgt, ...(Object.keys(opts).length ? { options: opts } : {}) });
      if (!alive.current) return;
      setJobId(id);
      const end = await waitForJob<DataCompareResult>(id, (ev) => {
        const p = parseProgress(ev.message);
        if (p && alive.current) setProgress(p);
      });
      if (!alive.current) {
        if (end.result) void dataCompareApi.discard(end.result.compareId).catch(() => {});
        return;
      }
      if (end.status === 'ok' && end.result) {
        const r = end.result;
        compareIdRef.current = r.compareId;
        setResult(r);
        setFilter('all');
        setRows(initialRows(r, 'all').rows);
        const name = (s: DataSideState) => (s.mode === 'query' ? 'query' : s.table ?? '');
        useTabs.getState().updateView(tab.id, { title: `Compare data: ${name(source)} → ${name(target)}` });
      } else if (end.status === 'cancelled') {
        setError('The comparison was cancelled.');
      } else {
        setError(end.error ?? 'The comparison failed.');
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) {
        setRunning(false);
        setJobId(null);
        setProgress(null);
      }
    }
  };

  const cancel = () => {
    if (jobId) void dataCompareApi.cancel(jobId).catch(() => {});
  };

  const swap = () => {
    setSource(target);
    setTarget(source);
    reset();
  };

  // ---------------------------------------------------------------- grid rows
  const loadRows = useCallback(async (r: DataCompareResult, f: GridFilter, offset: number, keep: DataDiffRow[]) => {
    setRowsBusy(true);
    try {
      const page = await dataCompareApi.rows(r.compareId, f === 'all' ? null : f, offset, PAGE);
      if (alive.current && compareIdRef.current === r.compareId) setRows([...keep, ...page.rows]);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setRowsBusy(false);
    }
  }, []);

  const pickFilter = (f: GridFilter) => {
    if (!result) return;
    setFilter(f);
    const first = initialRows(result, f);
    if (first.prefix) setRows(first.rows);
    else {
      setRows([]);
      void loadRows(result, f, 0, []);
    }
  };

  const available = result ? availableRows(result, filter) : 0;

  // ---------------------------------------------------------------- render
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      void compare();
    }
  };

  const openInConsole = (s: DataSyncScript) => newConsole(s.connectionId, s.database, s.text);
  const syncPossible = !!result && (result.sync.toTarget || result.sync.toSource);
  const syncable = !!result && result.counts.changed + result.counts.onlyInSource + result.counts.onlyInTarget > 0;

  return (
    <div className="dc" onKeyDown={onKeyDown}>
      <header className="dc-top">
        <SidePicker label="Source" value={source} disabled={running} onChange={(v) => { setSource(v); reset(); }} />
        <button type="button" className="icon-btn dc-swap" aria-label="Swap source and target" title="Swap source and target" onClick={swap} disabled={running}>
          <ArrowLeftRight size={16} aria-hidden="true" />
        </button>
        <SidePicker label="Target" value={target} disabled={running} suggestTable={source.mode === 'table' ? source.table : null}
          onChange={(v) => { setTarget(v); reset(); }} />
      </header>
      <div className="dc-bar">
        <ColumnsPopover preview={preview} options={options} onChange={(o) => { setOptions(o); reset(); }} disabled={running} />
        <OptionsPopover options={options} onChange={(o) => { setOptions(o); reset(); }} disabled={running} />
        <span className="flex-1" />
        {running ? (
          <button type="button" className="btn" onClick={cancel} disabled={!jobId}>
            <X size={14} aria-hidden="true" /> Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-primary" data-primary-focus onClick={() => void compare()} disabled={!!blocker || !preview}
            title={blocker ?? `Compare (${displayShortcut('Mod+Enter')})`}>
            {result ? <RefreshCw size={14} aria-hidden="true" /> : <Rows3 size={14} aria-hidden="true" />} {result ? 'Compare again' : 'Compare'}
          </button>
        )}
      </div>

      {blocker && !running && !result && <p className="dc-hint muted">{blocker}</p>}
      {preview && !running && !result && preview.notes.length > 0 && (
        <ul className="dc-notes muted" aria-label="Notes">{preview.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
      )}
      {running && (
        <div className="dc-progress" role="status" aria-live="polite">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>
            {progress?.phase === 'sorting' ? 'Sorting the rows' : progress?.phase === 'preparing' ? 'Reading the columns' : 'Comparing'}
            {progress && progress.phase !== 'preparing' && ` · source ${n(progress.sourceRows)} rows · target ${n(progress.targetRows)} rows · ${n(progress.differences)} differences`}
          </span>
        </div>
      )}
      {error && <p className="dc-error dc-pad" role="alert">{error}</p>}

      {!result && !running && !blocker && (
        <div className="dc-empty-state">
          <Rows3 size={28} aria-hidden="true" />
          <p>Compare the rows of the two tables, matched on {preview?.keyColumns.length || options.keyColumns?.length ? `the key (${(options.keyColumns?.length ? options.keyColumns : preview?.keyColumns ?? []).join(', ')})` : 'their key'}.</p>
          <p className="muted">The source is the reference: the sync script makes the target like it (or the other way round).</p>
        </div>
      )}

      {result && (
        <>
          <div className="dc-cards" role="group" aria-label="Summary">
            <div className="dc-card dc-card-equal"><span className="dc-card-n">{n(result.counts.equal)}</span><span>Equal</span></div>
            {(['changed', 'onlyInSource', 'onlyInTarget', 'duplicate'] as const).filter((c) => c !== 'duplicate' || result.counts.duplicate > 0).map((c) => (
              <button key={c} type="button" className={`dc-card dc-card-${c}${filter === c ? ' on' : ''}`} aria-pressed={filter === c}
                onClick={() => pickFilter(filter === c ? 'all' : c)}>
                <span className="dc-card-n">{n(result.counts[c])}</span><span>{CLASS_LABEL[c]}</span>
              </button>
            ))}
            <span className="dc-card-meta muted">
              {result.sourceLabel} ({n(result.sourceRows)} rows) → {result.targetLabel} ({n(result.targetRows)} rows) · key {result.keyColumns.join(', ')}
              {' · '}{result.ordering === 'engine' ? 'sorted by the engine' : 'sorted by the servers'} · {result.elapsedMs} ms
            </span>
          </div>
          {result.notes.length > 0 && <ul className="dc-notes muted" aria-label="Notes">{result.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          {result.truncatedDiffs && (
            <p className="dc-warn dc-pad" role="note">Only the first {n(result.keptDifferences)} differences were kept (counts are exact). Raise the limit under Options to see more.</p>
          )}
          <div className="dc-body">
            {countOf(result.counts, filter) === 0 ? (
              <p className="dc-pad muted">{filter === 'all' ? 'No differences: the rows are the same.' : `No rows ${CLASS_LABEL[filter].toLowerCase()}.`}</p>
            ) : (
              <>
                <DiffGrid columns={result.columns} rows={rows} sourceLabel={result.sourceLabel} targetLabel={result.targetLabel} />
                <div className="dc-more">
                  <span className="muted">{n(rows.length)} of {n(available)} shown{filter !== 'all' ? ` (${CLASS_LABEL[filter].toLowerCase()})` : ''}</span>
                  {rows.length < available && (
                    <button type="button" className="btn btn-xs" disabled={rowsBusy} onClick={() => void loadRows(result, filter, rows.length, rows)}>
                      {rowsBusy && <LoaderCircle size={12} className="spin" aria-hidden="true" />} Load more
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <footer className="dc-bottom">
            <span className="flex-1" />
            <button type="button" className="btn btn-primary" onClick={() => setSyncOpen(true)} disabled={!syncPossible || !syncable}
              title={!syncPossible ? result.sync.toTargetReason ?? undefined : !syncable ? 'Nothing to synchronize.' : undefined}>
              Synchronize…
            </button>
          </footer>
        </>
      )}

      {syncOpen && result && (
        <ScriptDialog result={result} onClose={() => setSyncOpen(false)} onCopy={(t) => void copyText(t, 'Script copied')}
          onOpenInConsole={openInConsole} onCompareAgain={() => void compare()} />
      )}
    </div>
  );
}
