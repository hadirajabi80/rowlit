// Step 6: review before the import starts, the running import (progress, rows/sec, ETA, log, cancel) and its summary
// (outcome, counts, errors, report download).
import { ArrowRight, CircleAlert, CircleCheck, CircleSlash, Download, FileInput, LoaderCircle, TableProperties } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { errorMessage } from '../../api/client';
import { runCommand } from '../../commands/registry';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { importApi } from './api';
import { FORMAT_LABEL, fileNameOf } from './files';
import { estimateRows, formatBytes, formatCount, formatDuration, lastNamePart, progressPercent } from './model';
import { FileTypeIcon, StepHeader } from './parts';
import type { ImportMode, ImportOutcome } from './types';
import type { Wizard } from './useWizard';
import { PHASE_TEXT, STEP_OPTIONS } from './wizardState';

const OUTCOME: Record<ImportOutcome, { title: string; tone: 'ok' | 'warn' | 'error' }> = {
  completed: { title: 'Import complete', tone: 'ok' },
  completedWithErrors: { title: 'Import complete, some rows were skipped', tone: 'warn' },
  failed: { title: 'Import failed', tone: 'error' },
  cancelled: { title: 'Import cancelled', tone: 'warn' },
};

const MODE_LABEL: Record<ImportMode, string> = {
  append: 'Append', truncateInsert: 'Replace all rows', upsert: 'Insert or update by key', updateOnly: 'Update only',
};

