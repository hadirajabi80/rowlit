// Step 4: import mode, error handling and load options, with a plain-language summary of what is about to happen.
import { AlertTriangle } from 'lucide-react';
import { formatCount } from './model';
import type { ImportMode } from './types';
import type { Wizard } from './useWizard';

const MODE_INFO: Record<ImportMode, { label: string; text: string }> = {
  append: { label: 'Append', text: 'Add the rows to the table. Existing rows stay.' },
  truncateInsert: { label: 'Replace all rows', text: 'Delete every existing row, then insert the rows from the file.' },
  upsert: { label: 'Insert or update by key', text: 'Update the row with the same key, insert the rows that have none.' },
  updateOnly: { label: 'Update only', text: 'Update the rows that have the same key; rows without a match are skipped.' },
};

function describePlan(w: Wizard): string[] {
  const { s } = w;
  const lines: string[] = [];
  const table = `${s.schema ? `${s.schema}.` : ''}${w.tableName}`;
  const cols = w.request?.columns.length ?? 0;
  const file = s.path.split(/[\\/]/).pop() ?? s.path;
  if (w.create) lines.push(`Create the table ${table} with ${cols} ${cols === 1 ? 'column' : 'columns'} and load the rows of ${file}.`);
  else {
    const verb = { append: 'Append the rows of', truncateInsert: 'Replace the contents of', upsert: 'Insert or update', updateOnly: 'Update' }[w.mode];
    lines.push(
      w.mode === 'truncateInsert' ? `${verb} ${table} with the rows of ${file} (${cols} columns).`
        : w.mode === 'append' ? `${verb} ${file} to ${table} (${cols} columns).`
          : `${verb} rows of ${table} from ${file} by ${w.s.keyColumns.join(', ') || '(no key)'}.`,
    );
  }
  lines.push(s.onError === 'stop' ? 'The import stops at the first row that cannot be loaded.' : `Rows that cannot be loaded are skipped and listed in an error report${s.maxErrors > 0 ? ` (stops after ${formatCount(s.maxErrors)} errors)` : ''}.`);
  lines.push(
    w.transaction ? 'Everything runs in one transaction: if the import fails or is cancelled, nothing is changed.'
      : w.transactional ? `Every batch of ${formatCount(w.batchSize)} rows is committed on its own; a failed import keeps the rows loaded so far.`
        : 'This database loads rows without a transaction: a failed import keeps the rows loaded so far.',
  );
  if (s.limit > 0) lines.push(`Test run: only the first ${formatCount(s.limit)} rows are loaded.`);
  return lines;
}

export function ModeStep({ w }: { w: Wizard }) {
  const { s, patch } = w;
  const caps = s.caps;
  return (
    <section className="iw-step" aria-labelledby="iw-mode-title">
      <h2 id="iw-mode-title" className="iw-h">Import mode and options</h2>
      {w.blocker && <div className="iw-msg iw-error" role="alert"><AlertTriangle size={14} /> {w.blocker}</div>}
      {s.capsError && <div className="iw-msg iw-error" role="alert">{s.capsError}</div>}

      <fieldset className="iw-group">
        <legend>Mode</legend>
        {w.create && <p className="iw-hint">A new table starts empty, so the rows are simply added.</p>}
        <div role="radiogroup" aria-label="Import mode" className="iw-modes">
          {w.modes.map((m) => (
            <label key={m} className={`iw-mode${w.mode === m ? ' on' : ''}`}>
              <input type="radio" name="iw-mode" checked={w.mode === m} disabled={w.create} onChange={() => w.setMode(m)} />
              <span className="iw-mode-label">{MODE_INFO[m].label}</span>
              <span className="iw-mode-text">{MODE_INFO[m].text}</span>
            </label>
          ))}
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
              <label key={c.name} className="check iw-check">
                <input
                  type="checkbox"
                  checked={s.keyColumns.includes(c.name)}
                  onChange={(e) => patch({ keyColumns: e.target.checked ? [...s.keyColumns, c.name] : s.keyColumns.filter((k) => k !== c.name) })}
                />
                <span dir="auto">{c.name}</span>{c.isPk && <span className="iw-tag">PK</span>}
              </label>
            ))}
            {w.keyErrors.map((m, i) => <div key={i} className="iw-msg iw-error" role="alert">{m}</div>)}
            {s.keyColumns.length > 0 && !w.keyIsUnique && (
              <div className="iw-msg iw-warn" role="status">
                <AlertTriangle size={14} /> These columns are not a primary or unique key of the table: several rows may match one key (and an upsert may fail or add duplicates).
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="iw-group">
        <legend>If a row cannot be loaded</legend>
        <div role="radiogroup" aria-label="Error handling" className="iw-modes">
          <label className={`iw-mode${s.onError === 'stop' ? ' on' : ''}`}>
            <input type="radio" name="iw-err" checked={s.onError === 'stop'} onChange={() => patch({ onError: 'stop' })} />
            <span className="iw-mode-label">Stop the import</span>
            <span className="iw-mode-text">The first bad row ends the import.</span>
          </label>
          <label className={`iw-mode${s.onError === 'skip' ? ' on' : ''}`}>
            <input type="radio" name="iw-err" checked={s.onError === 'skip'} onChange={() => patch({ onError: 'skip' })} />
            <span className="iw-mode-label">Skip bad rows and log them</span>
            <span className="iw-mode-text">A report lists every skipped row and why.</span>
          </label>
        </div>
        {s.onError === 'skip' && (
          <label className="iw-field">
            <span>Give up after this many errors (0 = never)</span>
            <input className="input iw-narrow" type="number" min={0} aria-label="Maximum errors" value={s.maxErrors} onChange={(e) => patch({ maxErrors: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </label>
        )}
      </fieldset>

      <fieldset className="iw-group">
        <legend>Load options</legend>
        <div className="iw-opts">
          <label className="iw-field">
            <span>Rows per batch</span>
            <input className="input iw-narrow" type="number" min={1} aria-label="Batch size" value={w.batchSize} onChange={(e) => patch({ batchSize: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </label>
          <label className="iw-field">
            <span>Only the first N rows (0 = all)</span>
            <input className="input iw-narrow" type="number" min={0} aria-label="Row limit" value={s.limit} onChange={(e) => patch({ limit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </label>
        </div>
        <label className="check iw-check">
          <input type="checkbox" aria-label="All or nothing" checked={w.transaction} disabled={!w.transactional} onChange={(e) => patch({ transaction: e.target.checked })} />
          All or nothing (one transaction)
          {!w.transactional && <span className="iw-note"> not available for this database</span>}
        </label>
        <label className="check iw-check">
          <input type="checkbox" aria-label="Use the bulk loader" checked={s.useBulk} onChange={(e) => patch({ useBulk: e.target.checked })} />
          Use the fast load path{caps ? ` (${caps.bulkMethod})` : ''}
        </label>
      </fieldset>

      <div className="iw-summary" role="note" aria-label="What will happen">
        <strong>What will happen</strong>
        <ul>{describePlan(w).map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>
    </section>
  );
}
