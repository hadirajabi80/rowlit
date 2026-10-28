// Step 3: the plan of every table - target name, filter, per-column target type (with the target's type list), excluded
// columns, the planner's notes and warnings, and the DDL that will run.
import { ChevronDown, ChevronRight, CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { Ref } from 'react';
import type { PlannedTable } from '../../api/types.transfer';
import { Callout, StepHeader } from '../ImportWizard/parts';
import { setColumnType, toggleExcluded, updateChoice, whereIssue, type TableChoice } from './model';
import type { Transfer } from './useTransfer';

function TableCard({ t, table, choice }: { t: Transfer; table: PlannedTable; choice: TableChoice | undefined }) {
  const { s, patch } = t;
  const open = s.expanded === table.sourceName;
  const toggle = () => patch({ expanded: open ? null : table.sourceName });
  const change = (c: Partial<TableChoice>) => choice && patch({ selected: updateChoice(s.selected, choice.name, c) });
  const whereProblem = choice?.where.trim() ? whereIssue(choice.where) : null;
  const copied = table.columns.filter((c) => !c.excluded).length;
  const bodyId = `tr-map-${table.sourceName}`;

  return (
    <li className={`iw-card tr-map-card${table.error ? ' tr-error' : ''}`}>
      <button type="button" className="tr-map-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <strong dir="auto">{table.sourceName}</strong>
        <span className="iw-note">→ {table.targetSchema ? `${table.targetSchema}.` : ''}{table.targetName}</span>
        <span className="iw-note">· {copied} of {table.columns.length} columns{table.existsInTarget ? ' · exists in target' : ''}</span>
        <span className="iw-nav-spacer" />
        {table.error && <span className="tr-badge tr-badge-error"><CircleAlert size={12} aria-hidden="true" /> needs attention</span>}
        {!table.error && table.warnings.length > 0 && (
          <span className="tr-badge tr-badge-warn"><TriangleAlert size={12} aria-hidden="true" /> {table.warnings.length} {table.warnings.length === 1 ? 'note' : 'notes'}</span>
        )}
      </button>
      {table.error && <Callout tone="error">{table.error}</Callout>}
      {open && choice && (
        <div id={bodyId} className="tr-map-body">
          <div className="iw-where">
            <label className="iw-field">
              <span className="iw-field-label">Target table name</span>
              <input
                className="input" aria-label={`Target name of ${table.sourceName}`} dir="auto" spellCheck={false}
                value={choice.targetName} placeholder={table.targetName} onChange={(e) => change({ targetName: e.target.value })}
              />
            </label>
            <label className="iw-field tr-where">
              <span className="iw-field-label">Filter (WHERE, in the source dialect)</span>
              <input
                className="input" aria-label={`Filter of ${table.sourceName}`} spellCheck={false} placeholder="e.g. created >= '2026-01-01'"
                value={choice.where} onChange={(e) => change({ where: e.target.value })} aria-invalid={!!whereProblem}
              />
              {whereProblem && <small className="iw-note iw-error-text">{whereProblem}</small>}
            </label>
          </div>
          <div className="iw-grid-wrap">
            <table className="iw-map" aria-label={`Columns of ${table.sourceName}`}>
              <thead>
                <tr><th scope="col">Copy</th><th scope="col">Column</th><th scope="col">Source type</th><th scope="col">Target column</th><th scope="col">Target type</th><th scope="col">Note</th></tr>
              </thead>
              <tbody>
                {table.columns.map((c) => {
                  const byUser = choice.excluded.includes(c.name);
                  const forced = c.excluded && !byUser;
                  return (
                    <tr key={c.name} className={c.excluded ? 'tr-excluded' : undefined}>
                      <td>
                        <input
                          type="checkbox" aria-label={`Copy ${c.name}`} checked={!c.excluded} disabled={forced}
                          onChange={() => change(toggleExcluded(choice, c.name))}
                        />
                      </td>
                      <td dir="auto">{c.name}{c.isPrimaryKey ? <span className="tr-badge">PK</span> : null}{c.isIdentity ? <span className="tr-badge">identity</span> : null}</td>
                      <td className="tr-mono">{c.sourceType}</td>
                      <td dir="auto">{c.targetName}</td>
                      <td>
                        <input
                          className="input tr-mono tr-type" aria-label={`Target type of ${c.name}`} list="tr-types" spellCheck={false} disabled={c.excluded}
                          value={choice.columnTypes[c.name] ?? c.targetType}
                          onChange={(e) => change(setColumnType(choice, c.name, e.target.value, c.defaultTargetType))}
                        />
                      </td>
                      <td className={c.note ? 'tr-note' : undefined}>{c.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {table.warnings.length > 0 && (
            <ul className="tr-warnings" aria-label={`Notes on ${table.sourceName}`}>
              {table.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {table.createStatements.length + table.postStatements.length > 0 && (
            <details className="iw-more">
              <summary>Statements that will run</summary>
              <pre className="iw-code" tabIndex={0}>{[...table.createStatements, ...table.postStatements].join(';\n\n')}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

export function MappingStep({ t, headingRef }: { t: Transfer; headingRef: Ref<HTMLHeadingElement> }) {
  const { s } = t;
  const plan = s.plan;
  return (
    <section className="iw-step" aria-labelledby="tr-map-title">
      <StepHeader
        ref={headingRef}
        id="tr-map-title"
        title="Check the mapping"
        help="Each column gets the closest type of the target. Change a name or a type, leave columns out, or copy only some rows."
        aside={s.planLoading ? <span className="iw-note" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Planning…</span> : null}
      />
      {s.planError && <Callout tone="error">{s.planError}</Callout>}
      {t.mapIssues.map((m, i) => <Callout key={i} tone="error">{m}</Callout>)}
      {t.refused.length > 0 && (
        <Callout tone="warn">
          {t.refused.length} {t.refused.length === 1 ? 'table cannot' : 'tables cannot'} be copied as planned. Rename the target, or choose what to do with
          existing tables in Options.
        </Callout>
      )}
      {plan && plan.warnings.length > 0 && <Callout tone="warn">{plan.warnings.join(' ')}</Callout>}
      {plan && (
        <ol className="tr-map-list" aria-label="Tables in copy order">
          {plan.tables.map((tb) => <TableCard key={tb.sourceName} t={t} table={tb} choice={s.selected.find((c) => c.name === tb.sourceName)} />)}
        </ol>
      )}
      <datalist id="tr-types">
        {t.types.map((ty) => <option key={ty.name} value={ty.default || ty.name} />)}
      </datalist>
    </section>
  );
}
