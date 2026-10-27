// MySQL / MariaDB table options in the table designer (TableOptions.extra): ENGINE, default CHARSET and COLLATION,
// ROW_FORMAT and the AUTO_INCREMENT start value. An empty field means "server default" and is not scripted; on an
// existing table the fields show what the server reports and only changed ones are scripted (engine/Designer/MySqlTableOptions.cs).
import type { DesignerOptionsPanelProps } from '../../designer/table/optionsPanels';

const ENGINES = ['InnoDB', 'MyISAM', 'Aria', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE', 'MRG_MyISAM'];
const CHARSETS = ['utf8mb4', 'utf8mb3', 'utf8', 'latin1', 'ascii', 'binary', 'ucs2', 'utf16', 'utf32'];
const ROW_FORMATS = ['DEFAULT', 'DYNAMIC', 'COMPACT', 'REDUNDANT', 'COMPRESSED', 'FIXED', 'PAGE'];

export default function MySqlTableOptions({ table, disabled, onChange }: DesignerOptionsPanelProps) {
  const extra = table.options.extra ?? {};
  const set = (key: string, value: string, clear: string[] = []) => {
    const next = { ...extra };
    for (const k of clear) delete next[k];
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
    onChange(next);
  };
  const rowFormat = extra.rowFormat ? extra.rowFormat.toUpperCase() : '';
  return (
    <div className="dz-engine" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', padding: '6px 12px', borderBottom: '1px solid var(--border)' }} data-testid="my-table-options">
      <label className="dz-field" title="Storage engine (ENGINE). Changing it rebuilds the table.">
        ENGINE
        <input className="input mono" style={{ width: 120 }} list="my-engines" value={extra.engine ?? ''} placeholder="server default" disabled={disabled} onChange={(e) => set('engine', e.target.value)} />
        <datalist id="my-engines">
          {ENGINES.map((en) => (
            <option key={en} value={en} />
          ))}
        </datalist>
      </label>
      <label className="dz-field" title="Default character set of the table (DEFAULT CHARSET). Existing columns keep theirs.">
        CHARSET
        <input
          className="input mono"
          style={{ width: 110 }}
          list="my-charsets"
          value={extra.charset ?? ''}
          placeholder="server default"
          disabled={disabled}
          // a collation belongs to one character set: changing the set drops the old collation (the set's default applies)
          onChange={(e) => set('charset', e.target.value, e.target.value.trim() === (extra.charset ?? '') ? [] : ['collation'])}
        />
        <datalist id="my-charsets">
          {CHARSETS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="dz-field" title="Default collation of the table (COLLATE), e.g. utf8mb4_0900_ai_ci or utf8mb4_unicode_ci">
        COLLATION
        <input className="input mono" style={{ width: 190 }} value={extra.collation ?? ''} placeholder="charset default" disabled={disabled} onChange={(e) => set('collation', e.target.value)} />
      </label>
      <label className="dz-field" title="Row storage format (ROW_FORMAT). Changing it rebuilds the table.">
        ROW_FORMAT
        <select className="input mono" style={{ width: 130 }} value={rowFormat} disabled={disabled} onChange={(e) => set('rowFormat', e.target.value)}>
          <option value="">server default</option>
          {ROW_FORMATS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="dz-field" title="Next AUTO_INCREMENT value. Values below the largest one already stored are ignored by InnoDB.">
        AUTO_INCREMENT
        <input
          className="input mono"
          style={{ width: 110 }}
          type="number"
          min={1}
          value={extra.autoIncrement ?? ''}
          placeholder="1"
          disabled={disabled}
          onChange={(e) => set('autoIncrement', e.target.value === '' ? '' : String(Math.max(1, Math.floor(Number(e.target.value) || 1))))}
        />
      </label>
    </div>
  );
}
