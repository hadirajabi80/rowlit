// Schema compare tab: Source and Target pickers (connection › database › schema) with options and Compare (a
// `schema.compare` job with progress); the result as a list grouped by kind (filter chips, search, checkboxes) and a
// detail pane with Diff / Changes / Script per object; "Generate script" builds the migration script of the selected
// objects, which can be copied, opened in a console or applied to the target.
import { ArrowLeftRight, GitCompare, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../api/client';
import type {
  CompareItemDetail, CompareOptions, CompareResult, CompareScript, CompareSupport,
} from '../../api/types.schemaCompare';
import { copyText, newConsole } from '../../app/actions';
import { getConnection, isRelational, useConnections } from '../../store/connections';
import { useTabs } from '../../store/tabs';
import { ConnectionScopePicker } from '../common/ConnectionScopePicker';
import { scopeEndpoint } from '../common/connectionScope';
import type { TabViewProps } from '../layout/tabViews';
import { schemaCompareApi } from './api';
import { ApplyDialog } from './ApplyDialog';
import { ItemDiff } from './ItemDiff';
import { ItemList, StatusBadge } from './ItemList';
import { listenForJobs, waitForCompareJob, type CompareProgress } from './jobs';
import {
  changedOptions, DEFAULT_FILTER, defaultSelection, EMPTY_SIDE, selectedIds, validateSides, withDefaults,
  type ItemFilter, type SchemaCompareTabState, type SideState,
} from './model';
import { OptionsPopover } from './OptionsPopover';
import { StatementList, ScriptView, WarningList } from './ScriptView';
import './schemaCompare.css';

type DetailTab = 'diff' | 'changes' | 'script' | 'migration';

type SupportEntry = CompareSupport | { error: string };

function readState(raw: unknown): SchemaCompareTabState {
  const s = (raw ?? {}) as Partial<SchemaCompareTabState>;
  const side = (x: Partial<SideState> | undefined): SideState => ({
    connectionId: x?.connectionId ?? null, database: x?.database ?? null, schema: x?.schema ?? null,
  });
  return { source: side(s.source ?? EMPTY_SIDE), target: side(s.target ?? EMPTY_SIDE), options: s.options ?? {} };
}

export function SchemaCompareView({ tab, theme }: TabViewProps) {
  const initial = useMemo(() => readState(tab.state), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [source, setSource] = useState<SideState>(initial.source);
  const [target, setTarget] = useState<SideState>(initial.target);
  const [options, setOptions] = useState<CompareOptions>(() => withDefaults(initial.options));

  const [support, setSupport] = useState<Record<string, SupportEntry>>({});
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [filter, setFilter] = useState<ItemFilter>(DEFAULT_FILTER);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** Item details by compareId \u0001 itemId (loaded once per comparison). */
  const [details, setDetails] = useState<Record<string, { detail?: CompareItemDetail; error?: string }>>({});
  const [detailTab, setDetailTab] = useState<DetailTab>('diff');
  const [script, setScript] = useState<CompareScript | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  /** The items the shown script was generated for (Apply runs exactly these). */
  const [scriptIds, setScriptIds] = useState<string[]>([]);
  const [applyOpen, setApplyOpen] = useState(false);

  const alive = useRef(true);
  const compareIdRef = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (compareIdRef.current) void schemaCompareApi.discard(compareIdRef.current).catch(() => {});
    };
  }, []);

  // ---------------------------------------------------------------- persisted tab state
  useEffect(() => {
    const state: SchemaCompareTabState = { source, target, options: changedOptions(options) };
    useTabs.getState().updateView(tab.id, { state, connectionId: source.connectionId, database: source.database });
  }, [source, target, options, tab.id]);

  // ---------------------------------------------------------------- engine support per connection
  const connections = useConnections((s) => s.connections);
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const c of connections) {
      const id = c.id;
      if (!isRelational(id) || asked.current.has(id)) continue;
      asked.current.add(id);
      schemaCompareApi.support(id).then(
        (r) => alive.current && setSupport((p) => ({ ...p, [id]: r })),
        (e) => alive.current && setSupport((p) => ({ ...p, [id]: { error: errorMessage(e) } })),
      );
    }
  }, [connections]);

  const supportOf = useCallback((cid: string): CompareSupport | null => {
    const s = support[cid];
    return s && 'supported' in s ? s : null;
  }, [support]);
  const unsupportedReason = useCallback((cid: string): string | null => {
    const s = supportOf(cid);
    return s && !s.supported ? s.reason ?? 'Schema compare does not support this connection.' : null;
  }, [supportOf]);
  const providerOf = (cid: string) => getConnection(cid)?.providerId;
  const targetDisabledReason = (cid: string): string | null => {
    const why = unsupportedReason(cid);
    if (why) return why;
    const ps = source.connectionId ? providerOf(source.connectionId) : undefined;
    return ps && providerOf(cid) !== ps ? 'Not the same kind of database as the source.' : null;
  };

  // compared on the effective endpoints: (connection default) and (default: public) are the same as picking them
  const invalid = validateSides(scopeEndpoint(source) ?? source, scopeEndpoint(target) ?? target, providerOf, unsupportedReason);
  const targetSupport = target.connectionId ? supportOf(target.connectionId) : null;
  const applyBlockedReason = targetSupport?.readOnly
    ? 'The target connection is read-only: copy the script or open it in a console instead.'
    : null;

  // ---------------------------------------------------------------- compare
  const reset = () => {
    if (compareIdRef.current) void schemaCompareApi.discard(compareIdRef.current).catch(() => {});
    compareIdRef.current = null;
    setDetails({});
    setResult(null);
    setScript(null);
    setFocusedId(null);
  };

  const compare = async () => {
    if (running || invalid) return;
    const src = scopeEndpoint(source);
    const tgt = scopeEndpoint(target);
    if (!src || !tgt) return;
    reset();
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: null, message: 'Starting' });
    try {
      listenForJobs();
      const opts = changedOptions(options);
      const { jobId: id } = await schemaCompareApi.start({ source: src, target: tgt, ...(Object.keys(opts).length ? { options: opts } : {}) });
      if (!alive.current) return;
      setJobId(id);
      const end = await waitForCompareJob(id, (p) => alive.current && setProgress(p));
      if (!alive.current) {
        if (end.result) void schemaCompareApi.discard(end.result.compareId).catch(() => {});
        return;
      }
      if (end.status === 'ok' && end.result) {
        const r = end.result;
        compareIdRef.current = r.compareId;
        setResult(r);
        setSelection(defaultSelection(r.items));
        setFilter(DEFAULT_FILTER);
        const first = r.items.find((i) => i.status !== 'identical') ?? r.items[0];
        setFocusedId(first?.id ?? null);
        setDetailTab('diff');
        useTabs.getState().updateView(tab.id, { title: `Compare: ${r.sourceSchema} → ${r.targetSchema}` });
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
    if (jobId) void schemaCompareApi.cancel(jobId).catch(() => {});
  };

  const swap = () => {
    setSource(target);
    setTarget(source);
    reset();
  };

  // ---------------------------------------------------------------- item detail
  const detailKey = result && focusedId ? `${result.compareId}\u0001${focusedId}` : null;
  const detailEntry = detailKey ? details[detailKey] : undefined;
  const detail = detailEntry?.detail ?? null;
  const detailError = detailEntry?.error ?? null;
  useEffect(() => {
    if (!result || !focusedId || !detailKey || details[detailKey]) return;
    const ac = new AbortController();
    schemaCompareApi.item(result.compareId, focusedId, ac.signal).then(
      (d) => alive.current && setDetails((p) => ({ ...p, [detailKey]: { detail: d } })),
      (e) => alive.current && !ac.signal.aborted && setDetails((p) => ({ ...p, [detailKey]: { error: errorMessage(e) } })),
    );
    return () => ac.abort();
  }, [result, focusedId, detailKey, details]);

  // ---------------------------------------------------------------- script and apply
  const ids = result ? selectedIds(result.items, selection) : [];
  const stale = !!script && ids.join('\u0001') !== scriptIds.join('\u0001');
  const scriptBlockedReason = stale ? 'The selection changed since this script was generated: generate it again before applying.' : applyBlockedReason;

  const generate = async () => {
    if (!result || !ids.length) return;
    setScriptBusy(true);
    setError(null);
    try {
      const s = await schemaCompareApi.script(result.compareId, ids);
      if (!alive.current) return;
      setScript(s);
      setScriptIds(ids);
      setDetailTab('migration');
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setScriptBusy(false);
    }
  };

  const openInConsole = () => {
    if (!script || !target.connectionId) return;
    const ep = scopeEndpoint(target);
    const db = targetSupport?.schemaIsDatabase ? ep?.schema ?? null : ep?.database ?? null;
    newConsole(target.connectionId, db, script.text);
  };

  const applyScript = (stopOnError: boolean) => {
    if (!result) return Promise.reject(new Error('No comparison'));
    return schemaCompareApi.apply(result.compareId, { itemIds: scriptIds, stopOnError });
  };

  // ---------------------------------------------------------------- render
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      void compare();
    }
  };

  const focused = result?.items.find((i) => i.id === focusedId) ?? null;
  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

  return (
    <div className="sc" onKeyDown={onKeyDown}>
      <header className="sc-top">
        <ConnectionScopePicker label="Source" value={source} disabled={running} disabledReason={unsupportedReason}
          onChange={(v) => { setSource(v); reset(); }} />
        <button type="button" className="icon-btn sc-swap" aria-label="Swap source and target" title="Swap source and target" onClick={swap} disabled={running}>
          <ArrowLeftRight size={16} aria-hidden="true" />
        </button>
        <ConnectionScopePicker label="Target" value={target} disabled={running} disabledReason={targetDisabledReason}
          onChange={(v) => { setTarget(v); reset(); }} />
        <div className="sc-top-actions">
          <OptionsPopover options={options} onChange={setOptions} disabled={running} />
          {running ? (
            <button type="button" className="btn" onClick={cancel} disabled={!jobId}>
              <X size={14} aria-hidden="true" /> Cancel
            </button>
          ) : (
            <button type="button" className="btn btn-primary" data-primary-focus onClick={() => void compare()} disabled={!!invalid}
              title={invalid ?? 'Compare (Ctrl+Enter)'}>
              <GitCompare size={14} aria-hidden="true" /> Compare
            </button>
          )}
        </div>
      </header>

      {invalid && !running && !result && <p className="sc-hint muted">{invalid}</p>}
      {running && (
        <div className="sc-progress" role="status" aria-live="polite">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />
          <span>{progress?.message ?? 'Comparing'}{progress?.total ? ` (${progress.done} of ${progress.total})` : ''}</span>
          <progress max={100} value={pct ?? undefined} aria-label="Comparison progress" />
        </div>
      )}
      {error && <p className="sc-error sc-pad" role="alert">{error}</p>}

      {!result && !running && (
        <div className="sc-empty-state">
          <GitCompare size={28} aria-hidden="true" />
          <p>Pick a source and a target schema of the same kind of database, then Compare.</p>
          <p className="muted">The source is the reference: the script changes the target to match it.</p>
        </div>
      )}

      {result && (
        <>
          <div className="sc-body">
            <ItemList items={result.items} filter={filter} onFilter={setFilter} selection={selection} onSelection={setSelection}
              focusedId={focusedId} onFocus={(id) => { setFocusedId(id); if (detailTab === 'migration') setDetailTab('diff'); }} />
            <section className="sc-detail-pane" aria-label="Details">
              <div className="sc-tabs" role="tablist" aria-label="Detail views">
                {(['diff', 'changes', 'script'] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={detailTab === t} className={`sc-tab${detailTab === t ? ' on' : ''}`}
                    onClick={() => setDetailTab(t)} disabled={!focused}>
                    {t === 'diff' ? 'Diff' : t === 'changes' ? 'Changes' : 'Script'}
                  </button>
                ))}
                {script && (
                  <button type="button" role="tab" aria-selected={detailTab === 'migration'} className={`sc-tab${detailTab === 'migration' ? ' on' : ''}`}
                    onClick={() => setDetailTab('migration')}>
                    Migration script
                  </button>
                )}
                <span className="flex-1" />
                {focused && detailTab !== 'migration' && (
                  <span className="sc-focus-name"><span className="sc-name">{focused.name}</span> <StatusBadge status={focused.status} /></span>
                )}
              </div>
              <div className="sc-tab-body" role="tabpanel">
                {detailTab === 'migration' && script ? (
                  <ScriptView script={script} targetLabel={result.targetLabel} canApply={!scriptBlockedReason} applyBlockedReason={scriptBlockedReason}
                    onCopy={() => void copyText(script.text, 'Script copied')} onOpenInConsole={openInConsole} onApply={() => setApplyOpen(true)} />
                ) : !focused ? (
                  <p className="muted sc-pad">Select an object to see its differences.</p>
                ) : detailError ? (
                  <p className="sc-error sc-pad" role="alert">{detailError}</p>
                ) : !detail ? (
                  <p className="muted sc-pad"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Loading the definitions…</p>
                ) : detailTab === 'diff' ? (
                  <ItemDiff targetDdl={detail.targetDdl} sourceDdl={detail.sourceDdl} dialect={result.dialect} theme={theme}
                    targetLabel={result.targetLabel} sourceLabel={result.sourceLabel} />
                ) : detailTab === 'changes' ? (
                  <div className="sc-changes">
                    {detail.item.changes.length ? (
                      <ul aria-label="Changes">{detail.item.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                    ) : <p className="muted">No differences.</p>}
                    <WarningList warnings={detail.item.warnings.map((w) => ({ ...w, itemId: detail.item.id }))} />
                  </div>
                ) : (
                  <StatementList statements={detail.statements} />
                )}
              </div>
            </section>
          </div>
          <footer className="sc-bottom">
            <span className="sc-summary">
              {result.counts.create} to create · {result.counts.alter} to alter · {result.counts.drop} to drop · {result.counts.identical} identical
              <span className="muted"> · {result.sourceLabel} → {result.targetLabel} · {result.elapsedMs} ms</span>
            </span>
            {result.notes.length > 0 && <span className="sc-notes muted" title={result.notes.join('\n')}>{result.notes.length === 1 ? result.notes[0] : `${result.notes.length} notes`}</span>}
            <span className="flex-1" />
            <button type="button" className="btn btn-primary" onClick={() => void generate()} disabled={!ids.length || scriptBusy}>
              {scriptBusy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
              Generate script ({ids.length} selected)
            </button>
          </footer>
        </>
      )}

      {applyOpen && script && result && (
        <ApplyDialog script={script} targetLabel={result.targetLabel} apply={applyScript} onClose={() => setApplyOpen(false)} onCompareAgain={() => void compare()} />
      )}
    </div>
  );
}
