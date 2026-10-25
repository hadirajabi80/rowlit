// Step 3: where the rows go - an existing table (column mapping) or a new table (column definitions + CREATE TABLE preview).
import { AlertTriangle, ArrowRightLeft, Check, Copy, Wand2 } from 'lucide-react';
import { copyText } from '../../app/actions';
import { schemaIsDatabase, schemaLevelLabel } from '../../lib/providerLevels';
import { EXPRESSIONS, SKIP, typeLabel, type ExpressionName, type MapChoice } from './model';
import type { TargetColumn } from './types';
import type { Wizard } from './useWizard';

function choiceValue(c: MapChoice): string {
  switch (c.kind) {
    case 'skip': return 'skip';
    case 'source': return `src:${c.index}`;
    case 'constant': return 'const';
    default: return `expr:${c.name}`;
  }
}

function parseChoice(v: string, prev: MapChoice): MapChoice {
  if (v === 'skip') return SKIP;
  if (v === 'const') return { kind: 'constant', value: prev.kind === 'constant' ? prev.value : '' };
  if (v.startsWith('src:')) return { kind: 'source', index: Number(v.slice(4)) };
  return { kind: 'expression', name: v.slice(5) as ExpressionName };
}

const COMPAT_TITLE = {
  ok: 'The values fit.',
  convert: 'The values will be converted.',
  warn: 'The values may not fit this column.',
} as const;

