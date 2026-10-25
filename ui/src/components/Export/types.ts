// Shapes shared by the export dialog and the views that open it. Type-only: no runtime code, so a view can import
// this without pulling the dialog into the initial bundle.
import type { CellValue, ColumnInfo, Dialect, ExportFormat, QueryParam } from '../../api/types';
import type { SortSpec, TableTarget } from '../../data/sqlgen';
import type { CellFetcher, CellLocator } from '../../lib/serialize';

/**
 * What to export. `loaded` / `selection` come from the rows in the grid (client side, exactly what the user sees);
 * `filtered` / `all` / `rerun` are SELECTs the engine streams to the file (an export job, no row cap).
 */
export type ExportScopeId = 'loaded' | 'selection' | 'filtered' | 'all' | 'rerun';

export const SERVER_SCOPES: readonly ExportScopeId[] = ['filtered', 'all', 'rerun'];

export interface ScopeOption {
  id: ExportScopeId;
  label: string;
  /** One line under the label: what the scope covers. */
  hint: string | null;
  /** Rows the scope writes, when known. */
  count: number | null;
  /** 'estimate' counts are written "~1,234". */
  countKind: 'exact' | 'estimate';
  /** Why the scope cannot be chosen; the row is shown disabled with this text. */
  disabled: string | null;
  /** Counts the rows with a COUNT(*) on the session (the dialog calls it once, or on request when `countOnRequest`). */
  countNow?: () => Promise<number | null>;
  /** A cheap approximation (catalog statistics) shown while no exact count is known; written "~1,234". */
  estimate?: () => Promise<number | null>;
  /** The count is only run when the user asks for it (a COUNT(*) of a whole table can be slow). */
  countOnRequest?: boolean;
}

/** Rows of a client-side scope with the lookups that fetch the full value of truncated cells. */
export interface ClientRows {
  columns: ColumnInfo[];
  rows: CellValue[][];
  locate: ((row: number, col: number) => CellLocator | null) | null;
  fetch: CellFetcher | null;
}

export interface ServerQuery {
  sql: string;
  params: QueryParam[];
}

export interface ExportSource {
  kind: 'table' | 'query';
  /** "Customers" / "Query result". */
  title: string;
  /** File name without extension (letters of any script are kept). */
  baseName: string;
  connectionId: string;
  dialect: Dialect;
  /** Table name written into SQL INSERT statements by default. */
  defaultTable: string;
  scopes: ScopeOption[];
  initialScope: ExportScopeId;
  /** The grid's rows: every visible row (`loaded`) or the selected block (`selection`). Null when the grid is gone. */
  clientRows(scope: 'loaded' | 'selection'): ClientRows | null;
  /** The loaded rows are the engine's stored result unchanged: it can write them itself (full values, every row). */
  stored: { executionId: string; resultSetId: number } | null;
  /** The statement that streams a server scope; null when it cannot be built. */
  serverQuery(scope: 'filtered' | 'all' | 'rerun'): ServerQuery | null;
  /** Runs `run` on the session the export streams on, one statement at a time with the grid's other queries. */
  withSession<T>(run: (sessionId: string) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------- what the views hand over

/** The Data tab's state at the moment of "Export…" (the dialog is built from it, lazily). */
export interface TableExportContext {
  kind: 'table';
  connectionId: string;
  dialect: Dialect;
  gridKey: string;
  /** Table (or view) name, as titled. */
  title: string;
  /** The target the grid pages with: key columns and the keyless fallback order, without the Oracle ROWID. */
  target: TableTarget;
  columns: ColumnInfo[];
  /** The predicate the loaded rows were read with (null = no filter) and its bind values. */
  where: string | null;
  params: QueryParam[];
  /** The filter has a part that only the grid can apply (regular expression): a server export would not match it. */
  clientOnlyFilter: boolean;
  sort: SortSpec[];
  /** COUNT(*) of the filter, when the grid knows it. */
  filteredCount: number | null;
  /** Rows the grid holds now (committed edits applied) and whether more pages exist. */
  loaded: number;
  hasMore: boolean;
  /** Runs fn on the tab's session (exclusive with the grid's own queries). */
  withSession<T>(run: (sessionId: string) => Promise<T>): Promise<T>;
  /** Table row estimate from the catalog (cheap), null when unknown. */
  estimateRows(): Promise<number | null>;
}

/** The console result set's state at the moment of "Export…". */
export interface QueryExportContext {
  kind: 'query';
  connectionId: string;
  dialect: Dialect;
  gridKey: string;
  baseName: string;
  columns: ColumnInfo[];
  /** The single SELECT that produced the rows, as it ran (null: not a single SELECT). */
  sql: string | null;
  params: QueryParam[];
  /** Why the query cannot be re-run (not a SELECT, several statements, session closed). */
  rerunDisabled: string | null;
  /** Rows the engine holds for the result set and whether the cap cut it. */
  rowCount: number;
  truncated: boolean;
  /** A client-side filter or sort changes the grid's rows (the re-run ignores it). */
  gridFiltered: boolean;
  stored: { executionId: string; resultSetId: number } | null;
  withSession<T>(run: (sessionId: string) => Promise<T>): Promise<T>;
}

export type ExportContext = TableExportContext | QueryExportContext;

// ---------------------------------------------------------------- dialog settings

export interface ExportSettings {
  format: ExportFormat;
  header: boolean;
  /** CSV delimiter: a single character, or "\t". */
  delimiter: string;
  /** UTF-8 byte order mark (Excel reads Persian / Arabic CSV correctly only with it). */
  bom: boolean;
  /** Text written for NULL; null = the format's default (empty, "NULL" for Markdown). */
  nullText: string | null;
  /** Pattern for date / time columns ('' = as stored). */
  dateFormat: string;
  /** SQL INSERT: target table (empty = the source's) and dialect of the literals (null = the connection's). */
  tableName: string;
  sqlDialect: Dialect | null;
  sheetName: string;
  openAfter: boolean;
}
