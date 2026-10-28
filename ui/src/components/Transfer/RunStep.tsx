// Step 5: review before the transfer starts, the running transfer (overall and per-table progress, rows/s, cancel) and
// its result (per table, errors with the refused statement, open the target).
import { ArrowRight, CircleAlert, CircleCheck, CircleSlash, Database, FileCode2, FolderOpen, LoaderCircle, TableProperties } from 'lucide-react';
import { useEffect, useState, type Ref } from 'react';
import { errorMessage } from '../../api/client';
import { runCommand } from '../../commands/registry';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { fileNameOf } from '../ImportWizard/files';
import { formatBytes, formatCount, formatDuration } from '../ImportWizard/model';
import { StepHeader } from '../ImportWizard/parts';
import { describeTarget } from './labels';
import { OUTCOME, PHASE_TEXT, progressPercent, STEP_OPTIONS } from './model';
import type { Transfer } from './useTransfer';

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`iw-stat${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const CREATE_TEXT = {
  failIfExists: 'Create every table (a table that exists already is an error)',
  skipExisting: 'Create missing tables and keep existing ones',
  dropExisting: 'Drop existing tables and create them again',
  none: 'Use the existing tables',
} as const;
const DATA_TEXT = { append: 'append the rows', truncate: 'replace the rows', upsert: 'insert or update the rows by primary key', none: 'copy no rows' } as const;

function Review({ t }: { t: Transfer }) {
  const { s } = t;
  const o = s.options;
  const plan = s.plan;
  const n = s.selected.length;
  const file = s.targetKind === 'file';
  const lines = [
    `${o.createMode === 'none' ? CREATE_TEXT.none : CREATE_TEXT[o.createMode]}, then ${DATA_TEXT[o.dataMode]}.`,
    o.foreignKeys || o.indexes
      ? 'Tables are copied parents first; indexes and foreign keys are added after the rows where the target allows it.'
      : 'No indexes or foreign keys are created.',
    o.continueOnError ? 'Tables and rows the target refuses are skipped and listed.' : 'The transfer stops at the first statement the target refuses.',
    file ? 'Nothing is changed in any database: only the file is written.' : 'Each batch is committed on its own; a failed transfer keeps what was copied so far.',
  ];
  return (
    <>
      <div className="iw-flow" aria-label="Transfer summary" role="group">
        <div className="iw-flow-end">
          <span className="iw-fileicon iw-fileicon-table"><Database size={22} aria-hidden="true" /></span>
          <div className="iw-flow-text">
            <strong dir="auto">{t.conn?.name}{s.sourceSchema ? ` › ${s.sourceSchema}` : ''}</strong>
            <span className="iw-note">{n} {n === 1 ? 'table' : 'tables'}</span>
          </div>
        </div>
        <ArrowRight size={20} className="iw-flow-arrow" aria-hidden="true" />
        <div className="iw-flow-end">
          <span className="iw-fileicon iw-fileicon-table">{file ? <FileCode2 size={22} aria-hidden="true" /> : <Database size={22} aria-hidden="true" />}</span>
          <div className="iw-flow-text">
            <strong dir="auto">{describeTarget(t)}</strong>
            <span className="iw-note">{plan ? plan.targetDialect : ''}</span>
          </div>
        </div>
      </div>
      <div className="iw-summary" role="note" aria-label="What will happen">
        <strong>What will happen</strong>
        <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
      {plan && (
        <ol className="tr-order" aria-label="Copy order">
          {plan.tables.map((tb) => (
            <li key={tb.sourceName} className={tb.error ? 'tr-error' : undefined}>
              <span dir="auto">{tb.sourceName}</span> <ArrowRight size={12} aria-hidden="true" /> <span dir="auto">{tb.targetName}</span>
              {tb.error && <span className="iw-error-text"> · {tb.error}</span>}
            </li>
          ))}
        </ol>
      )}
      {plan && plan.schemaStatements.length > 0 && (
        <details className="iw-more">
          <summary>Schema statements</summary>
          <pre className="iw-code" tabIndex={0}>{plan.schemaStatements.join(';\n')}</pre>
        </details>
      )}
    </>
  );
}

export function RunStep({ t, headingRef }: { t: Transfer; headingRef: Ref<HTMLHeadingElement> }) {
  const { s } = t;
  const run = s.run;
  const running = run.status === 'starting' || run.status === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const result = run.result;
  const pct = progressPercent(run.done, run.total);
  const elapsed = result ? result.elapsedMs : run.startedAt ? now - run.startedAt : 0;
  const p = run.progress;
  const outcome = result ? OUTCOME[result.status] ?? OUTCOME.error : null;
  const idle = run.status === 'idle';
  const title = idle ? 'Review and transfer' : running ? 'Transferring…' : outcome ? outcome.title : 'Transfer failed';
  const help = idle ? 'Nothing is written until you press Start transfer.'
    : running ? 'You can keep working; closing this tab asks first.' : 'Here is what happened.';

  const openTable = (name: string) => {
    const schema = s.targetSchema.trim() || t.target.defaultSchema;
    runCommand('data.open', { kind: 'object', connectionId: s.targetCid, database: s.targetDb, ref: { database: s.targetDb, schema, name, type: 'table' } });
  };
  const platform = getPlatform();
  const openFile = async (path: string) => {
    try {
      await platform.openPath?.(path);
    } catch (e) {
      toast('warning', 'Could not open the file', errorMessage(e));
    }
  };

  return (
    <section className="iw-step" aria-labelledby="tr-run-title">
      <StepHeader ref={headingRef} id="tr-run-title" title={title} help={help} />
      {idle && <Review t={t} />}

      {running && (
        <>
          <div className="iw-bigprogress">
            <div className="iw-bigpct" aria-hidden="true">{pct === null ? '…' : `${Math.round(pct)}%`}</div>
            <div className="iw-bigprogress-main">
              <div
                className={`iw-progress${pct === null ? ' indeterminate' : ''}`} role="progressbar" aria-label="Transfer progress"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)}
              >
                <div className="iw-progress-bar" style={pct === null ? undefined : { width: `${pct}%` }} />
              </div>
              <div className="iw-phase" role="status">
                <LoaderCircle size={14} className="spin" aria-hidden="true" /> {run.status === 'starting' ? 'Starting…' : PHASE_TEXT[p?.phase ?? 'counting']}
                {p?.table ? ` ${p.table} (${p.tableIndex} of ${p.tableCount})` : ''}
              </div>
            </div>
          </div>
          <dl className="iw-stats" aria-label="Progress">
            <Stat label="Rows copied" value={`${formatCount(run.done)}${run.total !== null ? ` of ${formatCount(run.total)}` : ''}`} />
            <Stat label="Rows / second" value={formatCount(p?.rowsPerSecond ?? 0)} />
            <Stat label="Elapsed" value={formatDuration(elapsed)} />
          </dl>
        </>
      )}

      {running && (
        <ul className="tr-progress-list" aria-label="Tables">
          {Object.entries(run.tables).map(([name, tr]) => (
            <li key={name} className={`tr-${tr.status}`}>
              {tr.status === 'running' ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : tr.status === 'done' ? <CircleCheck size={12} aria-hidden="true" /> : <span className="tr-dot" aria-hidden="true" />}
              <span dir="auto">{name}</span>
              <span className="iw-note">{tr.status === 'waiting' ? 'waiting' : `${formatCount(tr.rows)}${tr.total !== null ? ` of ${formatCount(tr.total)}` : ''} rows`}</span>
            </li>
          ))}
        </ul>
      )}

      {run.status === 'failed' && (
        <div className="iw-result iw-tone-error" role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <div>
            <strong>{run.error}</strong>
            <p className="iw-hint">Tables and rows copied before the failure stay in the target.</p>
            <div className="iw-actions"><button type="button" className="btn" onClick={() => t.goTo(STEP_OPTIONS)}>Back to options</button></div>
          </div>
        </div>
      )}

      {result && outcome && (
        <>
          <div className={`iw-result iw-tone-${outcome.tone}`} role={outcome.tone === 'error' ? 'alert' : 'status'}>
            {outcome.tone === 'ok' ? <CircleCheck size={22} aria-hidden="true" /> : result.status === 'cancelled' ? <CircleSlash size={22} aria-hidden="true" /> : <CircleAlert size={22} aria-hidden="true" />}
            <div>
              <strong>{outcome.title}</strong>
              <p className="iw-hint">
                {result.filePath ? `Wrote ${fileNameOf(result.filePath)}${result.fileBytes !== null ? ` (${formatBytes(result.fileBytes)})` : ''}.`
                  : s.targetKind === 'file' ? 'No file was written.' : `${formatCount(result.totalRows)} rows copied to ${describeTarget(t)}.`}
              </p>
              <div className="iw-actions">
                {result.filePath && platform.openPath && (
                  <button type="button" className="btn btn-primary" onClick={() => void openFile(result.filePath!)}><FolderOpen size={14} aria-hidden="true" /> Open the file</button>
                )}
              </div>
            </div>
          </div>
          <dl className="iw-stats" aria-label="Summary">
            <Stat label="Rows copied" value={formatCount(result.totalRows)} strong />
            <Stat label="Tables" value={`${result.tables.filter((x) => x.status === 'ok').length} of ${result.tables.length}`} />
            <Stat label="Errors" value={formatCount(result.errors.length)} />
            <Stat label="Time" value={formatDuration(result.elapsedMs)} />
          </dl>
          <div className="iw-grid-wrap">
            <table className="iw-map" aria-label="Tables transferred">
              <thead><tr><th scope="col">Table</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Rows</th><th scope="col">Time</th><th scope="col" /></tr></thead>
              <tbody>
                {result.tables.map((r) => (
                  <tr key={r.name} className={r.status === 'ok' ? undefined : 'tr-error'}>
                    <td dir="auto">{r.name}</td>
                    <td dir="auto">{r.targetName}{r.created ? ' (created)' : ''}</td>
                    <td>{r.status}{r.error ? `: ${r.error}` : ''}{r.errorRows > 0 ? ` (${formatCount(r.errorRows)} rows refused)` : ''}</td>
                    <td>{formatCount(r.rows)}</td>
                    <td>{formatDuration(r.elapsedMs)}</td>
                    <td>
                      {s.targetKind === 'connection' && r.status !== 'error' && (
                        <button type="button" className="btn btn-xs" onClick={() => openTable(r.targetName)} aria-label={`Open data of ${r.targetName}`}>
                          <TableProperties size={12} aria-hidden="true" /> Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.errors.length > 0 && (
            <div className="iw-grid-wrap iw-errors">
              <table className="iw-map" aria-label="Errors">
                <thead><tr><th scope="col">Table</th><th scope="col">Phase</th><th scope="col">Problem</th><th scope="col">Statement</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td dir="auto">{e.table}</td>
                      <td>{e.phase}</td>
                      <td dir="auto">{e.message}</td>
                      <td><code className="tr-sql">{e.sql ?? ''}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
