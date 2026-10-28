// The migration script of the selected items: warnings first (data loss in red), then the text as it would run in a
// console, with Copy, Open in console and Apply to target….
import { OctagonAlert, TriangleAlert, ClipboardCopy, Info, Play, SquareTerminal } from 'lucide-react';
import type { CompareScript, CompareSeverity, ItemWarning, ScriptStatement } from '../../api/types.schemaCompare';
import { nameOfId } from './model';

const SEVERITY_ORDER: Record<CompareSeverity, number> = { dataLoss: 0, warning: 1, info: 2 };

export function WarningList({ warnings }: { warnings: readonly ItemWarning[] }) {
  if (!warnings.length) return null;
  const sorted = [...warnings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="sc-warnings" aria-label="Warnings">
      {sorted.map((w, i) => (
        <li key={`${w.itemId}:${i}`} className={`sc-warning sc-sev-${w.severity}`}>
          {w.severity === 'dataLoss' ? <OctagonAlert size={14} aria-hidden="true" /> : w.severity === 'warning' ? <TriangleAlert size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}
          <span className="sc-warning-sev">{w.severity === 'dataLoss' ? 'Data loss' : w.severity === 'warning' ? 'Warning' : 'Note'}</span>
          <span className="sc-warning-obj">{nameOfId(w.itemId)}</span>
          <span className="sc-warning-msg">{w.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The statements of one item (the per-item "Script" tab). */
export function StatementList({ statements }: { statements: readonly ScriptStatement[] }) {
  if (!statements.length) return <p className="muted sc-pad">Nothing to run: the object is identical.</p>;
  return (
    <div className="sc-statements">
      {statements.map((s, i) => (
        <div key={i} className="sc-statement">
          {s.warning && <p className="sc-statement-warning"><TriangleAlert size={13} aria-hidden="true" /> {s.warning}</p>}
          <pre className="sc-code">{s.sql}</pre>
        </div>
      ))}
    </div>
  );
}

export interface ScriptViewProps {
  script: CompareScript;
  targetLabel: string;
  canApply: boolean;
  applyBlockedReason: string | null;
  onCopy: () => void;
  onOpenInConsole: () => void;
  onApply: () => void;
}

export function ScriptView({ script, targetLabel, canApply, applyBlockedReason, onCopy, onOpenInConsole, onApply }: ScriptViewProps) {
  const n = script.statements.length;
  return (
    <div className="sc-script">
      <div className="sc-script-bar">
        <span className="sc-script-summary">
          {script.itemCount} {script.itemCount === 1 ? 'object' : 'objects'}, {n} {n === 1 ? 'statement' : 'statements'} for {targetLabel}
          {' · '}
          {script.transactionalDdl ? 'DDL is transactional here: a failure rolls everything back.' : 'DDL is not transactional here: a failure leaves earlier statements applied.'}
        </span>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={onCopy} disabled={!n}>
          <ClipboardCopy size={14} aria-hidden="true" /> Copy
        </button>
        <button type="button" className="btn" onClick={onOpenInConsole} disabled={!n}>
          <SquareTerminal size={14} aria-hidden="true" /> Open in console
        </button>
        <button type="button" className="btn btn-primary" onClick={onApply} disabled={!n || !canApply} title={applyBlockedReason ?? undefined}>
          <Play size={14} aria-hidden="true" /> Apply to target…
        </button>
      </div>
      {applyBlockedReason && <p className="muted sc-pad">{applyBlockedReason}</p>}
      <WarningList warnings={script.warnings} />
      {n === 0 ? <p className="muted sc-pad">Nothing to run for the selected objects.</p> : <pre className="sc-code sc-script-text" aria-label="Migration script">{script.text}</pre>}
    </div>
  );
}
