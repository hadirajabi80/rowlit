// One column of the Generate data table: its generator (inferred, editable), the generator's options, the share of NULLs and
// the unique flag. Pure presentation: every change goes up as a new GenerateColumn.
import { Link2 } from 'lucide-react';
import { memo } from 'react';
import type { GenerateColumn, GeneratorInfo, GeneratorOption } from '../../api/types.generate';
import { GEN_FOREIGN_KEY, GEN_SKIP, generatorsFor, groupGenerators, pickerSpecials, roleBadges, withGenerator, withNullPercent, withOption } from './model';

interface Props {
  column: GenerateColumn;
  infos: GeneratorInfo[];
  issues: string[];
  disabled: boolean;
  onChange: (next: GenerateColumn) => void;
}

function OptionInput({ column, option, disabled, onChange }: { column: GenerateColumn; option: GeneratorOption; disabled: boolean; onChange: (v: string) => void }) {
  const value = column.options[option.key] ?? '';
  const label = `${column.name} ${option.label}`;
  const title = option.help ?? undefined;
  if (option.type === 'multiline') {
    return (
      <label className="gd-opt gd-opt-wide" title={title}>
        <span>{option.label}</span>
        <textarea className="input xs gd-textarea" aria-label={label} rows={3} value={value} spellCheck={false} dir="auto" disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  return (
    <label className={`gd-opt${option.key === 'pattern' || option.key === 'format' ? ' gd-opt-wide' : ''}`} title={title}>
      <span>{option.label}</span>
      <input
        className="input xs"
        aria-label={label}
        value={value}
        spellCheck={false}
        dir="auto"
        disabled={disabled}
        inputMode={option.type === 'number' ? 'decimal' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ColumnRowImpl({ column: c, infos, issues, disabled, onChange }: Props) {
  const skipped = c.generator === GEN_SKIP;
  const fk = c.generator === GEN_FOREIGN_KEY;
  const info = infos.find((g) => g.id === c.generator);
  const groups = groupGenerators(generatorsFor(c.kind, infos));
  const badges = roleBadges(c);
  return (
    <tr className={`gd-row${skipped ? ' gd-skipped' : ''}${issues.length ? ' gd-invalid' : ''}`} data-column={c.name}>
      <th scope="row" className="gd-name">
        <span dir="auto" className="gd-colname">{c.name}</span>
        {badges.map((b) => <span key={b} className="gd-badge">{b}</span>)}
      </th>
      <td className="gd-type" dir="auto">{c.type}{c.nullable ? '' : ' · not null'}</td>
      <td className="gd-gen">
        <select
          className="input xs"
          aria-label={`${c.name} generator`}
          value={c.generator}
          disabled={disabled || c.isComputed}
          onChange={(e) => onChange(withGenerator(c, e.target.value, infos))}
        >
          {pickerSpecials(c).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          {groups.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </optgroup>
          ))}
          {!skipped && !fk && !info && <option value={c.generator}>{c.generator}</option>}
        </select>
        {fk && <span className="gd-note"><Link2 size={11} aria-hidden="true" /> values of the parent table</span>}
        {!fk && !skipped && c.note && <span className="gd-note">{c.note}</span>}
        {skipped && c.note && <span className="gd-note">{c.note}</span>}
      </td>
      <td className="gd-options">
        {!skipped && !fk && info && info.options.length > 0 && (
          <div className="gd-opts">
            {info.options.map((o) => (
              <OptionInput key={o.key} column={c} option={o} disabled={disabled} onChange={(v) => onChange(withOption(c, o.key, v))} />
            ))}
          </div>
        )}
        {issues.map((m, i) => <div key={i} className="gd-issue" role="alert">{m}</div>)}
      </td>
      <td className="gd-null">
        <input
          className="input xs gd-num"
          aria-label={`${c.name} null percent`}
          inputMode="decimal"
          value={c.nullPercent === 0 ? '0' : String(c.nullPercent)}
          disabled={disabled || skipped || !c.nullable}
          title={c.nullable ? 'Share of rows that get NULL' : 'The column does not allow NULL'}
          onChange={(e) => onChange(withNullPercent(c, e.target.value))}
        />
      </td>
      <td className="gd-unique">
        <input
          type="checkbox"
          aria-label={`${c.name} unique`}
          checked={c.unique && !skipped}
          disabled={disabled || skipped}
          title="Every generated value is different"
          onChange={(e) => onChange({ ...c, unique: e.target.checked })}
        />
      </td>
    </tr>
  );
}

export const ColumnRow = memo(ColumnRowImpl);
