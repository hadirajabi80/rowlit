// "Apply to target…": confirms running the migration script on the target. Data-loss warnings are listed and must be
// acknowledged before Apply is enabled; the result shows how many statements ran and every failure with its statement.
import { CircleCheck, CircleX, LoaderCircle, OctagonAlert } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { CompareApplyResult, CompareScript } from '../../api/types.schemaCompare';
import { Dialog } from '../common/Dialog';
import { dataLossWarnings, nameOfId } from './model';

export interface ApplyDialogProps {
  script: CompareScript;
  targetLabel: string;
  /** Runs the script on the target (the engine call). */
  apply: (stopOnError: boolean) => Promise<CompareApplyResult>;
  onClose: () => void;
  /** After a successful apply: compare again (the target changed). */
  onCompareAgain: () => void;
}

export function ApplyDialog({ script, targetLabel, apply, onClose, onCompareAgain }: ApplyDialogProps) {
  const losses = dataLossWarnings(script);
  const [ack, setAck] = useState(false);
  const [stopOnError, setStopOnError] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CompareApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = script.statements.length;
  const blocked = losses.length > 0 && !ack;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await apply(stopOnError));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const footer = result ? (
    <>
      <span className="flex-1" />
      {result.ok && (
        <button type="button" className="btn" onClick={() => { onClose(); onCompareAgain(); }}>
          Compare again
        </button>
      )}
      <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
    </>
  ) : (
    <>
      <span className="flex-1" />
      <button type="button" className="btn" onClick={onClose} disabled={running}>Cancel</button>
      <button type="button" className={`btn ${losses.length ? 'btn-danger' : 'btn-primary'}`} onClick={() => void run()} disabled={running || blocked || n === 0}>
        {running && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
        {running ? 'Applying…' : `Apply ${n} ${n === 1 ? 'statement' : 'statements'}`}
      </button>
    </>
  );

  return (
    <Dialog title="Apply the script to the target" onClose={running ? () => {} : onClose} width={640} footer={footer}>
      {!result && (
        <div className="sc-apply">
          <p>
            Runs {n} {n === 1 ? 'statement' : 'statements'} for {script.itemCount} {script.itemCount === 1 ? 'object' : 'objects'} on <strong>{targetLabel}</strong>.
          </p>
          <p className="muted">
            {script.transactionalDdl
              ? stopOnError ? 'The script runs in one transaction: if a statement fails, nothing is changed.' : 'Every statement runs on its own; failures are listed and the rest still runs.'
              : 'DDL is not transactional on this server: statements that ran before a failure stay applied.'}
          </p>
          {losses.length > 0 && (
            <div className="sc-apply-loss" role="alert">
              <p className="sc-apply-loss-title"><OctagonAlert size={14} aria-hidden="true" /> This script deletes data</p>
              <ul>
                {losses.map((w, i) => <li key={i}><strong>{nameOfId(w.itemId)}</strong>: {w.message}</li>)}
              </ul>
              <label className="sc-check">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand that this data is lost
              </label>
            </div>
          )}
          <label className="sc-check">
            <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} disabled={running} />
            Stop at the first error{script.transactionalDdl ? ' and roll back' : ''}
          </label>
          {error && <p className="sc-error" role="alert">{error}</p>}
        </div>
      )}
      {result && (
        <div className="sc-apply-result" role="status">
          {result.ok ? (
            <p className="sc-ok"><CircleCheck size={16} aria-hidden="true" /> Applied {result.executed} of {result.total} {result.total === 1 ? 'statement' : 'statements'} in {result.elapsedMs} ms.</p>
          ) : (
            <p className="sc-error">
              <CircleX size={16} aria-hidden="true" /> {result.executed} of {result.total} statements ran
              {result.rolledBack ? '; the transaction was rolled back, nothing changed.' : '.'}
            </p>
          )}
          {result.failures.length > 0 && (
            <ul className="sc-failures" aria-label="Failures">
              {result.failures.map((f) => (
                <li key={f.index}>
                  <p>Statement {f.index + 1}{f.itemId ? ` (${nameOfId(f.itemId)})` : ''}: {f.message}{f.code ? ` [${f.code}]` : ''}</p>
                  <pre className="sc-code">{f.sql}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
