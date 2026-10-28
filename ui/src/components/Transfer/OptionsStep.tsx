// Step 4: what to create and how to write the rows.
import { CirclePlus, Eraser, GitMerge, Layers } from 'lucide-react';
import type { Ref } from 'react';
import type { CreateMode, DataMode, NameCase, TransferOptions } from '../../api/types.transfer';
import { Callout, Field, StepHeader } from '../ImportWizard/parts';
import type { Transfer } from './useTransfer';

const CREATE: { value: CreateMode; label: string; text: string }[] = [
  { value: 'failIfExists', label: 'Create, stop if it exists', text: 'Create every table; a table that already exists in the target is an error.' },
  { value: 'skipExisting', label: 'Create, keep existing', text: 'Create the missing tables; existing ones keep their structure and receive the rows.' },
  { value: 'dropExisting', label: 'Drop and re-create', text: 'Existing tables are dropped first (their rows are lost), then created again.' },
  { value: 'none', label: 'Do not create', text: 'Copy the rows into tables that already exist.' },
];

const DATA: { value: DataMode; label: string; text: string; icon: typeof CirclePlus }[] = [
  { value: 'append', label: 'Append', text: 'Insert the rows; rows already in the target stay.', icon: CirclePlus },
  { value: 'truncate', label: 'Replace', text: 'Empty existing target tables first, then insert.', icon: Eraser },
  { value: 'upsert', label: 'Insert or update', text: 'Rows with the same primary key are updated, the others inserted.', icon: GitMerge },
  { value: 'none', label: 'Structure only', text: 'Create the tables without copying any rows.', icon: Layers },
];

const FLAGS: { key: keyof TransferOptions; label: string }[] = [
  { key: 'primaryKeys', label: 'Primary keys' }, { key: 'foreignKeys', label: 'Foreign keys' }, { key: 'uniques', label: 'Unique constraints' },
  { key: 'indexes', label: 'Indexes' }, { key: 'defaults', label: 'Defaults and checks' }, { key: 'comments', label: 'Comments' },
  { key: 'identity', label: 'Identity / auto-increment values' }, { key: 'createSchema', label: 'Create the target schema when missing' },
];

const CASES: { value: NameCase; label: string }[] = [
  { value: 'auto', label: 'As the target prefers (lower case on PostgreSQL, upper case on Oracle)' },
  { value: 'keep', label: 'Keep the source names' }, { value: 'lower', label: 'lower case' }, { value: 'upper', label: 'UPPER CASE' },
];

export function OptionsStep({ t, headingRef }: { t: Transfer; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = t;
  const o = s.options;
  const set = (change: Partial<TransferOptions>) => patch({ options: { ...o, ...change } });
  const file = s.targetKind === 'file';
  return (
    <section className="iw-step" aria-labelledby="tr-opt-title">
      <StepHeader ref={headingRef} id="tr-opt-title" title="Transfer options" help="Choose what is created in the target and how the rows are written." />
      {t.optIssues.map((m, i) => <Callout key={i} tone="error">{m}</Callout>)}

      <fieldset className="iw-group">
        <legend>Tables</legend>
        <div role="radiogroup" aria-label="Create mode" className="iw-modes">
          {CREATE.filter((c) => !file || c.value !== 'skipExisting').map((c) => (
            <label key={c.value} className={`iw-mode${o.createMode === c.value ? ' on' : ''}${c.value === 'dropExisting' ? ' danger' : ''}`}>
              <input type="radio" name="tr-create" checked={o.createMode === c.value} onChange={() => set({ createMode: c.value })} />
              <span className="iw-mode-label">{c.label}</span>
              <span className="iw-mode-text">{file && c.value === 'dropExisting' ? 'The script drops each table (if it exists) before creating it.' : c.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="iw-group">
        <legend>Rows</legend>
        <div role="radiogroup" aria-label="Data mode" className="iw-modes">
          {DATA.map((d) => {
            const Icon = d.icon;
            return (
              <label key={d.value} className={`iw-mode${o.dataMode === d.value ? ' on' : ''}${d.value === 'truncate' ? ' danger' : ''}`}>
                <input type="radio" name="tr-data" checked={o.dataMode === d.value} onChange={() => set({ dataMode: d.value })} />
                <Icon size={18} className="iw-mode-icon" aria-hidden="true" />
                <span className="iw-mode-label">{d.label}</span>
                <span className="iw-mode-text">{d.text}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="iw-group">
        <legend>Carry over</legend>
        <div className="tr-flags">
          {FLAGS.map((f) => (
            <label key={f.key} className="iw-check">
              <input type="checkbox" checked={o[f.key] as boolean} onChange={(e) => set({ [f.key]: e.target.checked } as Partial<TransferOptions>)} />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="iw-group">
        <legend>Writing</legend>
        <div className="iw-where">
          <Field label="Names">
            <select className="input" aria-label="Name case" value={o.nameCase} onChange={(e) => set({ nameCase: e.target.value as NameCase })}>
              {CASES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Rows per batch" hint="Rows per INSERT; large values use more memory.">
            <input
              className="input" type="number" min={1} max={100000} aria-label="Rows per batch" value={Number.isFinite(o.batchSize) ? o.batchSize : ''}
              onChange={(e) => set({ batchSize: e.target.value === '' ? Number.NaN : Math.trunc(Number(e.target.value)) })}
            />
          </Field>
        </div>
        <label className="iw-check">
          <input type="checkbox" checked={o.continueOnError} onChange={(e) => set({ continueOnError: e.target.checked })} />
          Continue on error (skip tables and rows the target refuses, and list them)
        </label>
      </fieldset>
    </section>
  );
}
