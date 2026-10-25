// Where a file dropped anywhere on the window goes, and what each kind of file does:
//   data files (.csv .tsv .txt .xlsx .json .ndjson .jsonl) -> an Import Wizard tab per file (at most 5), context aware
//   .sql                                                   -> a new console holding the script
//   anything else                                          -> a "not supported" toast
// Light on purpose: this module and the overlay are part of the initial bundle (the wizard itself is a lazy chunk).
import { catalogDatabase, newConsole } from '../../app/actions';
import { isConnectionTarget, isContainerTarget, isObjectTarget } from '../../commands/types';
import { getConnection, useConnections } from '../../store/connections';
import { getActiveTab, useTabs, type Tab } from '../../store/tabs';
import { toast } from '../../store/ui';
import { DATA_VIEW, type DataTabState } from '../DataTab/open';
import { useExplorer } from '../Explorer/explorerStore';
import { MAX_DROP_WIZARDS, handleImportDrop, pathOfFile, toastUnsupported } from '../ImportWizard/fileDrop';
import { isImportable, isSqlFile } from '../ImportWizard/files';
import { canImportInto, IMPORT_VIEW_ID, type ImportContext, type ImportTabState } from '../ImportWizard/open';

export interface DropTarget {
  ctx: ImportContext;
  /** 'table': load into it; 'schema' / 'connection': a new table there; 'ask': the wizard asks for the connection. */
  kind: 'table' | 'schema' | 'connection' | 'ask';
  /** "public.orders", "Shop › public": what the overlay names as the destination. */
  label: string;
}

const ASK: DropTarget = { ctx: { connectionId: null, database: null, schema: null, table: null }, kind: 'ask', label: '' };

function connectionName(id: string | null): string {
  return getConnection(id)?.name ?? '';
}

const qualified = (schema: string | null, name: string) => (schema ? `${schema}.${name}` : name);

/** The destination of an import dropped on the window, from where the user is working. */
export function resolveDropTarget(): DropTarget {
  const tab: Tab | undefined = getActiveTab();

  // 1. A table's tab (its data, or its structure): load into that table.
  if (tab && tab.connectionId && canImportInto(tab.connectionId)) {
    if (tab.kind === 'view' && tab.view === DATA_VIEW) {
      const st = (tab.state ?? {}) as Partial<DataTabState>;
      if (st.name && (st.type === undefined || st.type === 'table')) {
        return {
          kind: 'table', label: qualified(st.schema ?? null, st.name),
          ctx: { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema: st.schema ?? null, table: st.name },
        };
      }
    }
    if (tab.kind === 'object' && tab.ref.type === 'table') {
      return {
        kind: 'table', label: qualified(tab.ref.schema, tab.ref.name),
        ctx: { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema: tab.ref.schema, table: tab.ref.name },
      };
    }
  }

  // 2. The explorer selection: a new table in its schema / database / connection.
  const sel = useExplorer.getState().selectedTarget;
  if (sel && 'connectionId' in sel && canImportInto(sel.connectionId)) {
    if (isObjectTarget(sel) && sel.ref.type === 'table') {
      return {
        kind: 'schema', label: `${connectionName(sel.connectionId)}${sel.ref.schema ? ` › ${sel.ref.schema}` : ''}`,
        ctx: { connectionId: sel.connectionId, database: sel.database, schema: sel.ref.schema, table: null },
      };
    }
    if (isContainerTarget(sel) && !sel.queries) {
      return {
        kind: 'schema', label: `${connectionName(sel.connectionId)}${sel.schema ? ` › ${sel.schema}` : ''}`,
        ctx: { connectionId: sel.connectionId, database: sel.database, schema: sel.schema, table: null },
      };
    }
    if (isConnectionTarget(sel)) {
      return { kind: 'connection', label: connectionName(sel.connectionId), ctx: { connectionId: sel.connectionId, database: null, schema: null, table: null } };
    }
  }

  // 3. The active tab's connection (a console, an object, another view; an import wizard keeps its schema).
  if (tab?.connectionId && canImportInto(tab.connectionId)) {
    let schema: string | null = null;
    if (tab.kind === 'object') schema = tab.ref.schema;
    else if (tab.kind === 'view' && tab.view === IMPORT_VIEW_ID) schema = ((tab.state ?? {}) as Partial<ImportTabState>).schema ?? null;
    return {
      kind: schema ? 'schema' : 'connection', label: `${connectionName(tab.connectionId)}${schema ? ` › ${schema}` : ''}`,
      ctx: { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema, table: null },
    };
  }

  // 4. A single writable connection is the only possible answer; with several, the wizard asks.
  const writable = useConnections.getState().connections.filter((c) => canImportInto(c.id));
  if (writable.length === 1) {
    return { kind: 'connection', label: writable[0].name, ctx: { connectionId: writable[0].id, database: null, schema: null, table: null } };
  }
  return ASK;
}

