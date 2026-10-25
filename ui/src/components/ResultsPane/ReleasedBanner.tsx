import { LoaderCircle, MemoryStick, RotateCcw } from 'lucide-react';
import { rerun } from '../../app/actions';
import { reloadReleased } from '../../app/resources';
import { formatCount } from '../../lib/format';
import { isRunning, type ExecutionState, type ResultSetState } from '../../store/resultsReducer';

/**
 * Resources (docs/resources.md): the rows of this result beyond the first page were released to save memory.
 * Reload fetches them back from the engine's copy (no query runs); when that copy is gone only Re-run helps.
 */
export function ReleasedBanner({ exec, rs }: { exec: ExecutionState; rs: ResultSetState }) {
  const r = rs.released;
  if (!r) return null;
  const busy = isRunning(exec) || !!r.reloading;
  return (
    <div className="rs-rolledback rs-released" role="status">
      <MemoryStick size={13} aria-hidden="true" />
      <span className="rs-rolledback-text">
        {r.unavailable
          ? `Results released to save memory — the engine no longer has them. Showing the first ${formatCount(rs.rows.length)} of ${formatCount(r.total)} rows.`
          : `Results released to save memory — showing the first ${formatCount(rs.rows.length)} of ${formatCount(r.total)} rows.`}
      </span>
      {!r.unavailable && (
        <button className="link-btn" onClick={() => void reloadReleased(exec.localId)} disabled={busy} title="Fetch the released rows back (the query does not run again)">
          {r.reloading ? <LoaderCircle size={11} className="spin" /> : <RotateCcw size={11} />} Reload
        </button>
      )}
      <button className="link-btn" onClick={() => void rerun(exec.tabId)} disabled={busy} title="Run the query again">
        <RotateCcw size={11} /> Re-run
      </button>
    </div>
  );
}
