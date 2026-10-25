// The export dialog's scopes, built from the state a view hands over (Data tab: TableExportContext; console result
// set: QueryExportContext). Pure apart from the lookups into the live grid (controller) and the SQL generated through
// data/sqlgen, which is the one place that writes the WHERE / ORDER BY of the grid's own queries.
import { countSql, exportSelectSql } from '../../data/sqlgen';
import { defaultTableName } from '../../lib/serialize';
import { getSqlRunner } from '../DataTab/runner';
import { gridController } from '../Grid/controller';
import type { ClientRows, ExportSource, QueryExportContext, ScopeOption, TableExportContext } from './types';

function clientRowsOf(gridKey: string): ExportSource['clientRows'] {
  return (scope): ClientRows | null => {
    const g = gridController(gridKey);
    return g?.exportBlock ? g.exportBlock(scope === 'selection') : null;
  };
}

/** "3 rows" / "5 columns" / "4 × 2 cells" */
function selectionLabel(sel: { rows: number; cols: number; kind: 'rows' | 'columns' | 'cells' }): { label: string; count: number } {
  if (sel.kind === 'rows') return { label: 'Selected rows', count: sel.rows };
  if (sel.kind === 'columns') return { label: `Selected column${sel.cols === 1 ? '' : 's'}`, count: sel.rows };
  return { label: 'Selected cells', count: sel.rows };
}

function selectionScope(gridKey: string): ScopeOption | null {
  const sel = gridController(gridKey)?.exportInfo?.().selection;
  if (!sel) return null;
  const { label, count } = selectionLabel(sel);
  return {
    id: 'selection', label, count, countKind: 'exact', disabled: null,
    hint: sel.kind === 'cells' ? `${sel.rows} × ${sel.cols} cells of the grid` : sel.kind === 'columns' ? `${sel.cols} of the grid's columns, every row shown` : 'The rows you selected in the grid',
  };
}

// ---------------------------------------------------------------- Data tab

export function buildTableSource(c: TableExportContext): ExportSource {
  const filterActive = c.where !== null || c.clientOnlyFilter;
  const sortActive = c.sort.length > 0;
  const loaded = gridController(c.gridKey)?.exportInfo?.().visibleRows ?? c.loaded;
  const stmtCount = (where: string | null) => async () => {
    const res = await c.withSession((sid) => runCount(sid, countSql(c.target, c.dialect, where), where === c.where ? c.params : []));
    return res;
  };

  const loadedScope: ScopeOption = {
    id: 'loaded', label: 'Loaded rows', count: loaded, countKind: 'exact', disabled: null,
    hint: c.hasMore ? 'The rows in the grid now; more rows exist and are not loaded' : 'The rows in the grid now (every row of the table)',
  };

  const filtered: ScopeOption = {
    id: 'filtered',
    label: filterActive ? 'Current filter & sort: all matching rows' : 'Current sort: all rows',
    hint: 'Runs the grid\'s query again without the page limit and writes every match',
    count: c.filteredCount, countKind: 'exact',
    disabled: c.clientOnlyFilter ? 'The filter has a regular expression, which only applies to the loaded rows.'
      : !filterActive && !sortActive ? 'No filter or sort is applied: use All records.' : null,
    ...(c.where !== null ? { countNow: stmtCount(c.where) } : {}),
  };

  const allScope: ScopeOption = {
    id: 'all', label: 'All records', hint: 'Every row of the table, no filter',
    count: !filterActive ? c.filteredCount : null, countKind: 'exact', disabled: null,
    countNow: stmtCount(null),
    estimate: c.estimateRows,
    // a COUNT(*) of a whole table can take a while: an estimate is shown, the exact number on request
    countOnRequest: filterActive,
  };

  const scopes: ScopeOption[] = [loadedScope, selectionScope(c.gridKey), filtered, allScope].filter((s): s is ScopeOption => !!s);
  return {
    kind: 'table',
    title: c.title,
    baseName: c.title,
    connectionId: c.connectionId,
    dialect: c.dialect,
    defaultTable: defaultTableName(c.columns, c.dialect),
    scopes,
    initialScope: scopes.some((s) => s.id === 'selection') ? 'selection' : 'loaded',
    clientRows: clientRowsOf(c.gridKey),
    stored: null,
    serverQuery(scope) {
      if (scope === 'filtered') return { sql: exportSelectSql(c.target, c.dialect, { where: c.where, sort: c.sort }), params: c.params };
      if (scope === 'all') return { sql: exportSelectSql(c.target, c.dialect, { ordered: false }), params: [] };
      return null;
    },
    withSession: c.withSession,
  };
}

// ---------------------------------------------------------------- console result

/** `SELECT … ;` → `SELECT …` (a trailing semicolon is a syntax error on some servers). */
export const stripTrailingSemicolon = (sql: string): string => sql.replace(/[\s;]+$/, '');

export function buildQuerySource(c: QueryExportContext): ExportSource {
  const loaded = gridController(c.gridKey)?.exportInfo?.().visibleRows ?? c.rowCount;
  const loadedScope: ScopeOption = {
    id: 'loaded', label: 'Loaded rows', count: loaded, countKind: 'exact', disabled: null,
    hint: c.truncated ? 'The result was cut at the row limit; "Re-run" writes the rest'
      : c.gridFiltered ? 'The rows the grid shows (its filter and sort applied)' : 'Every row of the result',
  };
  const rerun: ScopeOption = {
    id: 'rerun', label: 'Re-run the query: all rows',
    hint: c.gridFiltered ? 'Runs the SELECT again and writes every row it returns (the grid\'s own filter and sort are not applied)'
      : 'Runs the SELECT again and writes every row it returns, without the row limit',
    count: c.truncated ? null : c.rowCount, countKind: 'exact', disabled: c.rerunDisabled,
  };
  const scopes = [loadedScope, selectionScope(c.gridKey), rerun].filter((s): s is ScopeOption => !!s);
  return {
    kind: 'query',
    title: 'Query result',
    baseName: c.baseName,
    connectionId: c.connectionId,
    dialect: c.dialect,
    defaultTable: defaultTableName(c.columns, c.dialect),
    scopes,
    initialScope: scopes.some((s) => s.id === 'selection') ? 'selection' : 'loaded',
    clientRows: clientRowsOf(c.gridKey),
    stored: c.stored,
    serverQuery: (scope) => (scope === 'rerun' && c.sql ? { sql: stripTrailingSemicolon(c.sql), params: c.params } : null),
    withSession: c.withSession,
  };
}

// ---------------------------------------------------------------- COUNT(*)

/** COUNT(*) on the session; the statement returns one row with one number. */
async function runCount(sessionId: string, sql: string, params: TableExportContext['params']): Promise<number | null> {
  const res = await getSqlRunner()(sessionId, sql, params, { label: 'data', maxRows: 1, skipHistory: true });
  if (res.error) throw new Error(res.error.message);
  const v = res.resultSets[0]?.rows[0]?.[0];
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}
