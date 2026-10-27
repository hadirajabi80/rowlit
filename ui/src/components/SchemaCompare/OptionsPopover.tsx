// Options of a comparison (what is compared, what is ignored) in a popover under the Options button. Esc or a click
// outside closes it.
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CompareOptions } from '../../api/types.schemaCompare';
import { changedOptions, DEFAULT_OPTIONS, OPTION_GROUPS } from './model';

export function OptionsPopover({ options, onChange, disabled }: { options: CompareOptions; onChange: (o: CompareOptions) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const changed = Object.keys(changedOptions(options)).length;

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
    <div className="sc-options" ref={root}>
      <button type="button" className={`btn${changed ? ' on' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <SlidersHorizontal size={14} aria-hidden="true" /> Options{changed ? ` (${changed})` : ''}
      </button>
      {open && (
        <div className="sc-options-pop" role="dialog" aria-label="Compare options">
          {OPTION_GROUPS.map((g) => (
            <fieldset key={g.title} className="sc-options-group">
              <legend>{g.title}</legend>
              {g.options.map((o) => (
                <label key={o.key} className="sc-check">
                  <input
                    type="checkbox"
                    checked={options[o.key]}
                    disabled={!!o.needs && !options[o.needs]}
                    onChange={(e) => onChange({ ...options, [o.key]: e.target.checked })}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="sc-options-foot">
            <button type="button" className="btn btn-xs" onClick={() => onChange({ ...DEFAULT_OPTIONS })} disabled={!changed}>Reset to defaults</button>
          </div>
        </div>
      )}
    </div>
  );
}
