// Step 3: where the rows go - a new or an existing table, in a connection > database > schema.
import { ChevronRight, CircleCheck, FilePlus2, LoaderCircle, Table2 } from 'lucide-react';
import type { Ref } from 'react';
import { schemaIsDatabase, schemaLevelLabel } from '../../lib/providerLevels';
import { isReservedWord } from './model';
import { Callout, ConnectionPicker, Field, StepHeader } from './parts';
import type { Wizard } from './useWizard';

function Crumb() {
  return <ChevronRight size={14} className="iw-crumb" aria-hidden="true" />;
}

export function TargetStep({ w, headingRef }: { w: Wizard; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = w;
  const levelLabel = w.conn && schemaIsDatabase(w.conn.providerId) ? schemaLevelLabel(w.conn.providerId) : 'schema';
  const level = levelLabel.charAt(0).toUpperCase() + levelLabel.slice(1);
  const info = s.tableInfo;
  const qualified = `${s.schema ? `${s.schema}.` : ''}${w.create ? s.newTable.trim() : s.table}`;
  const asExisting = w.tables.find((t) => t.toLowerCase() === s.newTable.trim().toLowerCase());

  return (
    <section className="iw-step" aria-labelledby="iw-tgt-title">
      <StepHeader
        ref={headingRef}
        id="iw-tgt-title"
        title="Choose where to import"
        help="Create a new table from the file, or load the rows into a table that already exists."
      />

      <div className="iw-card">
        <div className="iw-seg" role="radiogroup" aria-label="Target">
          <label className={`iw-radio${s.targetMode === 'new' ? ' on' : ''}`}>
            <input type="radio" name="iw-target" checked={s.targetMode === 'new'} onChange={() => patch({ targetMode: 'new', mode: 'append', confirmTruncate: false })} />
            <FilePlus2 size={14} aria-hidden="true" />
            New table
          </label>
          <label className={`iw-radio${s.targetMode === 'existing' ? ' on' : ''}`}>
            <input type="radio" name="iw-target" checked={s.targetMode === 'existing'} onChange={() => patch({ targetMode: 'existing' })} />
            <Table2 size={14} aria-hidden="true" />
            Existing table
          </label>
        </div>

        <div className="iw-where">
          <ConnectionPicker w={w} />
          {w.dbLevel && (
            <>
              <Crumb />
              <Field label="Database">
                <select className="input" aria-label="Database" value={w.dbCatalog ?? ''} onChange={(e) => w.setDatabase(e.target.value || null)}>
                  {!w.dbCatalog && <option value="">(connection default)</option>}
                  {w.dbCatalog && !(w.databases ?? []).includes(w.dbCatalog) && <option value={w.dbCatalog}>{w.dbCatalog}</option>}
                  {(w.databases ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            </>
          )}
          <Crumb />
          <Field label={level}>
            <select className="input" aria-label={level} value={s.schema ?? ''} onChange={(e) => w.setSchema(e.target.value || null)} disabled={!w.cid}>
              {s.schema === null && <option value="">(default)</option>}
              {w.schemaNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>

        {s.targetMode === 'existing' ? (
          <div className="iw-where-table">
            <Field label="Table">
              <select
                className="input"
                aria-label="Target table"
                value={s.table}
                disabled={!w.cid}
                onChange={(e) => patch({ table: e.target.value, tableInfo: null, mapping: {}, keyColumns: [], confirmTruncate: false })}
              >
                <option value="">Choose a table…</option>
                {s.table && !w.tables.includes(s.table) && <option value={s.table}>{s.table}</option>}
                {w.tables.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {s.tableInfoLoading && <div className="iw-hint" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Reading the table…</div>}
            {info && (
              <div className="iw-hint iw-ok" role="status">
                <CircleCheck size={13} aria-hidden="true" /> {info.columns.length} {info.columns.length === 1 ? 'column' : 'columns'}
                {info.primaryKey.length > 0 ? ` · primary key ${info.primaryKey.join(', ')}` : ' · no primary key'}
              </div>
            )}
          </div>
        ) : (
          <div className="iw-where-table">
            <Field label="New table name">
              <input className="input" aria-label="New table name" dir="auto" value={s.newTable} spellCheck={false} onChange={(e) => patch({ newTable: e.target.value })} disabled={!w.cid} />
            </Field>
            {s.newTable.trim() && !w.nameTaken && !isReservedWord(s.newTable) && w.cid && (
              <div className="iw-hint iw-ok" role="status"><CircleCheck size={13} aria-hidden="true" /> Will create {qualified}</div>
            )}
          </div>
        )}
      </div>

      {s.targetMode === 'new' && w.nameTaken && (
        <Callout tone="error">
          A table or view named "{s.newTable.trim()}" already exists{s.schema ? ` in ${s.schema}` : ''}. Choose another name
          {asExisting && (
            <>
              {' '}or{' '}
              <button type="button" className="iw-link" onClick={() => patch({ targetMode: 'existing', table: asExisting, mode: 'append' })}>
                load the rows into {asExisting}
              </button>
            </>
          )}
          .
        </Callout>
      )}
      {s.targetMode === 'new' && !w.nameTaken && s.newTable.trim() && isReservedWord(s.newTable) && (
        <Callout tone="warn">"{s.newTable.trim()}" is an SQL keyword. It works (the name is quoted), but you will have to quote it in queries.</Callout>
      )}
      {s.targetMode === 'existing' && s.tableInfoError && <Callout tone="error">{s.tableInfoError}</Callout>}
      {!w.cid && <Callout tone="info">Choose a connection to see its schemas and tables.</Callout>}
      {w.blocker && <Callout tone="error">{w.blocker}</Callout>}
      {s.capsError && <Callout tone="error">{s.capsError}</Callout>}
    </section>
  );
}
