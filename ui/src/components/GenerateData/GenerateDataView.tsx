// Generate data tab: pick how many rows, check the generator inferred for every column, look at a preview, generate. Rows are
// written by the engine through the Import wizard's loaders, in the background (progress, cancel). Lazy-loaded
// (./views.tsx); the shell only loads ./commands.ts and ./open.ts at startup.
import { CircleAlert, CircleCheck, CircleSlash, Dices, LoaderCircle, Play, RefreshCw, RotateCcw, TableProperties } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../api/client';
import type { GenerateColumn, GeneratePlan, GeneratePreview, GenerateProgress, GenerateSummary, GeneratorInfo } from '../../api/types.generate';
import { runCommand } from '../../commands/registry';
import { getPlatform } from '../../platform';
import { getConnection, hasDatabaseLevel } from '../../store/connections';
import { useTabs } from '../../store/tabs';
import { toast, useUi } from '../../store/ui';
import { formatCount, formatDuration } from '../ImportWizard/model';
import { Callout, Field } from '../ImportWizard/parts';
import '../ImportWizard/importWizard.css';
import type { TabViewProps } from '../layout/tabViews';
import { generateApi } from './api';
import { ColumnRow } from './ColumnRow';
import './generateData.css';
import { listenForJobs, waitForGenerateJob } from './jobs';
import {
  buildRequest, hasIssues, initialSettings, OUTCOME, parseRows, PHASE_TEXT, previewKey, progressPercent, randomSeed, runIssues, summaryLine,
  type GenerateSettings,
} from './model';
import { tabTarget } from './open';

const PREVIEW_DEBOUNCE_MS = 450;
const PREVIEW_ROWS = 20;

let generatorsPromise: Promise<GeneratorInfo[]> | null = null;

/** The generator catalog (static for the engine's lifetime): fetched once. */
function loadGenerators(): Promise<GeneratorInfo[]> {
  generatorsPromise ??= generateApi.generators().catch((e) => {
    generatorsPromise = null;
    throw e;
  });
  return generatorsPromise;
}

interface RunState {
  status: 'idle' | 'starting' | 'running' | 'done' | 'failed';
  jobId: string | null;
  startedAt: number | null;
  progress: GenerateProgress | null;
  summary: GenerateSummary | null;
  error: string | null;
  cancelling: boolean;
}

const IDLE_RUN: RunState = { status: 'idle', jobId: null, startedAt: null, progress: null, summary: null, error: null, cancelling: false };

