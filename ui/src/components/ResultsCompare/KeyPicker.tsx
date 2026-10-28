// Key columns of a comparison: a popover with a checkbox per column both results have. Rows with equal key values are
// the same row; without a key whole rows are compared.
import { Check, ChevronDown, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export interface KeyPickerProps {
  /** Columns both results have, in display order. */
  columns: string[];
  keys: string[];
  /** The primary-key columns both results report (null: none). */
  primaryKey: string[] | null;
  onChange(keys: string[]): void;
}

export function KeyPicker({ columns, keys, primaryKey, onChange }: KeyPickerProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const lower = new Set(keys.map((k) => k.toLowerCase()));
  const toggle = (name: string) => {
    const on = lower.has(name.toLowerCase());
    onChange(on ? keys.filter((k) => k.toLowerCase() !== name.toLowerCase()) : columns.filter((c) => lower.has(c.toLowerCase()) || c === name));
  };
  const label = keys.length ? keys.join(', ') : 'whole row';

  return (
    <div className="rc-keys" ref={host}>
      <button
        className="btn btn-xs" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        title="Columns that identify a row. Rows with equal key values are compared with each other." onClick={() => setOpen((o) => !o)}
      >
        <KeyRound size={12} /> Key: <span className="rc-keys-label">{label}</span> <ChevronDown size={11} />
      </button>
      {open && (
        <div className="rc-pop" id={id} role="dialog" aria-label="Key columns">
          <div className="rc-pop-note">Rows with equal values in the key columns are the same row. Without a key whole rows are compared, so a changed row shows as removed and added.</div>
          <div className="rc-pop-list">
            {columns.map((c) => (
              <label key={c} className="rc-pop-row">
                <input type="checkbox" checked={lower.has(c.toLowerCase())} onChange={() => toggle(c)} /> <span>{c}</span>
              </label>
            ))}
            {columns.length === 0 && <div className="rc-pop-note">The results share no column.</div>}
          </div>
          <div className="rc-pop-actions">
            <button className="btn btn-xs" disabled={!primaryKey?.length} onClick={() => onChange(primaryKey ?? [])} title={primaryKey?.length ? undefined : 'The results report no primary key'}>
              <Check size={11} /> Primary key
            </button>
            <button className="btn btn-xs" disabled={keys.length === 0} onClick={() => onChange([])}>
              Whole row
            </button>
            <button className="btn btn-xs" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
