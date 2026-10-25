// Step 5: import mode, error handling and load options.
import { CirclePlus, Eraser, GitMerge, OctagonX, Pencil, ShieldAlert, SkipForward } from 'lucide-react';
import type { Ref } from 'react';
import { Callout, Field, StepHeader } from './parts';
import type { ImportMode } from './types';
import type { Wizard } from './useWizard';

const MODE_INFO: Record<ImportMode, { label: string; text: string; icon: typeof CirclePlus }> = {
  append: { label: 'Append', text: 'Add the rows to the table. Existing rows stay.', icon: CirclePlus },
  truncateInsert: { label: 'Replace all rows', text: 'Delete every existing row, then insert the rows from the file.', icon: Eraser },
  upsert: { label: 'Insert or update by key', text: 'Update the row with the same key, insert the rows that have none.', icon: GitMerge },
  updateOnly: { label: 'Update only', text: 'Update the rows that have the same key; rows without a match are skipped.', icon: Pencil },
};

export function OptionsStep({ w, headingRef }: { w: Wizard; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = w;
  const caps = s.caps;
  return (
    <section className="iw-step" aria-labelledby="iw-mode-title">
      <StepHeader
        ref={headingRef}
        id="iw-mode-title"
        title="Import options"
        help="Choose how the rows are written and what happens when a row cannot be loaded."
      />
      {w.blocker && <Callout tone="error">{w.blocker}</Callout>}
      {s.capsError && <Callout tone="error">{s.capsError}</Callout>}

      <fieldset className="iw-group">
        <legend>Mode</legend>
        {w.create && <p className="iw-hint">A new table starts empty, so the rows are simply added.</p>}
        <div role="radiogroup" aria-label="Import mode" className="iw-modes">
          {w.modes.map((m) => {
            const Icon = MODE_INFO[m].icon;
            return (
              <label key={m} className={`iw-mode${w.mode === m ? ' on' : ''}${m === 'truncateInsert' ? ' danger' : ''}`}>
                <input type="radio" name="iw-mode" checked={w.mode === m} disabled={w.create} onChange={() => w.setMode(m)} />
                <Icon size={18} className="iw-mode-icon" aria-hidden="true" />
                <span className="iw-mode-label">{MODE_INFO[m].label}</span>
                <span className="iw-mode-text">{MODE_INFO[m].text}</span>
              </label>
            );
          })}
        </div>
        {w.truncating && (
          <label className="check iw-check iw-danger">
            <input type="checkbox" checked={s.confirmTruncate} onChange={(e) => patch({ confirmTruncate: e.target.checked })} />
            I understand that all existing rows of {w.tableName} will be deleted first
          </label>
        )}
        {w.keyed && (
          <div className="iw-keys" role="group" aria-label="Key columns">
            <span className="iw-keys-title">Key columns (identify a row)</span>
            {(w.s.tableInfo?.columns ?? []).filter((c) => w.mappedNames.includes(c.name)).map((c) => (
              <label key={c.name} className={`iw-keychip${s.keyColumns.includes(c.name) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={s.keyColumns.includes(c.name)}
                  onChange={(e) => patch({ keyColumns: e.target.checked ? [...s.keyColumns, c.name] : s.keyColumns.filter((k) => k !== c.name) })}
                />
                <span dir="auto">{c.name}</span>{c.isPk && <span className="iw-tag">PK</span>}
              </label>
            ))}
            {w.keyErrors.map((m, i) => <Callout key={i} tone="error">{m}</Callout>)}
            {s.keyColumns.length > 0 && !w.keyIsUnique && (
              <Callout tone="warn">
                These columns are not a primary or unique key of the table: several rows may match one key (and an upsert may fail or add duplicates).
              </Callout>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="iw-group">
        <legend>If a row cannot be loaded</legend>
        <div role="radiogroup" aria-label="Error handling" className="iw-modes">
          <label className={`iw-mode${s.onError === 'stop' ? ' on' : ''}`}>
            <input type="radio" name="iw-err" checked={s.onError === 'stop'} onChange={() => patch({ onError: 'stop' })} />
            <OctagonX size={18} className="iw-mode-icon" aria-hidden="true" />
            <span className="iw-mode-label">Stop the import</span>
            <span className="iw-mode-text">The first bad row ends the import.</span>
          </label>
          <label className={`iw-mode${s.onError === 'skip' ? ' on' : ''}`}>
            <input type="radio" name="iw-err" checked={s.onError === 'skip'} onChange={() => patch({ onError: 'skip' })} />
            <SkipForward size={18} className="iw-mode-icon" aria-hidden="true" />
            <span className="iw-mode-label">Skip bad rows and log them</span>
            <span className="iw-mode-text">A report lists every skipped row and why.</span>
          </label>
        </div>
        {s.onError === 'skip' && (
          <Field label="Give up after this many errors (0 = never)">
            <input className="input iw-narrow" type="number" min={0} aria-label="Maximum errors" value={s.maxErrors} onChange={(e) => patch({ maxErrors: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
        )}
      </fieldset>

      <fieldset className="iw-group">
        <legend>Load options</legend>
        <div className="iw-opts">
          <Field label="Rows per batch">
            <input className="input iw-narrow" type="number" min={1} aria-label="Batch size" value={w.batchSize} onChange={(e) => patch({ batchSize: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Only the first N rows (0 = all)">
            <input className="input iw-narrow" type="number" min={0} aria-label="Row limit" value={s.limit} onChange={(e) => patch({ limit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
        </div>
        <label className="check iw-check">
          <input type="checkbox" aria-label="All or nothing" checked={w.transaction} disabled={!w.transactional} onChange={(e) => patch({ transaction: e.target.checked })} />
          <ShieldAlert size={13} aria-hidden="true" /> All or nothing (one transaction)
          {!w.transactional && <span className="iw-note"> not available for this database</span>}
        </label>
        <label className="check iw-check">
          <input type="checkbox" aria-label="Use the bulk loader" checked={s.useBulk} onChange={(e) => patch({ useBulk: e.target.checked })} />
          Use the fast load path{caps ? ` (${caps.bulkMethod})` : ''}
        </label>
      </fieldset>
    </section>
  );
}
