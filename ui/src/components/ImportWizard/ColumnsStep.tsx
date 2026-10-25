// Step 4: the columns. Existing table: every table column gets a source (a file column, a constant or an expression)
// or is skipped. New table: the definition of every column (name, type, NULL, primary key) with the CREATE TABLE preview.
import { ArrowRight, Check, Copy, Eraser, TriangleAlert, Wand2 } from 'lucide-react';
import type { Ref } from 'react';
import { copyText } from '../../app/actions';
import { EXPRESSIONS, normName, SKIP, typeLabel, type ExpressionName, type MapChoice } from './model';
import { Callout, StepHeader } from './parts';
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
  const skipped = choice.kind === 'skip';
  const missing = skipped && required;
  const source = choice.kind === 'source' ? w.columns.find((c) => c.index === choice.index) : undefined;
  const byName = !!source && normName(source.name) === normName(t.name);
  return (
    <tr className={missing ? 'iw-row-error' : skipped ? 'iw-row-off' : undefined}>
      <td className="iw-map-source">
        <div className="iw-map-srcrow">
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
        <span className="iw-badge-slot">{byName && <span className="iw-pill iw-pill-ok" title="Matched by name">auto</span>}</span>
        <button
          type="button"
          className="iw-toggle"
          aria-pressed={skipped}
          aria-label={`Skip ${t.name}`}
          title={skipped ? 'Load this column again' : 'Do not load this column'}
          disabled={t.isComputed}
          onClick={() => w.toggleSkip(t.name)}
        >
          Skip
        </button>
        </div>
      </td>
      <td className="iw-map-arrow" aria-hidden="true"><ArrowRight size={14} /></td>
      <td className="iw-map-target">
        <span className="iw-map-name" dir="auto">{t.name}</span>
        <span className="iw-map-type">{t.type}</span>
        {t.isPk && <span className="iw-tag" title="Primary key">PK</span>}
        {t.isIdentity && <span className="iw-tag" title="Identity / auto-increment: skipped unless you map it">auto number</span>}
        {t.isComputed && <span className="iw-tag" title="Computed column">computed</span>}
        {required && <span className="iw-tag iw-tag-req" title="NOT NULL without a default">required</span>}
      </td>
      <td className="iw-map-status">
        {compat === 'warn' && <span className="iw-compat iw-compat-warn" title={COMPAT_TITLE.warn} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.warn}`}><TriangleAlert size={14} /></span>}
        {compat === 'convert' && <span className="iw-compat iw-compat-convert" title={COMPAT_TITLE.convert} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.convert}`}><Wand2 size={14} /></span>}
        {compat === 'ok' && <span className="iw-compat iw-compat-ok" title={COMPAT_TITLE.ok} role="img" aria-label={`${t.name}: ${COMPAT_TITLE.ok}`}><Check size={14} /></span>}
        {missing && <span className="iw-compat iw-compat-warn" title="Required: needs a source" role="img" aria-label={`${t.name}: required`}><TriangleAlert size={14} /></span>}
      </td>
    </tr>
  );
}

function ExistingColumns({ w }: { w: Wizard }) {
  const info = w.s.tableInfo;
  if (!info) return <Callout tone="info">Choose the table in the previous step first.</Callout>;
  const mapped = info.columns.filter((c) => (w.s.mapping[c.name] ?? SKIP).kind !== 'skip').length;
  return (
    <>
      <div className="iw-toolbar">
        <span className="iw-toolbar-count" role="status">{mapped} of {info.columns.length} table columns get a value</span>
        <span className="iw-toolbar-spacer" />
        <button type="button" className="btn" onClick={w.runAutoMatch} title="Match the columns by name again">
          <Wand2 size={14} aria-hidden="true" /> Auto-match by name
        </button>
        <button type="button" className="btn" onClick={w.clearMapping} title="Skip every column">
          <Eraser size={14} aria-hidden="true" /> Clear
        </button>
      </div>
      <div className="iw-grid-wrap iw-map-wrap">
        <table className="iw-map iw-map-cols" aria-label="Column mapping">
          <colgroup>
            <col className="iw-col-source" />
            <col className="iw-col-arrow" />
            <col />
            <col className="iw-col-status" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Loaded from (file)</th>
              <th scope="col" aria-hidden="true" />
              <th scope="col">Table column</th>
              <th scope="col"><span className="iw-sr">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {info.columns.map((t) => <MappingRow key={t.name} w={w} t={t} />)}
          </tbody>
        </table>
      </div>
      {w.existingIssues.errors.map((m, i) => <Callout key={`e${i}`} tone="error">{m}</Callout>)}
      {w.existingIssues.warnings.map((m, i) => <Callout key={`w${i}`} tone="warn">{m}</Callout>)}
    </>
  );
}

function NewColumns({ w }: { w: Wizard }) {
  const { s } = w;
  const types = s.caps?.sqlTypes ?? [];
  const effective = new Map((s.ddl?.columns ?? []).map((c) => [c.name, c.sqlType]));
  const included = s.newColumns.filter((c) => c.include).length;
  return (
    <>
      <div className="iw-toolbar">
        <span className="iw-toolbar-count" role="status">{included} of {s.newColumns.length} columns will be created in {s.schema ? `${s.schema}.` : ''}{s.newTable.trim() || 'the new table'}</span>
        <span className="iw-toolbar-spacer" />
        <button type="button" className="btn btn-xs" onClick={() => s.newColumns.forEach((c) => w.updateNewColumn(c.index, { include: true }))}>Include all</button>
        <button type="button" className="btn btn-xs" onClick={() => s.newColumns.forEach((c) => w.updateNewColumn(c.index, { include: false }))}>Include none</button>
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
      {w.newIssues.map((m, i) => <Callout key={i} tone="error">{m}</Callout>)}
      <details className="iw-more iw-ddl">
        <summary>CREATE TABLE preview</summary>
        <div className="iw-ddl-head">
          <span className="iw-note">The statement Rowlit runs before loading the rows.</span>
          {s.ddl && (
            <button type="button" className="btn btn-xs" onClick={() => void copyText(s.ddl!.ddl, 'Copied the CREATE TABLE statement')} aria-label="Copy CREATE TABLE">
              <Copy size={12} /> Copy
            </button>
          )}
        </div>
        {s.ddlError ? <Callout tone="error">{s.ddlError}</Callout> : (
          <pre className="iw-code" aria-label="CREATE TABLE preview" tabIndex={0}>{s.ddl?.ddl ?? '-- fill in the table name and columns'}</pre>
        )}
        {s.ddl?.warnings.map((m, i) => <Callout key={i} tone="warn">{m}</Callout>)}
      </details>
    </>
  );
}

export function ColumnsStep({ w, headingRef }: { w: Wizard; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <section className="iw-step" aria-labelledby="iw-col-title">
      <StepHeader
        ref={headingRef}
        id="iw-col-title"
        title={w.create ? 'Define the new table columns' : 'Match the file columns to the table'}
        help={w.create
          ? 'Rowlit proposes a name and a type for every column from the file. Rename, change the type, or leave a column out.'
          : 'Every table column takes its value from a file column, a constant or an expression. Required columns need a source.'}
      />
      {w.create ? <NewColumns w={w} /> : <ExistingColumns w={w} />}
    </section>
  );
}