interface PreviewState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  data: GeneratePreview | null;
  error: string | null;
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`iw-stat${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function GenerateDataView({ tab, visible }: TabViewProps) {
  const target = tabTarget(tab);
  const conn = getConnection(tab.connectionId);
  const engineDb = hasDatabaseLevel(conn?.providerId) ? tab.database : null;
  const table = target?.table ?? '';
  const schema = target?.schema ?? null;

  const [infos, setInfos] = useState<GeneratorInfo[] | null>(null);
  const [plan, setPlan] = useState<GeneratePlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [columns, setColumns] = useState<GenerateColumn[]>([]);
  const [settings, setSettings] = useState<GenerateSettings>(() => initialSettings(randomSeed()));
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle', data: null, error: null });
  const [run, setRun] = useState<RunState>(IDLE_RUN);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---------------------------------------------------------------- load the generators and the table's plan
  useEffect(() => {
    if (!target) return;
    const ctl = new AbortController();
    setPlan(null);
    setLoadError(null);
    void (async () => {
      try {
        const [gens, p] = await Promise.all([
          loadGenerators(),
          generateApi.plan({ connectionId: target.connectionId, database: engineDb, schema, table }, ctl.signal),
        ]);
        if (ctl.signal.aborted) return;
        setInfos(gens);
        setPlan(p);
        setColumns(p.columns);
        setSettings((s) => ({ ...s, seed: p.seed, rows: String(p.defaultRows) }));
      } catch (e) {
        if (!ctl.signal.aborted) setLoadError(errorMessage(e));
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the identity of the table is what matters
  }, [target?.connectionId, engineDb, schema, table]);

  const running = run.status === 'starting' || run.status === 'running';
  useEffect(() => {
    useTabs.getState().updateView(tab.id, { dirty: running });
  }, [tab.id, running]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const maxRows = plan?.maxRows ?? 10_000_000;
  const issues = useMemo(() => runIssues(settings, columns, infos ?? [], maxRows), [settings, columns, infos, maxRows]);
  const invalid = hasIssues(issues);
  const rows = parseRows(settings.rows, maxRows);
  const request = useCallback(
    (previewRows?: number) => buildRequest({ connectionId: target?.connectionId ?? '', database: engineDb, schema, table }, settings, columns, maxRows, { previewRows }),
    [target?.connectionId, engineDb, schema, table, settings, columns, maxRows],
  );

  // ---------------------------------------------------------------- preview (debounced, same seed as the run)
  const pKey = previewKey(settings, columns);
  useEffect(() => {
    if (!plan || !infos || invalid || running || !plan.canGenerate) return;
    const ctl = new AbortController();
    setPreview((p) => ({ ...p, status: 'loading' }));
    const timer = setTimeout(() => {
      generateApi.preview(request(PREVIEW_ROWS), ctl.signal).then(
        (data) => !ctl.signal.aborted && setPreview({ status: 'ok', data, error: null }),
        (e) => !ctl.signal.aborted && setPreview({ status: 'error', data: null, error: errorMessage(e) }),
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pKey covers settings and columns
  }, [pKey, plan, infos, invalid, running]);

  // ---------------------------------------------------------------- run
  const start = useCallback(async () => {
    if (!plan || !infos || invalid || running || !plan.canGenerate) return;
    if (settings.truncateFirst) {
      const ok = await useUi.getState().askConfirm({
        title: 'Delete the existing rows?',
        message: `All rows of ${table} are deleted first, then the new rows are inserted${settings.transaction ? ' (in one transaction: a failure restores them)' : ''}.`,
        confirmLabel: 'Delete and generate', cancelLabel: 'Keep the rows', danger: true,
      });
      if (!ok) return;
    }
    listenForJobs();
    setRun({ ...IDLE_RUN, status: 'starting', startedAt: Date.now() });
    try {
      const { jobId } = await generateApi.run(request());
      if (!alive.current) return;
      setRun((r) => ({ ...r, status: 'running', jobId }));
      const end = await waitForGenerateJob(jobId, (progress) => {
        if (alive.current) setRun((r) => ({ ...r, progress }));
      });
      if (!alive.current) return;
      if (end.summary) setRun((r) => ({ ...r, status: 'done', summary: end.summary }));
      else setRun((r) => ({ ...r, status: 'failed', error: end.status === 'cancelled' ? 'The run was cancelled.' : end.error ?? 'Generating data failed.' }));
    } catch (e) {
      if (alive.current) setRun((r) => ({ ...r, status: 'failed', error: errorMessage(e) }));
    }
  }, [plan, infos, invalid, running, settings.truncateFirst, settings.transaction, table, request]);

  const cancel = useCallback(async () => {
    const id = run.jobId;
    if (!id) return;
    const ok = await useUi.getState().askConfirm({
      title: 'Cancel generating data?',
      message: settings.transaction ? 'The run stops and everything it inserted is rolled back.' : 'The run stops after the current batch. Rows already committed stay.',
      confirmLabel: 'Cancel run', cancelLabel: 'Keep going', danger: true,
    });
    if (!ok) return;
    setRun((r) => ({ ...r, cancelling: true }));
    try {
      await generateApi.cancel(id);
    } catch {
      /* the job may have just finished */
    }
  }, [run.jobId, settings.transaction]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void start();
    }
  };

  const downloadReport = async () => {
    if (!run.jobId) return;
    try {
      const blob = await generateApi.errorReport(run.jobId);
      const saved = await getPlatform().saveFile({
        suggestedName: 'generate-errors.csv', filters: [{ name: 'CSV', extensions: ['csv'] }], content: blob, mime: 'text/csv;charset=utf-8',
      });
      if (saved) toast('success', 'Saved the error report', saved);
    } catch (e) {
      toast('error', 'Could not download the error report', errorMessage(e));
    }
  };

  const openData = () => {
    if (!target) return;
    runCommand('data.open', { kind: 'object', connectionId: target.connectionId, database: target.database, ref: { database: target.database, schema, name: table, type: 'table' } });
  };

  const setColumn = useCallback((i: number, next: GenerateColumn) => setColumns((cs) => cs.map((c, j) => (j === i ? next : c))), []);
  const patch = (p: Partial<GenerateSettings>) => setSettings((s) => ({ ...s, ...p }));
  const resetColumns = () => {
    if (plan) setColumns(plan.columns);
  };

  if (!target) {
    return <div className="iw gd" style={{ display: visible ? undefined : 'none' }}><div className="results-empty">This tab has no table.</div></div>;
  }

  const sum = run.summary;
  const outcome = sum ? OUTCOME[sum.outcome] : null;
  const pct = progressPercent(run.progress);
  const elapsed = sum ? sum.elapsedMs : run.startedAt ? now - run.startedAt : 0;
  const locked = running;
  const qualified = schema ? `${schema}.${table}` : table;
  const issueCount = Object.keys(issues.columns).length + (issues.rows ? 1 : 0) + (issues.general ? 1 : 0);
  const generateLabel = rows ? `Generate ${formatCount(rows)} ${rows === 1 ? 'row' : 'rows'}` : 'Generate rows';
  const nav = locked ? 'Running…' : invalid ? `${issueCount} ${issueCount === 1 ? 'thing needs' : 'things need'} attention.` : '';

  return (
    <div className="iw gd" data-testid="generate-data" style={{ display: visible ? undefined : 'none' }} data-command-scope="generateData" onKeyDown={onKeyDown}>
      <div className="iw-body">
        <section className="iw-step" aria-labelledby="gd-title">
          <header className="iw-step-head">
            <div className="iw-step-titles">
              <h2 id="gd-title" className="iw-h"><Dices size={18} aria-hidden="true" className="gd-title-icon" /> Generate data</h2>
              <p className="iw-help">
                Fill <strong dir="auto">{qualified}</strong>{conn ? <> on <span dir="auto">{conn.name}</span></> : null} with test rows. Each column gets a generator;
                the same seed always gives the same rows.
              </p>
            </div>
          </header>

          {loadError && <Callout tone="error">{loadError}</Callout>}
          {!plan && !loadError && <div className="iw-phase" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" /> Reading the table…</div>}
          {plan && !plan.canGenerate && <Callout tone="error">{plan.reason ?? 'Rows cannot be generated into this table.'}</Callout>}
          {plan?.warnings.map((w, i) => <Callout key={i} tone="warn">{w}</Callout>)}

          {plan && infos && (
            <>
              <fieldset className="iw-group" disabled={locked}>
                <legend>Rows</legend>
                <div className="gd-settings">
                  <Field label="Number of rows" hint={issues.rows ?? undefined}>
                    <input
                      className={`input gd-rows${issues.rows ? ' invalid' : ''}`}
                      aria-label="Number of rows"
                      aria-invalid={!!issues.rows}
                      inputMode="numeric"
                      value={settings.rows}
                      onChange={(e) => patch({ rows: e.target.value })}
                    />
                  </Field>
                  <Field label="Seed" hint="Same seed, same data.">
                    <span className="gd-seed">
                      <input
                        className="input"
                        aria-label="Seed"
                        inputMode="numeric"
                        value={settings.seed}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ''));
                          patch({ seed: Number.isSafeInteger(n) && n > 0 ? n : 1 });
                        }}
                      />
                      <button type="button" className="icon-btn sm" title="Another random seed" aria-label="New random seed" onClick={() => patch({ seed: randomSeed() })}>
                        <RefreshCw size={14} />
                      </button>
                    </span>
                  </Field>
                  <Field label="When the server rejects a row">
                    <select className="input" aria-label="When the server rejects a row" value={settings.onError} onChange={(e) => patch({ onError: e.target.value as 'stop' | 'skip' })}>
                      <option value="stop">Stop and name the row</option>
                      <option value="skip">Skip it and report it</option>
                    </select>
                  </Field>
                </div>
                <div className="iw-checks">
                  <label className="iw-check iw-danger">
                    <input type="checkbox" checked={settings.truncateFirst} onChange={(e) => patch({ truncateFirst: e.target.checked })} />
                    Delete the existing rows first
                  </label>
                  {plan.transactional && (
                    <label className="iw-check" title="One transaction: a failure leaves the table as it was">
                      <input type="checkbox" checked={settings.transaction} onChange={(e) => patch({ transaction: e.target.checked })} />
                      All rows in one transaction
                    </label>
                  )}
                </div>
              </fieldset>

              <fieldset className="iw-group" disabled={locked}>
                <legend>Columns</legend>
                <div className="gd-colbar">
                  <span className="iw-note">Chosen from the column types, names and constraints. Change anything you like.</span>
                  <button type="button" className="btn btn-xs" onClick={resetColumns}><RotateCcw size={12} aria-hidden="true" /> Reset to suggestions</button>
                </div>
                {issues.general && <Callout tone="error">{issues.general}</Callout>}
                <div className="iw-grid-wrap">
                  <table className="iw-map gd-columns" aria-label="Columns">
                    <thead>
                      <tr>
                        <th scope="col">Column</th><th scope="col">Type</th><th scope="col">Generator</th><th scope="col">Options</th>
                        <th scope="col" title="Share of rows that get NULL">NULL %</th><th scope="col" title="Every generated value is different">Unique</th>
                      </tr>
                    </thead>
                    <tbody>
                      {columns.map((c, i) => (
                        <ColumnRow key={c.name} column={c} infos={infos} issues={issues.columns[c.name] ?? []} disabled={locked} onChange={(next) => setColumn(i, next)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </fieldset>

              <section className="iw-group gd-preview" aria-label="Preview">
                <div className="gd-colbar">
                  <strong>Preview</strong>
                  <span className="iw-note">
                    {preview.status === 'loading' ? 'Updating…' : `First ${PREVIEW_ROWS} rows with seed ${settings.seed}`}
                  </span>
                </div>
                {preview.status === 'error' && <Callout tone="error">{preview.error}</Callout>}
                {preview.data && (
                  <div className="iw-grid-wrap">
                    <table className={`iw-map gd-preview-table${preview.status === 'error' ? ' stale' : ''}`} aria-label="Preview rows">
                      <thead><tr>{preview.data.columns.map((c) => <th key={c.name} scope="col" dir="auto">{c.name}</th>)}</tr></thead>
                      <tbody>
                        {preview.data.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((v, j) => (v === null ? <td key={j} className="gd-null-cell">NULL</td> : <td key={j} dir="auto">{v}</td>))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {preview.data?.warnings.map((w, i) => <Callout key={i} tone="warn">{w}</Callout>)}
              </section>
            </>
          )}

          {running && (
            <>
              <div className="iw-bigprogress">
                <div className="iw-bigpct" aria-hidden="true">{pct === null ? '…' : `${Math.round(pct)}%`}</div>
                <div className="iw-bigprogress-main">
                  <div
                    className={`iw-progress${pct === null ? ' indeterminate' : ''}`} role="progressbar" aria-label="Generating progress"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)}
                  >
                    <div className="iw-progress-bar" style={pct === null ? undefined : { width: `${pct}%` }} />
                  </div>
                  <div className="iw-phase" role="status">
                    <LoaderCircle size={14} className="spin" aria-hidden="true" /> {run.status === 'starting' ? 'Starting…' : PHASE_TEXT[run.progress?.phase ?? 'preparing']}
                  </div>
                </div>
              </div>
              <dl className="iw-stats" aria-label="Progress">
                <Stat label="Rows generated" value={`${formatCount(run.progress?.rows ?? 0)}${run.progress ? ` of ${formatCount(run.progress.total)}` : ''}`} />
                <Stat label="Rows / second" value={formatCount(run.progress?.rate ?? 0)} />
                <Stat label="Rejected" value={formatCount(run.progress?.errors ?? 0)} />
                <Stat label="Elapsed" value={formatDuration(elapsed)} />
              </dl>
            </>
          )}

          {run.status === 'failed' && (
            <div className="iw-result iw-tone-error" role="alert">
              <CircleAlert size={22} aria-hidden="true" />
              <div>
                <strong>{run.error}</strong>
                <p className="iw-hint">Nothing more was changed.</p>
                <div className="iw-actions"><button type="button" className="btn" onClick={() => setRun(IDLE_RUN)}>Back to the settings</button></div>
              </div>
            </div>
          )}

          {sum && outcome && (
            <>
              <div className={`iw-result iw-tone-${outcome.tone}`} role={outcome.tone === 'error' ? 'alert' : 'status'}>
                {outcome.tone === 'ok' ? <CircleCheck size={22} aria-hidden="true" /> : sum.outcome === 'cancelled' ? <CircleSlash size={22} aria-hidden="true" /> : <CircleAlert size={22} aria-hidden="true" />}
                <div>
                  <strong>{outcome.title}</strong>
                  <p className="iw-hint" dir="auto">{sum.error ? `${sum.error} ` : ''}{summaryLine(sum)}.</p>
                  <div className="iw-actions">
                    {sum.committed && (
                      <button type="button" className="btn btn-primary" onClick={openData}><TableProperties size={14} aria-hidden="true" /> Open data</button>
                    )}
                    {sum.hasErrorReport && <button type="button" className="btn" onClick={() => void downloadReport()}>Download error report</button>}
                    <button type="button" className="btn" onClick={() => { setRun(IDLE_RUN); patch({ seed: randomSeed() }); }}>Generate more</button>
                  </div>
                </div>
              </div>
              <dl className="iw-stats" aria-label="Summary">
                <Stat label="Rows written" value={formatCount(sum.rowsWritten)} strong />
                <Stat label="Rejected" value={formatCount(sum.errorCount)} />
                <Stat label="Rows / second" value={formatCount(sum.rowsPerSecond)} />
                <Stat label="Time" value={formatDuration(sum.elapsedMs)} />
              </dl>
              {sum.errorsSample.length > 0 && (
                <div className="iw-grid-wrap iw-errors">
                  <table className="iw-map" aria-label="Rejected rows">
                    <thead><tr><th scope="col">Row</th><th scope="col">Problem</th></tr></thead>
                    <tbody>
                      {sum.errorsSample.map((e, i) => (
                        <tr key={i}><td>{formatCount(e.row)}</td><td dir="auto">{e.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <footer className="iw-nav">
        <span className="iw-nav-msg" role="status" aria-live="polite">{nav}</span>
        <span className="iw-nav-spacer" />
        {running ? (
          <button type="button" className="btn" disabled={!run.jobId || run.cancelling} onClick={() => void cancel()}>
            {run.cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!plan || !infos || invalid || !plan.canGenerate} onClick={() => void start()}>
            <Play size={13} aria-hidden="true" /> {generateLabel}
          </button>
        )}
      </footer>
    </div>
  );
}