function describePlan(w: Wizard): string[] {
  const { s } = w;
  const lines: string[] = [];
  const table = `${s.schema ? `${s.schema}.` : ''}${w.tableName}`;
  const cols = w.request?.columns.length ?? 0;
  const file = fileNameOf(s.path);
  if (w.create) lines.push(`Create the table ${table} with ${cols} ${cols === 1 ? 'column' : 'columns'} and load the rows of ${file}.`);
  else {
    const verb = { append: 'Append the rows of', truncateInsert: 'Replace the contents of', upsert: 'Insert or update', updateOnly: 'Update' }[w.mode];
    lines.push(
      w.mode === 'truncateInsert' ? `${verb} ${table} with the rows of ${file} (${cols} columns).`
        : w.mode === 'append' ? `${verb} ${file} to ${table} (${cols} columns).`
          : `${verb} rows of ${table} from ${file} by ${w.s.keyColumns.join(', ') || '(no key)'}.`,
    );
  }
  lines.push(s.onError === 'stop' ? 'The import stops at the first row that cannot be loaded.' : `Rows that cannot be loaded are skipped and listed in an error report${s.maxErrors > 0 ? ` (stops after ${formatCount(s.maxErrors)} errors)` : ''}.`);
  lines.push(
    w.transaction ? 'Everything runs in one transaction: if the import fails or is cancelled, nothing is changed.'
      : w.transactional ? `Every batch of ${formatCount(w.batchSize)} rows is committed on its own; a failed import keeps the rows loaded so far.`
        : 'This database loads rows without a transaction: a failed import keeps the rows loaded so far.',
  );
  if (s.limit > 0) lines.push(`Test run: only the first ${formatCount(s.limit)} rows are loaded.`);
  return lines;
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`iw-stat${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Review({ w }: { w: Wizard }) {
  const { s } = w;
  const est = estimateRows(s.preview);
  const rows = s.limit > 0 && est ? Math.min(est.rows, s.limit) : s.limit > 0 ? s.limit : est?.rows;
  const table = `${s.schema ? `${s.schema}.` : ''}${w.tableName}`;
  const format = s.preview?.options.format;
  return (
    <>
      <div className="iw-flow" aria-label="Import summary" role="group">
        <div className="iw-flow-end">
          <span className={`iw-fileicon iw-fileicon-${format ?? 'csv'}`}><FileTypeIcon path={s.path} size={22} /></span>
          <div className="iw-flow-text">
            <strong dir="auto">{fileNameOf(s.path)}</strong>
            <span className="iw-note">
              {format ? FORMAT_LABEL[format] : 'File'}{s.preview ? ` · ${formatBytes(s.preview.fileSize)}` : ''}
              {rows !== undefined ? ` · ${est && !est.exact && s.limit === 0 ? 'about ' : ''}${formatCount(rows)} rows` : ''}
            </span>
          </div>
        </div>
        <ArrowRight size={20} className="iw-flow-arrow" aria-hidden="true" />
        <div className="iw-flow-end">
          <span className="iw-fileicon iw-fileicon-table"><TableProperties size={22} aria-hidden="true" /></span>
          <div className="iw-flow-text">
            <strong dir="auto">{table}</strong>
            <span className="iw-note">{w.conn?.name}{w.dbEngine ? ` · ${w.dbEngine}` : ''} · {w.create ? 'new table' : 'existing table'}</span>
          </div>
        </div>
      </div>
      <dl className="iw-stats iw-review-facts" aria-label="Settings">
        <Stat label="Mode" value={w.create ? 'Create and load' : MODE_LABEL[w.mode]} />
        <Stat label="Columns" value={formatCount(w.request?.columns.length ?? 0)} />
        <Stat label="On error" value={s.onError === 'stop' ? 'Stop' : 'Skip and log'} />
        <Stat label="Transaction" value={w.transaction ? 'One transaction' : 'Per batch'} />
      </dl>
      <div className="iw-summary" role="note" aria-label="What will happen">
        <strong>What will happen</strong>
        <ul>{describePlan(w).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </>
  );
}

export function RunStep({ w, headingRef }: { w: Wizard; headingRef: Ref<HTMLHeadingElement> }) {
  const { s } = w;
  const run = s.run;
  const running = run.status === 'starting' || run.status === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const logRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.log.length]);

  const p = run.progress;
  const sum = run.summary;
  const pct = progressPercent(p);
  const elapsed = sum ? sum.elapsedMs : run.startedAt ? now - run.startedAt : 0;
  const rows = p?.rows ?? run.rowsRead;
  const eta = pct !== null && pct >= 1 && pct < 100 ? (elapsed * (100 - pct)) / pct : null;

  const downloadReport = async () => {
    if (!run.jobId) return;
    try {
      const blob = await importApi.errorReport(run.jobId);
      const saved = await getPlatform().saveFile({
        suggestedName: 'import-errors.csv', filters: [{ name: 'CSV', extensions: ['csv'] }], content: blob, mime: 'text/csv;charset=utf-8',
      });
      if (saved) toast('success', `Saved the error report`, saved);
    } catch (e) {
      toast('error', 'Could not download the error report', errorMessage(e));
    }
  };

  const openData = () => {
    const name = sum?.createdTable ? lastNamePart(sum.createdTable) : w.tableName;
    runCommand('data.open', {
      kind: 'object', connectionId: w.cid, database: w.dbCatalog, ref: { database: w.dbCatalog, schema: s.schema, name, type: 'table' },
    });
  };

  const idle = run.status === 'idle';
  const title = idle ? 'Review and import' : running ? 'Importing…' : sum ? OUTCOME[sum.outcome].title : 'Import failed';
  const help = idle
    ? 'Nothing is written until you press Start import.'
    : running ? 'You can leave this tab open and keep working; closing it asks first.' : sum ? 'Here is what happened.' : 'Nothing more was changed.';

  return (
    <section className="iw-step" aria-labelledby="iw-run-title">
      <StepHeader ref={headingRef} id="iw-run-title" title={title} help={help} />

      {idle && <Review w={w} />}

      {running && (
        <>
          <div className="iw-bigprogress">
            <div className="iw-bigpct" aria-hidden="true">{pct === null ? '…' : `${Math.round(pct)}%`}</div>
            <div className="iw-bigprogress-main">
              <div
                className={`iw-progress${pct === null ? ' indeterminate' : ''}`}
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct === null ? undefined : Math.round(pct)}
              >
                <div className="iw-progress-bar" style={pct === null ? undefined : { width: `${pct}%` }} />
              </div>
              <div className="iw-phase" role="status">
                <LoaderCircle size={14} className="spin" aria-hidden="true" /> {run.status === 'starting' ? 'Starting…' : PHASE_TEXT[p?.phase ?? 'preparing']}
                {eta !== null && <span className="iw-eta"> · about {formatDuration(eta)} left</span>}
              </div>
            </div>
          </div>
          <dl className="iw-stats" aria-label="Progress">
            <Stat label="Rows read" value={formatCount(rows)} />
            <Stat label="Rows written" value={formatCount(p?.written ?? 0)} />
            <Stat label="Skipped" value={formatCount(p?.skipped ?? 0)} />
            <Stat label="Errors" value={formatCount(p?.errors ?? 0)} />
            <Stat label="Rows / second" value={formatCount(p?.rate ?? 0)} />
            <Stat label="Elapsed" value={formatDuration(elapsed)} />
            {p && p.totalBytes > 0 && <Stat label="File read" value={`${formatBytes(p.bytes)} of ${formatBytes(p.totalBytes)}`} />}
          </dl>
        </>
      )}

      {(running || run.log.length > 0) && !idle && (
        <section className="iw-card iw-logcard" aria-label="Import log">
          <h3 className="iw-sub">Log</h3>
          <ol className="iw-log" ref={logRef} tabIndex={0} aria-live="off">
            {run.log.map((l, i) => (
              <li key={i} className={`iw-log-${l.tone}`}>
                <time className="iw-log-t">{formatDuration(l.at)}</time> {l.text}
              </li>
            ))}
          </ol>
        </section>
      )}

      {run.status === 'failed' && (
        <div className="iw-result iw-tone-error" role="alert">
          <CircleAlert size={22} aria-hidden="true" />
          <div>
            <strong>{run.error}</strong>
            <p className="iw-hint">Nothing more was changed. Go back to adjust the options, or run the import again.</p>
            <div className="iw-actions">
              <button type="button" className="btn" onClick={() => w.goTo(STEP_OPTIONS)}>Back to options</button>
            </div>
          </div>
        </div>
      )}

      {sum && (
        <>
          <div className={`iw-result iw-tone-${OUTCOME[sum.outcome].tone}`} role={sum.outcome === 'failed' ? 'alert' : 'status'}>
            {OUTCOME[sum.outcome].tone === 'ok' ? <CircleCheck size={22} aria-hidden="true" /> : sum.outcome === 'cancelled' ? <CircleSlash size={22} aria-hidden="true" /> : <CircleAlert size={22} aria-hidden="true" />}
            <div>
              <strong>{OUTCOME[sum.outcome].title}</strong>
              {sum.error && <p>{sum.error}</p>}
              <p className="iw-hint">
                {sum.rolledBack ? 'All changes were rolled back.' : sum.committed ? 'The changes are committed.' : 'Nothing was written.'}
                {sum.createdTable ? ` Created ${sum.createdTable}.` : ''}
              </p>
              <div className="iw-actions">
                {(w.create ? !!sum.createdTable : true) && (
                  <button type="button" className="btn btn-primary" onClick={openData}><TableProperties size={14} aria-hidden="true" /> Open table data</button>
                )}
                {sum.hasErrorReport && run.jobId && (
                  <button type="button" className="btn" onClick={() => void downloadReport()}><Download size={14} aria-hidden="true" /> Download error report</button>
                )}
              </div>
            </div>
          </div>
          <dl className="iw-stats" aria-label="Summary">
            <Stat label="Rows read" value={formatCount(sum.rowsRead)} />
            <Stat label="Rows written" value={formatCount(sum.rowsWritten)} strong />
            <Stat label="Skipped" value={formatCount(sum.rowsSkipped)} />
            <Stat label="Errors" value={formatCount(sum.errorCount)} />
            <Stat label="Time" value={formatDuration(sum.elapsedMs)} />
            <Stat label="Rows / second" value={formatCount(sum.rowsPerSecond)} />
            <Stat label="Load method" value={sum.loadMethod} />
          </dl>
          {sum.ddl && (
            <details className="iw-more">
              <summary><FileInput size={13} aria-hidden="true" /> CREATE TABLE statement</summary>
              <pre className="iw-code" tabIndex={0}>{sum.ddl}</pre>
            </details>
          )}
          {sum.errorsSample.length > 0 && (
            <div className="iw-grid-wrap iw-errors">
              <table className="iw-map" aria-label="Errors">
                <caption>{sum.errorCount > sum.errorsSample.length ? `First ${sum.errorsSample.length} of ${formatCount(sum.errorCount)} errors` : 'Errors'}</caption>
                <thead><tr><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Problem</th><th scope="col">Values</th></tr></thead>
                <tbody>
                  {sum.errorsSample.map((e, i) => (
                    <tr key={i}>
                      <td>{formatCount(e.row)}</td>
                      <td dir="auto">{e.column ?? ''}</td>
                      <td dir="auto">{e.message}</td>
                      <td className="iw-values" dir="auto">{(e.values ?? []).map((v) => v ?? 'NULL').join(' | ')}</td>
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
