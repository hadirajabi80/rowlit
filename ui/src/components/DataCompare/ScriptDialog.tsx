// "Generate sync script…": direction (make the target like the source, or the reverse), the classes to sync, the
// generated INSERT / UPDATE / DELETE script (copy, open in a console) and Apply with a confirmation that lists the counts,
// run as a `data.sync` job with progress.
import { CircleCheck, CircleX, ClipboardCopy, LoaderCircle, OctagonAlert, SquareTerminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import type {
  DataApplyResult, DataCompareResult, DataSyncScript, SyncClass, SyncDirection,
} from '../../api/types.dataCompare';
import { Dialog } from '../common/Dialog';
import { dataCompareApi } from './api';
import { listenForJobs, waitForJob } from './jobs';
import { syncActions } from './model';

export interface ScriptDialogProps {
  result: DataCompareResult;
  onClose: () => void;
  onCopy: (text: string) => void;
  onOpenInConsole: (script: DataSyncScript) => void;
  /** After a successful apply: compare again (a side changed). */
  onCompareAgain: () => void;
}

type Stage = 'script' | 'confirm' | 'applying' | 'done';

export function ScriptDialog({ result, onClose, onCopy, onOpenInConsole, onCompareAgain }: ScriptDialogProps) {
  const { sync, counts } = result;
  const [direction, setDirection] = useState<SyncDirection>(sync.toTarget || !sync.toSource ? 'toTarget' : 'toSource');
  const actions = syncActions(direction, counts);
  const [classes, setClasses] = useState<Set<SyncClass>>(() => new Set(syncActions(direction, counts).filter((a) => a.count > 0).map((a) => a.cls)));
  const [script, setScript] = useState<DataSyncScript | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('script');
  const [transactional, setTransactional] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);
  const [applied, setApplied] = useState<DataApplyResult | null>(null);
  const jobRef = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const side = direction === 'toTarget' ? 'target' : 'source';
  const sideLabel = direction === 'toTarget' ? result.targetLabel : result.sourceLabel;
  const blocked = direction === 'toTarget' ? sync.toTargetReason : sync.toSourceReason;
  const canApply = direction === 'toTarget' ? sync.applyToTarget : sync.applyToSource;
  const picked = actions.filter((a) => classes.has(a.cls) && a.count > 0);

  const changeDirection = (d: SyncDirection) => {
    setDirection(d);
    setClasses(new Set(syncActions(d, counts).filter((a) => a.count > 0).map((a) => a.cls)));
    setScript(null);
  };
  const toggle = (cls: SyncClass) => {
    setClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
    setScript(null);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await dataCompareApi.script(result.compareId, { direction, classes: picked.map((a) => a.cls) });
      if (alive.current) setScript(s);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const apply = async () => {
    setStage('applying');
    setError(null);
    setProgress({ done: 0, total: script?.statements ?? null });
    try {
      listenForJobs();
      const { jobId } = await dataCompareApi.apply(result.compareId, { direction, classes: picked.map((a) => a.cls), transactional });
      jobRef.current = jobId;
      const end = await waitForJob<DataApplyResult>(jobId, (ev) => alive.current && setProgress({ done: ev.done, total: ev.total }));
      if (!alive.current) return;
      if (end.status === 'ok' && end.result) setApplied(end.result);
      else setError(end.status === 'cancelled' ? 'The synchronization was cancelled.' : end.error ?? 'The synchronization failed.');
      setStage('done');
    } catch (e) {
      if (alive.current) {
        setError(errorMessage(e));
        setStage('done');
      }
    } finally {
      jobRef.current = null;
    }
  };

  const cancelApply = () => {
    if (jobRef.current) void dataCompareApi.cancel(jobRef.current).catch(() => {});
  };

  const footer = stage === 'done' ? (
    <>
      <span className="flex-1" />
      {applied && applied.status !== 'error' && (
        <button type="button" className="btn" onClick={() => { onClose(); onCompareAgain(); }}>Compare again</button>
      )}
      <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
    </>
  ) : stage === 'applying' ? (
    <>
      <span className="flex-1" />
      <button type="button" className="btn" onClick={cancelApply}>Cancel</button>
    </>
  ) : stage === 'confirm' && script ? (
    <>
      <span className="flex-1" />
      <button type="button" className="btn" onClick={() => setStage('script')}>Back</button>
      <button type="button" className={`btn ${script.deletes > 0 ? 'btn-danger' : 'btn-primary'}`} onClick={() => void apply()}>
        Apply to the {side}
      </button>
    </>
  ) : (
    <>
      {script && (
        <>
          <button type="button" className="btn" onClick={() => onCopy(script.text)}><ClipboardCopy size={14} aria-hidden="true" /> Copy</button>
          <button type="button" className="btn" onClick={() => onOpenInConsole(script)}><SquareTerminal size={14} aria-hidden="true" /> Open in console</button>
        </>
      )}
      <span className="flex-1" />
      <button type="button" className="btn" onClick={onClose}>Close</button>
      {script ? (
        <button type="button" className="btn btn-primary" disabled={!canApply || script.statements === 0}
          title={!canApply ? `The ${side} connection is read-only: copy the script or open it in a console instead.` : undefined}
          onClick={() => setStage('confirm')}>
          Apply…
        </button>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy || !!blocked || picked.length === 0} onClick={() => void generate()}>
          {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />} Generate script
        </button>
      )}
    </>
  );

  return (
    <Dialog title="Synchronize data" onClose={stage === 'applying' ? () => {} : onClose} width={760} footer={footer}>
      <div className="dc-sync">
        {(stage === 'script') && (
          <>
            <fieldset className="dc-sync-dir">
              <legend>Direction</legend>
              <label className={sync.toTarget ? undefined : 'muted'} title={sync.toTargetReason ?? undefined}>
                <input type="radio" name="dc-dir" checked={direction === 'toTarget'} disabled={!sync.toTarget} onChange={() => changeDirection('toTarget')} />
                Make the target like the source <span className="muted">({result.targetLabel} changes)</span>
              </label>
              <label className={sync.toSource ? undefined : 'muted'} title={sync.toSourceReason ?? undefined}>
                <input type="radio" name="dc-dir" checked={direction === 'toSource'} disabled={!sync.toSource} onChange={() => changeDirection('toSource')} />
                Make the source like the target <span className="muted">({result.sourceLabel} changes)</span>
              </label>
            </fieldset>
            {blocked && <p className="dc-error" role="alert">{blocked}</p>}
            <fieldset className="dc-sync-classes">
              <legend>Rows to synchronize</legend>
              {actions.map((a) => (
                <label key={a.cls} className={a.count === 0 ? 'muted' : undefined}>
                  <input type="checkbox" checked={classes.has(a.cls) && a.count > 0} disabled={a.count === 0} onChange={() => toggle(a.cls)} />
                  {a.label}
                </label>
              ))}
              {counts.duplicate > 0 && <p className="muted">{counts.duplicate.toLocaleString()} rows with a duplicate key are never synchronized.</p>}
            </fieldset>
            {result.truncatedDiffs && (
              <p className="dc-warn" role="note">Only the first {result.keptDifferences.toLocaleString()} differences were kept: the script covers those; compare again afterwards.</p>
            )}
            {script && (
              <>
                <p className="dc-sync-summary">
                  {script.deletes.toLocaleString()} deletes · {script.updates.toLocaleString()} updates · {script.inserts.toLocaleString()} inserts in {script.statements.toLocaleString()} statements
                </p>
                {script.warnings.length > 0 && (
                  <ul className="dc-warnings" aria-label="Warnings">{script.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
                <pre className="dc-script" aria-label="Sync script" tabIndex={0}>{script.text}</pre>
              </>
            )}
          </>
        )}
        {stage === 'confirm' && script && (
          <div className="dc-confirm">
            <p>This changes <strong>{sideLabel}</strong>:</p>
            <ul>
              <li>{script.inserts.toLocaleString()} rows inserted</li>
              <li>{script.updates.toLocaleString()} rows updated</li>
              <li className={script.deletes > 0 ? 'dc-danger' : undefined}>{script.deletes.toLocaleString()} rows deleted</li>
            </ul>
            {script.deletes > 0 && <p className="dc-danger"><OctagonAlert size={14} aria-hidden="true" /> Deleted rows cannot be recovered unless the run is rolled back.</p>}
            <label className="dc-check">
              <input type="checkbox" checked={transactional} onChange={(e) => setTransactional(e.target.checked)} />
              Run in one transaction (roll everything back if a statement fails)
            </label>
          </div>
        )}
        {stage === 'applying' && (
          <div className="dc-progress" role="status" aria-live="polite">
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            <span>Applying{progress?.total ? ` (${progress.done} of ${progress.total} statements)` : ''}</span>
            <progress max={progress?.total ?? undefined} value={progress?.total ? progress.done : undefined} aria-label="Synchronization progress" />
          </div>
        )}
        {stage === 'done' && applied && (
          <div className="dc-applied" role="status">
            {applied.status === 'ok' ? (
              <p className="dc-ok"><CircleCheck size={16} aria-hidden="true" /> Synchronized: {applied.inserted.toLocaleString()} inserted, {applied.updated.toLocaleString()} updated, {applied.deleted.toLocaleString()} deleted ({applied.executed} statements, {applied.elapsedMs} ms).</p>
            ) : (
              <p className="dc-error"><CircleX size={16} aria-hidden="true" /> {applied.rolledBack ? 'A statement failed: nothing was changed (rolled back).' : `${applied.failures.length} statements failed; ${applied.executed} ran.`}</p>
            )}
            {applied.failures.length > 0 && (
              <ul className="dc-failures" aria-label="Failures">
                {applied.failures.map((f) => <li key={f.index}><strong>{f.message}</strong><pre>{f.sql}</pre></li>)}
              </ul>
            )}
          </div>
        )}
        {error && <p className="dc-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