/** The sentence of the overlay card for a destination. */
export function dropHeadline(t: DropTarget): string {
  switch (t.kind) {
    case 'table': return `Drop to import into ${t.label}`;
    case 'schema':
    case 'connection': return `Drop to import into a new table in ${t.label}`;
    default: return 'Drop to import into a database';
  }
}

export function dropDetail(t: DropTarget): string {
  switch (t.kind) {
    case 'table': return 'The rows of the file are loaded into this table. You choose the columns and the mode next.';
    case 'schema':
    case 'connection': return 'A new table is created from the file. You can change the name and the columns next.';
    default: return 'You choose the connection and the table in the wizard.';
  }
}

export interface ClassifiedFiles {
  data: File[];
  sql: File[];
  other: File[];
}

export function classifyFiles(files: readonly File[]): ClassifiedFiles {
  const out: ClassifiedFiles = { data: [], sql: [], other: [] };
  for (const f of files) (isImportable(f.name) ? out.data : isSqlFile(f.name) ? out.sql : out.other).push(f);
  return out;
}

const MAX_SQL_BYTES = 20 * 1024 * 1024;

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Cannot read the file'));
    r.readAsText(file);
  });
}

/** Opens a SQL script in a new console (on the active tab's connection), like File > Open. */
export async function openSqlFileInConsole(file: File): Promise<boolean> {
  if (file.size > MAX_SQL_BYTES) {
    toast('warning', `"${file.name}" is too large to open in the editor`, 'SQL files over 20 MB are not opened. Run them with the command line tools instead.');
    return false;
  }
  try {
    const text = await readText(file);
    const id = newConsole(undefined, undefined, text);
    const path = pathOfFile(file);
    if (path) useTabs.getState().markSaved(id, path, file.name);
    else useTabs.getState().rename(id, file.name);
    return true;
  } catch (e) {
    toast('error', `Could not read "${file.name}"`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * Routes files dropped on the window. Returns what was started (for tests and the caller's bookkeeping): wizards opened
 * synchronously, SQL files being read.
 */
export function handleWindowDrop(files: readonly File[], target: DropTarget = resolveDropTarget()): { wizards: number; sql: number } {
  const { data, sql, other } = classifyFiles(files);
  if (other.length > 0) toastUnsupported(other.map((f) => f.name));
  let wizards = 0;
  if (data.length > 0) {
    // handleImportDrop reports its own problems (too many files, unknown paths)
    if (handleImportDrop(data, target.ctx)) wizards = Math.min(data.length, MAX_DROP_WIZARDS);
  }
  const sqlFiles = sql.slice(0, MAX_DROP_WIZARDS);
  if (sql.length > MAX_DROP_WIZARDS) toast('info', `Opened ${MAX_DROP_WIZARDS} of ${sql.length} SQL files`, 'Drop the remaining files again to open them.');
  for (const f of sqlFiles) void openSqlFileInConsole(f);
  return { wizards, sql: sqlFiles.length };
}
