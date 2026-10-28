// Popovers of the Data compare top bar: "Columns" (key columns and the columns whose values are compared, from the
// engine's column preview) and "Options" (text / number / time comparison rules, limit, ordering). Esc or a click
// outside closes them.
import { Columns3, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataCompareOptions, DataComparePreview, DataOrdering } from '../../api/types.dataCompare';
import { changedOptionCount, DEFAULT_OPTIONS, effectiveKey, MAX_DIFFERENCES } from './model';

function Popover({ label, icon, badge, title, disabled, children }: { label: string; icon: ReactNode; badge?: string; title: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div className="dc-pop-root" ref={root}>
      <button type="button" className={`btn${badge ? ' on' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        {icon} {label}{badge ? ` (${badge})` : ''}
      </button>
      {open && <div className="dc-pop" role="dialog" aria-label={title}>{children}</div>}
    </div>
  );
}


export function ColumnsPopover({ preview, options, onChange, disabled }: {
  preview: DataComparePreview | null; options: DataCompareOptions; onChange: (o: DataCompareOptions) => void; disabled?: boolean;
}) {
  const paired = (preview?.columns ?? []).filter((c) => c.sourceName && c.targetName);
  const key = effectiveKey(options, preview);
  const ignored = new Set((options.ignoreColumns ?? []).map((n) => n.toLowerCase()));
  const isKey = (n: string) => key.some((k) => k.toLowerCase() === n.toLowerCase());
  const toggleKey = (n: string) => {
    const next = isKey(n) ? key.filter((k) => k.toLowerCase() !== n.toLowerCase()) : [...key, n];
    onChange({ ...options, keyColumns: next.length ? next : null });
  };
  const toggleCompare = (n: string) => {
    const list = options.ignoreColumns ?? [];
    const next = ignored.has(n.toLowerCase()) ? list.filter((x) => x.toLowerCase() !== n.toLowerCase()) : [...list, n];
    onChange({ ...options, ignoreColumns: next.length ? next : null });
  };
  const customised = !!options.keyColumns?.length || !!options.ignoreColumns?.length;
  return (
    <Popover label="Columns" icon={<Columns3 size={14} aria-hidden="true" />} title="Key and compared columns" disabled={disabled || !preview}
      badge={key.length ? `key: ${key.join(', ')}` : 'no key'}>
      {paired.length === 0 ? <p className="muted">Pick both tables to see their columns.</p> : (
        <table className="dc-cols">
          <thead>
            <tr><th scope="col">Column</th><th scope="col">Key</th><th scope="col">Compare</th><th scope="col">Types (source / target)</th></tr>
          </thead>
          <tbody>
            {paired.map((c) => (
              <tr key={c.name}>
                <td>{c.name}{c.note && <span className="muted"> · {c.note}</span>}</td>
                <td><input type="checkbox" aria-label={`Key ${c.name}`} checked={isKey(c.name)} onChange={() => toggleKey(c.name)} disabled={c.kind === 'json'} /></td>
                <td>
                  <input type="checkbox" aria-label={`Compare ${c.name}`} checked={!isKey(c.name) && c.comparable && !ignored.has(c.name.toLowerCase())}
                    disabled={isKey(c.name) || !c.comparable} onChange={() => toggleCompare(c.name)} />
                </td>
                <td className="muted">{c.sourceType} / {c.targetType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview && preview.columns.some((c) => !c.sourceName || !c.targetName) && (
        <p className="muted">Not on both sides: {preview.columns.filter((c) => !c.sourceName || !c.targetName).map((c) => c.name).join(', ')}</p>
      )}
      <div className="dc-pop-foot">
        <button type="button" className="btn btn-xs" disabled={!customised} onClick={() => onChange({ ...options, keyColumns: null, ignoreColumns: null, columns: null })}>
          Use the primary key and every column
        </button>
      </div>
    </Popover>
  );
}

export function OptionsPopover({ options, onChange, disabled }: { options: DataCompareOptions; onChange: (o: DataCompareOptions) => void; disabled?: boolean }) {
  const changed = changedOptionCount(options);
  const num = (v: string, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return (
    <Popover label="Options" icon={<SlidersHorizontal size={14} aria-hidden="true" />} title="Compare options" disabled={disabled} badge={changed ? String(changed) : undefined}>
      <fieldset className="dc-opt-group">
        <legend>Text</legend>
        <label className="dc-check"><input type="checkbox" checked={options.trimText} onChange={(e) => onChange({ ...options, trimText: e.target.checked })} /> Ignore leading and trailing spaces</label>
        <label className="dc-check"><input type="checkbox" checked={options.ignoreCase} onChange={(e) => onChange({ ...options, ignoreCase: e.target.checked })} /> Ignore case</label>
        <label className="dc-check"><input type="checkbox" checked={options.emptyAsNull} onChange={(e) => onChange({ ...options, emptyAsNull: e.target.checked })} /> Empty text equals NULL</label>
      </fieldset>
      <fieldset className="dc-opt-group">
        <legend>Numbers and dates</legend>
        <label className="dc-field">Number tolerance
          <input className="input" type="number" min={0} step="any" aria-label="Number tolerance" value={options.numericTolerance}
            onChange={(e) => onChange({ ...options, numericTolerance: num(e.target.value, 0) })} />
        </label>
        <label className="dc-field">Time tolerance (ms)
          <input className="input" type="number" min={0} step={1} aria-label="Time tolerance in milliseconds" value={options.timeToleranceMs}
            onChange={(e) => onChange({ ...options, timeToleranceMs: Math.round(num(e.target.value, 0)) })} />
        </label>
      </fieldset>
      <fieldset className="dc-opt-group">
        <legend>Run</legend>
        <label className="dc-field">Keep at most
          <input className="input" type="number" min={1} max={MAX_DIFFERENCES} step={1000} aria-label="Differences to keep" value={options.maxDifferences}
            onChange={(e) => onChange({ ...options, maxDifferences: Math.min(MAX_DIFFERENCES, Math.max(1, Math.round(num(e.target.value, DEFAULT_OPTIONS.maxDifferences)))) })} />
          differences
        </label>
        <label className="dc-field">Row order
          <select className="input" aria-label="Row order" value={options.ordering ?? 'auto'}
            onChange={(e) => onChange({ ...options, ordering: e.target.value === 'auto' ? null : e.target.value as DataOrdering })}>
            <option value="auto">Automatic</option>
            <option value="server">Servers sort (fastest, streams)</option>
            <option value="engine">Engine sorts (any collation, in memory)</option>
          </select>
        </label>
      </fieldset>
      <div className="dc-pop-foot">
        <button type="button" className="btn btn-xs" disabled={!changed}
          onClick={() => onChange({ ...DEFAULT_OPTIONS, keyColumns: options.keyColumns, columns: options.columns, ignoreColumns: options.ignoreColumns })}>
          Reset to defaults
        </button>
      </div>
    </Popover>
  );
}
