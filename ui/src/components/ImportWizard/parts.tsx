// Small building blocks shared by the wizard steps: a labelled field, the step header, a callout, a file-type icon and
// the connection picker.
import { CircleAlert, FileJson, FileSpreadsheet, FileText, Info, TriangleAlert } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { formatOfPath } from './files';
import type { Wizard } from './useWizard';

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`iw-field${className ? ` ${className}` : ''}`}>
      <span className="iw-field-label">{label}</span>
      {children}
      {hint ? <small className="iw-note">{hint}</small> : null}
    </label>
  );
}

/** Title + one-line help of a step. The heading takes the focus when the step changes (see ImportWizardView). */
export const StepHeader = forwardRef<HTMLHeadingElement, { id: string; title: ReactNode; help: ReactNode; aside?: ReactNode }>(
  function StepHeader({ id, title, help, aside }, ref) {
    return (
      <header className="iw-step-head">
        <div className="iw-step-titles">
          <h2 id={id} className="iw-h" tabIndex={-1} ref={ref}>{title}</h2>
          <p className="iw-help">{help}</p>
        </div>
        {aside ? <div className="iw-step-aside">{aside}</div> : null}
      </header>
    );
  },
);

type Tone = 'error' | 'warn' | 'info';

export function Callout({ tone, children, alert }: { tone: Tone; children: ReactNode; alert?: boolean }) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`iw-msg iw-${tone === 'warn' ? 'warn' : tone === 'info' ? 'info' : 'error'}`} role={alert ?? tone === 'error' ? 'alert' : 'status'}>
      <Icon size={14} aria-hidden="true" className="iw-msg-icon" />
      <span>{children}</span>
    </div>
  );
}

/** The icon of a data file by its extension. */
export function FileTypeIcon({ path, size = 20 }: { path: string; size?: number }) {
  const f = formatOfPath(path);
  const Icon = f === 'xlsx' ? FileSpreadsheet : f === 'json' || f === 'ndjson' ? FileJson : FileText;
  return <Icon size={size} aria-hidden="true" />;
}

/** Connection select (writable relational connections only). */
export function ConnectionPicker({ w, label = 'Connection' }: { w: Wizard; label?: string }) {
  return (
    <Field label={label}>
      <select className="input" aria-label={label} value={w.cid} onChange={(e) => w.setConnection(e.target.value)}>
        {!w.cid && <option value="">Choose a connection…</option>}
        {w.cid && !w.connections.some((c) => c.id === w.cid) && <option value={w.cid}>{w.conn?.name ?? w.cid}</option>}
        {w.connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </Field>
  );
}