function MappingRow({ w, t }: { w: Wizard; t: TargetColumn }) {
  const choice = w.s.mapping[t.name] ?? SKIP;
  const compat = w.existingIssues.compat[t.name];
  const required = !t.nullable && !t.hasDefault && !t.isIdentity && !t.isComputed;
  const missing = choice.kind === 'skip' && required;
  return (
    <tr className={missing ? 'iw-row-error' : undefined}>
      <td className="iw-map-target">
        <span dir="auto">{t.name}</span>
        {t.isPk && <span className="iw-tag" title="Primary key">PK</span>}
        {t.isIdentity && <span className="iw-tag" title="Identity / auto-increment: skipped unless you map it">auto</span>}
        {t.isComputed && <span className="iw-tag" title="Computed column">computed</span>}
        {required && <span className="iw-tag iw-tag-req" title="NOT NULL without a default">required</span>}
      </td>
      <td className="iw-map-type">{t.type}</td>
      <td className="iw-map-arrow" aria-hidden="true"><ArrowRightLeft size={12} /></td>
      <td className="iw-map-source">
        <select
          className="input sm"
          aria-label={`Source for ${t.name}`}
          value={choiceValue(choice)}
          disabled={t.isComputed}
          onChange={(e) => w.setMapping(t.name, parseChoice(e.target.value, choice))}
        >
          <option value="skip">(skip)</option>
          <optgroup label="File columns">
            {w.columns.map((c) => <option key={c.index} value={`src:${c.index}`}>{c.name} · {typeLabel(c.inferred)}</option>)}
          </optgroup>
          <optgroup label="Other">
            <option value="const">Constant value…</option>
            {EXPRESSIONS.map((x) => <option key={x.name} value={`expr:${x.name}`}>{x.label}</option>)}
          </optgroup>
        </select>
        {choice.kind === 'constant' && (
          <input
            className="input sm"
            aria-label={`Constant for ${t.name}`}
            placeholder="value (empty = NULL)"
            value={choice.value ?? ''}
            onChange={(e) => w.setMapping(t.name, { kind: 'constant', value: e.target.value === '' ? null : e.target.value })}
          />
        )}
      </td>
      <td className="iw-map-status">
        {compat === 'warn' && <span className="iw-compat iw-compat-warn" title={COMPAT_TITLE.warn} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.warn}`}><AlertTriangle size={14} /></span>}
        {compat === 'convert' && <span className="iw-compat iw-compat-convert" title={COMPAT_TITLE.convert} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.convert}`}><Wand2 size={14} /></span>}
        {compat === 'ok' && <span className="iw-compat iw-compat-ok" title={COMPAT_TITLE.ok} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.ok}`}><Check size={14} /></span>}
        {missing && <span className="iw-compat iw-compat-warn" title="Required: needs a source" role="img" aria-label={`${t.name}: required`}><AlertTriangle size={14} /></span>}
      </td>
    </tr>
  );
}

function ExistingTarget({ w }: { w: Wizard }) {
  const { s, patch } = w;
  const info = s.tableInfo;
  return (
    <>
      <div className="iw-row">
        <label className="iw-field">
          <span>Table</span>
          <select
            className="input"
            aria-label="Target table"
            value={s.table}
            onChange={(e) => patch({ table: e.target.value, tableInfo: null, mapping: {}, keyColumns: [], confirmTruncate: false })}
          >
            <option value="">Choose a table…</option>
            {s.table && !w.tables.includes(s.table) && <option value={s.table}>{s.table}</option>}
            {w.tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {info && (
          <button type="button" className="btn iw-auto" onClick={w.runAutoMatch} title="Match the columns by name again">
            <Wand2 size={14} /> Auto-match
          </button>
        )}
      </div>
      {s.tableInfoLoading && <div className="iw-hint" role="status">Reading the table…</div>}
      {s.tableInfoError && <div className="iw-msg iw-error" role="alert">{s.tableInfoError}</div>}
      {info && (
        <div className="iw-grid-wrap iw-map-wrap">
          <table className="iw-map" aria-label="Column mapping">
            <thead>
              <tr>
                <th scope="col">Table column</th>
                <th scope="col">Type</th>
                <th scope="col" aria-hidden="true" />
                <th scope="col">Loaded from</th>
                <th scope="col"><span className="iw-sr">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {info.columns.map((t) => <MappingRow key={t.name} w={w} t={t} />)}
            </tbody>
          </table>
        </div>
      )}
      {w.existingIssues.errors.map((m, i) => <div key={`e${i}`} className="iw-msg iw-error" role="alert">{m}</div>)}
      {w.existingIssues.warnings.map((m, i) => <div key={`w${i}`} className="iw-msg iw-warn" role="status">{m}</div>)}
    </>
  );
}

function NewTarget({ w }: { w: Wizard }) {
  const { s, patch } = w;
  const types = w.s.caps?.sqlTypes ?? [];
  const effective = new Map((s.ddl?.columns ?? []).map((c) => [c.name, c.sqlType]));
  return (
    <>
      <div className="iw-row">
        <label className="iw-field iw-grow">
          <span>New table name</span>
          <input className="input" aria-label="New table name" dir="auto" value={s.newTable} spellCheck={false} onChange={(e) => patch({ newTable: e.target.value })} />
        </label>
      </div>
      <div className="iw-grid-wrap iw-map-wrap">
        <table className="iw-map" aria-label="New table columns">
          <thead>
            <tr>
              <th scope="col">Use</th>
              <th scope="col">File column</th>
              <th scope="col">Column name</th>
              <th scope="col">Type</th>
              <th scope="col">Null</th>
              <th scope="col" title="Primary key">PK</th>
            </tr>
          </thead>
          <tbody>
            {s.newColumns.map((c) => {
              const isPk = s.primaryKey.includes(c.name);
              return (
                <tr key={c.index} className={c.include ? undefined : 'iw-row-off'}>
                  <td>
                    <input type="checkbox" aria-label={`Include ${c.sourceName}`} checked={c.include} onChange={(e) => w.updateNewColumn(c.index, { include: e.target.checked })} />
                  </td>
                  <td className="iw-map-target"><span dir="auto">{c.sourceName}</span><span className={`iw-kind iw-kind-${c.inferred.kind}`}>{typeLabel(c.inferred)}</span></td>
                  <td>
                    <input className="input sm" aria-label={`Name of ${c.sourceName}`} dir="auto" value={c.name} disabled={!c.include} spellCheck={false} onChange={(e) => w.updateNewColumn(c.index, { name: e.target.value })} />
                  </td>
                  <td>
                    <input
                      className="input sm"
                      aria-label={`Type of ${c.sourceName}`}
                      list="iw-sql-types"
                      disabled={!c.include}
                      value={c.sqlType ?? effective.get(c.name.trim()) ?? ''}
                      placeholder="default"
                      spellCheck={false}
                      onChange={(e) => w.updateNewColumn(c.index, { sqlType: e.target.value.trim() === '' ? null : e.target.value })}
                    />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${c.sourceName} can be NULL`} checked={!isPk && c.nullable} disabled={!c.include || isPk} onChange={(e) => w.updateNewColumn(c.index, { nullable: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${c.sourceName} is part of the primary key`} checked={isPk} disabled={!c.include} onChange={() => w.togglePk(c.name)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="iw-sql-types">
          {types.map((t) => <option key={t} value={t} />)}
        </datalist>
      </div>
      {w.newIssues.map((m, i) => <div key={i} className="iw-msg iw-error" role="alert">{m}</div>)}
      <div className="iw-ddl">
        <div className="iw-ddl-head">
          <strong>CREATE TABLE</strong>
          {s.ddl && (
            <button type="button" className="btn btn-xs" onClick={() => void copyText(s.ddl!.ddl, 'Copied the CREATE TABLE statement')} aria-label="Copy CREATE TABLE">
              <Copy size={12} /> Copy
            </button>
          )}
        </div>
        {s.ddlError ? <div className="iw-msg iw-error" role="alert">{s.ddlError}</div> : (
          <pre className="iw-code" aria-label="CREATE TABLE preview" tabIndex={0}>{s.ddl?.ddl ?? '-- fill in the table name and columns'}</pre>
        )}
        {s.ddl?.warnings.map((m, i) => <div key={i} className="iw-msg iw-warn" role="status">{m}</div>)}
      </div>
    </>
  );
}

export function TargetStep({ w }: { w: Wizard }) {
  const { s, patch } = w;
  const levelLabel = w.conn && schemaIsDatabase(w.conn.providerId) ? schemaLevelLabel(w.conn.providerId) : 'schema';
  const level = levelLabel.charAt(0).toUpperCase() + levelLabel.slice(1);
  return (
    <section className="iw-step" aria-labelledby="iw-tgt-title">
      <h2 id="iw-tgt-title" className="iw-h">Target table</h2>
      <div className="iw-row iw-target-head">
        <div className="iw-seg" role="radiogroup" aria-label="Target">
          <label className={`iw-radio${s.targetMode === 'existing' ? ' on' : ''}`}>
            <input type="radio" name="iw-target" checked={s.targetMode === 'existing'} onChange={() => patch({ targetMode: 'existing' })} />
            Existing table
          </label>
          <label className={`iw-radio${s.targetMode === 'new' ? ' on' : ''}`}>
            <input type="radio" name="iw-target" checked={s.targetMode === 'new'} onChange={() => patch({ targetMode: 'new', mode: 'append', confirmTruncate: false })} />
            New table
          </label>
        </div>
        <span className="iw-context">
          {w.conn?.name}
          {w.dbEngine ? ` · ${w.dbEngine}` : ''}
        </span>
        <label className="iw-field">
          <span>{level}</span>
          <select
            className="input"
            aria-label={level}
            value={s.schema ?? ''}
            onChange={(e) => patch({ schema: e.target.value || null, table: '', tableInfo: null, mapping: {}, keyColumns: [] })}
          >
            {s.schema === null && <option value="">(default)</option>}
            {w.schemaNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {s.targetMode === 'existing' ? <ExistingTarget w={w} /> : <NewTarget w={w} />}
    </section>
  );
}
