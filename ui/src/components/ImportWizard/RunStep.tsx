// Step 5: the running import (progress, rows/sec, cancel) and its summary (outcome, counts, errors, report download).
import { CircleAlert, CircleCheck, CircleSlash, Download, LoaderCircle, TableProperties } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { runCommand } from '../../commands/registry';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { importApi } from './api';
import { formatBytes, formatCount, formatDuration, lastNamePart, progressPercent } from './model';
import type { ImportOutcome, ImportPhase } from './types';
import type { Wizard } from './useWizard';

const PHASE: Record<ImportPhase, string> = {
  preparing: 'Preparing…',
  truncating: 'Clearing the table…',
  importing: 'Importing rows…',
  committing: 'Committing…',
  done: 'Finishing…',
};

const OUTCOME: Record<ImportOutcome, { title: string; tone: 'ok' | 'warn' | 'error' }> = {
  completed: { title: 'Import complete', tone: 'ok' },
  completedWithErrors: { title: 'Import complete, some rows were skipped', tone: 'warn' },
  failed: { title: 'Import failed', tone: 'error' },
  cancelled: { title: 'Import cancelled', tone: 'warn' },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="iw-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function RunStep({ w }: { w: Wizard }) {
  const { s } = w;
  const run = s.run;
  const running = run.status === 'starting' || run.status === 'running';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const p = run.progress;
  const sum = run.summary;
  const pct = progressPercent(p);
  const elapsed = sum ? sum.elapsedMs : run.startedAt ? now - run.startedAt : 0;
  const rows = p?.rows ?? run.rowsRead;

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

  const closeTab = () => runCommand('tab.close', { kind: 'tab', tabId: w.tab.id });

  return (
    <section className="iw-step" aria-labelledby="iw-run-title">
      <h2 id="iw-run-title" className="iw-h">{running ? 'Importing…' : sum ? OUTCOME[sum.outcome].title : run.status === 'failed' ? 'Import failed' : 'Import'}</h2>

      {running && (
        <>
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
            <LoaderCircle size={14} className="spin" /> {run.status === 'starting' ? 'Starting…' : PHASE[p?.phase ?? 'preparing']}
            {pct !== null && <span> {Math.round(pct)}%</span>}
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
          <div className="iw-actions">
            <button type="button" className="btn" disabled={!run.jobId || run.cancelling} onClick={() => void w.cancel()}>
              {run.cancelling ? 'Cancelling…' : 'Cancel import'}
            </button>
          </div>
        </>
      )}

      {run.status === 'failed' && (
        <div className="iw-result iw-tone-error" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>{run.error}</strong>
            <p className="iw-hint">Nothing more was changed. Go back to adjust the options, or run the import again.</p>
          </div>
        </div>
      )}

      {sum && (
        <>
          <div className={`iw-result iw-tone-${OUTCOME[sum.outcome].tone}`} role={sum.outcome === 'failed' ? 'alert' : 'status'}>
            {OUTCOME[sum.outcome].tone === 'ok' ? <CircleCheck size={18} /> : sum.outcome === 'cancelled' ? <CircleSlash size={18} /> : <CircleAlert size={18} />}
            <div>
              <strong>{OUTCOME[sum.outcome].title}</strong>
              {sum.error && <p>{sum.error}</p>}
              <p className="iw-hint">
                {sum.rolledBack ? 'All changes were rolled back.' : sum.committed ? 'The changes are committed.' : 'Nothing was written.'}
                {sum.createdTable ? ` Created ${sum.createdTable}.` : ''}
              </p>
            </div>
          </div>
          <dl className="iw-stats" aria-label="Summary">
            <Stat label="Rows read" value={formatCount(sum.rowsRead)} />
            <Stat label="Rows written" value={formatCount(sum.rowsWritten)} />
            <Stat label="Skipped" value={formatCount(sum.rowsSkipped)} />
            <Stat label="Errors" value={formatCount(sum.errorCount)} />
            <Stat label="Time" value={formatDuration(sum.elapsedMs)} />
            <Stat label="Rows / second" value={formatCount(sum.rowsPerSecond)} />
            <Stat label="Load method" value={sum.loadMethod} />
          </dl>
          {sum.ddl && (
            <details className="iw-more">
              <summary>CREATE TABLE statement</summary>
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

      {!running && run.status !== 'idle' && (
        <div className="iw-actions">
          {sum?.hasErrorReport && run.jobId && (
            <button type="button" className="btn" onClick={() => void downloadReport()}><Download size={14} /> Download error report</button>
          )}
          {sum && (w.create ? !!sum.createdTable : true) && (
            <button type="button" className="btn" onClick={openData}><TableProperties size={14} /> Open table data</button>
          )}
          {run.status === 'failed' && (
            <button type="button" className="btn" onClick={() => w.goTo(3)}>Back to options</button>
          )}
          <button type="button" className="btn" onClick={w.restart}>Import another file</button>
          <button type="button" className="btn btn-primary" onClick={closeTab}>Close</button>
        </div>
      )}
    </section>
  );
}
