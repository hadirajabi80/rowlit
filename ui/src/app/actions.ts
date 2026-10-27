// App-level commands that coordinate several stores (run, transactions, tabs, export).
import { api, errorMessage, isApiError } from '../api/client';
import type { ExportFormat, ObjectRef, QueryParam, RunLabel, SessionInfo, SqlBatch, TxMode } from '../api/types';
import type { CloseResourcesResult, ResourceBusyDetail } from '../api/resources';
import { resolveParams } from '../components/ParamsDialog/ParamsDialog';
import { findDestructive } from '../lib/classify';
import { EXPORT_EXT, EXPORT_FILTER_NAME, EXPORT_MIME } from '../lib/exportFormats';
import { serializeRows, type CopyFormat } from '../lib/serialize';
import { computeView } from '../lib/filter';
import { isTabular, qualifiedName, selectTopSql } from '../lib/sql';
import { getPlatform } from '../platform';
import { effectiveViewportHeight } from './zoom';
import { dbKey, useCatalog } from '../store/catalog';
import { getSourceModule } from '../lib/sources';
import { dialectOf, getConnection, providerKind, schemaIsDatabase, useConnections } from '../store/connections';
import { ensureDialect } from '../intel/dialect/registry';
import { useSourceClients } from '../store/sourceClients';
import { useHistory } from '../store/history';
import { useEdits } from '../store/edits';
import { useResources } from '../store/resources';
import { useExplorer } from '../components/Explorer/explorerStore';
import { pendingGrids } from './pendingGrids';
import { useResults, viewKey } from '../store/results';
import { createExecution, isRunning, type ExecutionState, type ResultSetState } from '../store/resultsReducer';
import { isForeignSession, useSessions } from '../store/sessions';
import { openRoutinesInEditMode, useSettings } from '../store/settings';
import { isPinnedTab, useTabs, type ConsoleTab } from '../store/tabs';
import { SHORT_WINDOW, toast, useUi } from '../store/ui';
import { displayShortcut } from '../commands/keys';
import { pluralize } from '../components/common/text';
import { getTabView } from '../components/layout/tabViews';
import { outputMessages, revealResultsForRun, showResults } from '../components/ResultsPane/dock';
import { runEditTab } from '../designer/editRun';
import { editSessionOf, peekEditSession, rememberEdit } from '../designer/editSession';
import { EDIT_RUN_STOP_REASON, useDesignerUi, type EditSession } from '../designer/store';
import { existingObjectNamed, newObjectRef } from '../designer/newObject';
import { getEditor } from './editors';
import { interceptRoutineRun, routineEditOf } from '../components/ExecuteRoutine/intercept';
import { hasCommand, runCommand } from '../commands/registry';

let localSeq = 0;

function consoleTab(tabId: string): ConsoleTab | undefined {
  const t = useTabs.getState().tabs.find((x) => x.id === tabId);
  return t?.kind === 'console' ? t : undefined;
}

/** Database the tab effectively uses: its own choice, else the connection's current database. */
export function effectiveDatabase(connectionId: string | null, database: string | null): string | null {
  if (!connectionId) return null;
  const c = getConnection(connectionId);
  // M2: Redis/MongoDB/Kafka have no SQL database.
  if (c && providerKind(c.providerId) !== 'relational') return null;
  if (database) return database;
  if (schemaIsDatabase(c?.providerId)) return null;
  return useCatalog.getState().conns[connectionId]?.databases?.current ?? null;
}

/**
 * Catalog cache key for a tab's database. Oracle (and the Batch 3 single-level providers: MySQL/MariaDB, ClickHouse,
 * Cassandra) have no database level (the tab's "database" is the session's current schema/database/keyspace), so
 * their catalog is always keyed by null.
 */
export function catalogDatabase(connectionId: string | null, database: string | null): string | null {
  if (!connectionId) return null;
  const c = getConnection(connectionId);
  if (schemaIsDatabase(c?.providerId) || (c && providerKind(c.providerId) !== 'relational')) return null;
  return effectiveDatabase(connectionId, database);
}

export function effectiveMaxRows(tab: ConsoleTab): number {
  return tab.maxRows ?? useSettings.getState().settings.results.maxRows;
}

export interface RunOptions {
  maxRows?: number;
  /**
   * The user explicitly allowed this run to change data. Only ever set from an explicit confirmation (the destructive
   * statement dialog on a writable connection, or the armed read-only override); never implied.
   */
  confirmedDestructive?: boolean;
  /** Bind values already collected (e.g. on a retry); skips the parameters dialog. */
  params?: QueryParam[];
  /** Run the batches as given even in an "Edit:" tab (the atomic designer apply is skipped). */
  plain?: boolean;
  /**
   * The batches are not the console's editor text (Execute routine runs its call in the current console): their
   * error lines are not marked in the editor.
   */
  detached?: boolean;
  /**
   * Do not open the results pane for this run (saving an object: its messages are shown as a toast); a failure still
   * opens it, on Messages.
   */
  quiet?: boolean;
}

/**
 * READ_ONLY refusal: the engine rejected a statement on a connection marked read-only. There is no one-click
 * "Run anyway": the danger button only enables after ticking "Allow this statement to write to <name>", and Cancel
 * has the focus. Returns true when the user armed and confirmed the override.
 */
export async function askReadOnlyOverride(connectionName: string, detail: string, what = 'statement'): Promise<boolean> {
  const r = await useUi.getState().askConfirmAck({
    title: 'Read-only connection',
    message: `“${connectionName}” is marked read-only, and the engine refused a ${what} that changes data. Change the connection settings to allow writes permanently.`,
    items: [detail],
    confirmLabel: 'Run with writes',
    danger: true,
    ack: { label: `Allow this ${what} to write to “${connectionName}”`, required: true },
  });
  return r.ok && r.ack;
}

export async function runInTab(tabId: string, label: RunLabel, batches: SqlBatch[], opts: RunOptions = {}): Promise<void> {
  const tab = consoleTab(tabId);
  if (!tab) return;
  // F4 "Edit:" consoles on SQLite apply the whole script atomically through the designer (a failing CREATE must not
  // leave the object dropped). The registration is persisted in the tab, so a tab restored after a restart does too.
  if (!opts.plain && peekEditSession(tabId) && (await runEditTab(tabId))) return;
  if (batches.length === 0 || batches.every((b) => !b.sql.trim())) return;
  const ui = useUi.getState();
  if (!tab.connectionId) {
    toast('warning', 'Choose a connection for this console first');
    return;
  }
  const conn = getConnection(tab.connectionId);
  if (!conn) {
    toast('error', 'The connection of this console no longer exists');
    return;
  }
  const running = useResults.getState().executions[useResults.getState().byTab[tabId]];
  if (isRunning(running)) {
    toast('warning', 'A query is already running in this console', 'Cancel it first (Esc) or open another console.');
    return;
  }

  let confirmed = opts.confirmedDestructive ?? false;
  const dialect = dialectOf(conn.id);
  if (!confirmed && !conn.readOnly && useSettings.getState().settings.confirmDestructive) {
    const findings = findDestructive(batches, dialect);
    if (findings.length) {
      const ok = await ui.askConfirm({
        title: 'Run destructive statement?',
        message: `This will modify data on “${conn.name}”. Review what is about to run:`,
        items: findings.map((f) => `Line ${f.line}: ${f.description}`),
        confirmLabel: 'Run anyway',
        danger: true,
      });
      if (!ok) return;
      confirmed = true;
    }
  }

  // Statements with bind parameters (@id, :id, ?, $1) ask for values first; null = the user cancelled.
  const params = opts.params ?? await resolveParams(tabId, conn.id, dialect, batches);
  if (params === null) return;

  const maxRows = opts.maxRows ?? effectiveMaxRows(tab);
  const localId = `l${++localSeq}`;
  useResults.getState().begin(createExecution({
    localId, tabId, connectionId: conn.id, sessionId: useSessions.getState().byTab[tabId] ?? null, label, batches, maxRows,
    confirmedDestructive: confirmed, params: params ?? null, detached: opts.detached,
  }));
  revealResultsForRun(tabId, localId, opts.quiet);
  noteFirstRun(tabId);

  try {
    const session = await useSessions.getState().ensure(tabId, conn.id, effectiveDatabase(conn.id, tab.database), tab.txMode, tab.schema);
    useConnections.getState().touch(conn.id);
    const res = await api.execute(session.sessionId, {
      batches, maxRows, stopOnError: true, label, source: { tabId, title: tab.title },
      ...(confirmed ? { confirmedDestructive: true } : {}),
      ...(params?.length ? { params } : {}),
    });
    useResults.getState().attach(localId, res.executionId);
  } catch (e) {
    if (isApiError(e, 'READ_ONLY') && !confirmed) {
      useResults.getState().fail(localId, errorMessage(e), 'READ_ONLY');
      if (await askReadOnlyOverride(conn.name, errorMessage(e))) {
        await runInTab(tabId, label, batches, { ...opts, confirmedDestructive: true, params: params ?? [] });
      }
      return;
    }
    if (isApiError(e, 'SESSION_LIMIT')) {
      // The toast carries the advice and the action; the message pane shows the engine's text once.
      useResults.getState().fail(localId, errorMessage(e), 'SESSION_LIMIT');
      offerCloseIdle(conn.id, () => void runInTab(tabId, label, batches, { ...opts, confirmedDestructive: confirmed, params: params ?? [] }));
      return;
    }
    const hint = isApiError(e, 'SESSION_BUSY') ? 'The session is busy with another statement.' : undefined;
    useResults.getState().fail(localId, hint ? `${errorMessage(e)} ${hint}` : errorMessage(e), isApiError(e) ? e.code : null);
  }
}

/**
 * Run from toolbar / palette / global shortcut: ask the editor what to run. In an "Edit:" console of a procedure or
 * function, Run without a selection opens Execute routine instead of re-running the CREATE (applying it is Save);
 * `asScript` runs the editor text anyway (the Run button's "Run script" menu item).
 */
export function runActive(label: RunLabel, opts: { asScript?: boolean } = {}): void {
  const tabId = useTabs.getState().activeId;
  if (!tabId || !consoleTab(tabId)) return;
  if (!opts.asScript && routineEditOf(tabId)) {
    const target = getEditor(tabId)?.getRunTarget(label);
    if (target?.label === 'selection') void runInTab(tabId, 'selection', target.batches);
    else interceptRoutineRun(tabId, label);
    return;
  }
  const edit = peekEditSession(tabId);
  if (edit) {
    void runEditTab(tabId).then(async (handled) => {
      if (handled) return;
      // A New procedure/function console holds CREATE OR ALTER / OR REPLACE: running it must not overwrite an
      // existing object that has the same name (Save refuses it too).
      if (edit.isNew && label !== 'selection' && (await newObjectNameTaken(tabId))) return;
      runTargetOf(tabId, label);
    });
    return;
  }
  runTargetOf(tabId, label);
}

/** For a New-object console: true (and an error toast) when the script's object name is already taken. */
async function newObjectNameTaken(tabId: string): Promise<boolean> {
  const session = editSessionOf(tabId);
  const tab = consoleTab(tabId);
  if (!session?.isNew || !tab || tab.connectionId !== session.connectionId) return false;
  const edit = { ...session, ref: newObjectRef(getEditor(tabId)?.getValue() ?? tab.text, session) };
  rememberEdit(tabId, edit);
  const taken = await existingObjectNamed(edit);
  if (!taken) return false;
  toast('error', `${qualifiedName(edit.ref, edit.dialect)} already exists`,
    `A ${OBJECT_NOUN[taken] ?? taken} with this name is already in the database, so nothing was changed. Rename it in the script, or open the existing one with Edit (F4).`);
  return true;
}

function runTargetOf(tabId: string, label: RunLabel): void {
  const ed = getEditor(tabId);
  const target = ed?.getRunTarget(label);
  if (!target) {
    toast('info', 'Nothing to run');
    return;
  }
  void runInTab(tabId, label, target.batches);
}

export async function rerun(tabId: string, opts: RunOptions = {}): Promise<void> {
  const e = useResults.getState().executions[useResults.getState().byTab[tabId]];
  if (!e) return;
  // A re-run asks again: a write override confirmed for one run is never carried over implicitly.
  await runInTab(tabId, e.label, e.batches, { plain: true, detached: e.detached, ...opts });
}

/**
 * Why the running query of a tab cannot be cancelled, or null when it can (or nothing runs). An "Edit:" console's
 * atomic apply (designer/editRun.ts) is one engine request without a session: it cannot be stopped, so the Stop button
 * is disabled with this reason as its tooltip.
 */
export function cancelBlockedReason(tabId: string | null = useTabs.getState().activeId): string | null {
  return tabId && useDesignerUi.getState().editRunInFlight[tabId] ? EDIT_RUN_STOP_REASON : null;
}

/** Cancel the running query of a tab. Returns the reason when it cannot be cancelled (see cancelBlockedReason). */
export async function cancelTab(tabId: string | null = useTabs.getState().activeId): Promise<string | null> {
  if (!tabId) return null;
  const blocked = cancelBlockedReason(tabId);
  if (blocked) {
    toast('info', 'This change cannot be stopped', `${blocked}.`);
    return blocked;
  }
  const s = useSessions.getState().forTab(tabId);
  const e = useResults.getState().executions[useResults.getState().byTab[tabId]];
  if (!s || !isRunning(e)) return null;
  try {
    await api.cancel(s.sessionId);
  } catch (err) {
    toast('error', 'Cancel failed', errorMessage(err));
  }
  return null;
}

export async function setTxMode(tabId: string, mode: TxMode): Promise<void> {
  const s = useSessions.getState().forTab(tabId);
  if (s?.txOpen && mode === 'auto') {
    toast('warning', 'Commit or roll back the open transaction before switching to Auto-commit');
    return;
  }
  useTabs.getState().setTxMode(tabId, mode);
  try {
    await useSessions.getState().setTxMode(tabId, mode);
  } catch (e) {
    toast('error', 'Could not change transaction mode', errorMessage(e));
  }
}

export async function commitTab(tabId: string | null = useTabs.getState().activeId): Promise<void> {
  if (!tabId) return;
  try {
    await useSessions.getState().commit(tabId);
    toast('success', 'Transaction committed');
  } catch (e) {
    toast('error', 'Commit failed', errorMessage(e));
  }
}

export async function rollbackTab(tabId: string | null = useTabs.getState().activeId): Promise<void> {
  if (!tabId) return;
  try {
    await useSessions.getState().rollback(tabId);
    toast('info', 'Transaction rolled back');
  } catch (e) {
    toast('error', 'Rollback failed', errorMessage(e));
  }
}

/** Switch a console to another connection/database. Closes the old session (asking first when a tx is open). */
export async function switchConnection(tabId: string, connectionId: string | null, database: string | null = null): Promise<void> {
  const tab = consoleTab(tabId);
  if (!tab) return;
  const s = useSessions.getState().forTab(tabId);
  if (s && s.connectionId !== connectionId) {
    if (s.txOpen) {
      const ok = await useUi.getState().askConfirm({
        title: 'Open transaction',
        message: 'This console has an uncommitted transaction. Switching connection rolls it back.',
        confirmLabel: 'Roll back and switch',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await useSessions.getState().close(tabId, true);
    } catch (e) {
      console.warn('[tabs] closing old session failed', e);
    }
    useResults.getState().clearTab(tabId);
  }
  useTabs.getState().setConnection(tabId, connectionId, database);
  if (connectionId) void preloadCatalog(connectionId, database);
}

export async function switchDatabase(tabId: string, database: string | null): Promise<void> {
  const tab = consoleTab(tabId);
  if (!tab) return;
  useTabs.getState().setDatabase(tabId, database);
  if (tab.connectionId) void preloadCatalog(tab.connectionId, database);
  if (database && useSessions.getState().forTab(tabId)) {
    try {
      await useSessions.getState().changeDatabase(tabId, database);
    } catch (e) {
      toast('error', 'Could not change database', errorMessage(e));
    }
  }
}

/**
 * Chooses the console's default schema (schema switcher). PostgreSQL / Snowflake: the session runs SET search_path /
 * USE SCHEMA (applied on the next run when there is no session yet) and the tab remembers it; SQL Server: only the tab's
 * "Editor schema" for IntelliSense changes. null returns to the server's own default.
 */
export async function switchSchema(tabId: string, schema: string | null): Promise<void> {
  const tab = consoleTab(tabId);
  if (!tab) return;
  try {
    await useSessions.getState().changeSchema(tabId, schema);
  } catch (e) {
    toast('error', 'Could not change schema', errorMessage(e));
  }
}

export async function preloadCatalog(connectionId: string, database: string | null): Promise<void> {
  // M2: non-relational sources have no SQL catalog (their module loads its own data).
  const c = getConnection(connectionId);
  if (c && providerKind(c.providerId) !== 'relational') return;
  const cat = useCatalog.getState();
  cat.reopen(connectionId); // every caller is the user opening / switching / connecting: a closed connection opens again
  await cat.loadDatabases(connectionId);
  await cat.ensureDefault(connectionId, catalogDatabase(connectionId, database));
}

export async function closeTab(tabId: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab || isPinnedTab(tab)) return; // the Objects tab is never closed
  const s = useSessions.getState().forTab(tabId);
  const exec = useResults.getState().executions[useResults.getState().byTab[tabId]];
  if (s?.txOpen || isRunning(exec)) {
    const ok = await useUi.getState().askConfirm({
      title: s?.txOpen ? 'Uncommitted transaction' : 'Query running',
      message: s?.txOpen
        ? `“${tab.title}” has an open transaction. Closing the console rolls it back.`
        : `A query is still running in “${tab.title}”. Closing the console cancels it.`,
      confirmLabel: s?.txOpen ? 'Roll back and close' : 'Cancel and close',
      danger: true,
    });
    if (!ok) return;
  } else if (tab.kind === 'console' && tab.filePath && tab.text !== tab.savedText) {
    const ok = await useUi.getState().askConfirm({
      title: 'Unsaved changes',
      message: `“${tab.title}” has changes that are not saved to ${tab.filePath}.`,
      confirmLabel: 'Close without saving',
      danger: true,
    });
    if (!ok) return;
  } else if (tab.kind === 'console' && tab.savedQuery && tab.text !== tab.savedText) {
    // A console bound to a saved query (components/SavedQueries): Ctrl+S writes it back.
    const ok = await useUi.getState().askConfirm({
      title: 'Unsaved changes',
      message: `“${tab.title}” has changes that are not saved to the query ${tab.savedQuery.name}.`,
      confirmLabel: 'Close without saving',
      danger: true,
    });
    if (!ok) return;
  } else if (tab.kind === 'view') {
    const def = getTabView(tab.view);
    if (def?.beforeClose) {
      if (!(await def.beforeClose(tab))) return;
    } else if (tab.dirty) {
      const ok = await useUi.getState().askConfirm({
        title: 'Discard changes?',
        message: `“${tab.title}” has changes that were not applied.`,
        confirmLabel: 'Discard and close',
        danger: true,
      });
      if (!ok) return;
    }
  }
  useTabs.getState().close(tabId);
  if (tab.kind === 'view') getTabView(tab.view)?.onClosed?.(tab);
  useResults.getState().clearTab(tabId);
  if (s) {
    try {
      await useSessions.getState().close(tabId, true);
    } catch (e) {
      console.warn('[tabs] session close failed', e);
    }
  }
}

export function newConsole(connectionId?: string | null, database?: string | null, text?: string): string {
  const active = useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId);
  const cid = connectionId === undefined ? active?.connectionId ?? useConnections.getState().connections[0]?.id ?? null : connectionId;
  const db = database === undefined ? (active?.connectionId === cid ? active?.database ?? null : null) : database;
  const id = useTabs.getState().newConsole({ connectionId: cid, database: db, text });
  if (cid) void preloadCatalog(cid, db);
  setTimeout(() => getEditor(id)?.focus(), 50);
  return id;
}

export function selectTop(connectionId: string, database: string | null, ref: ObjectRef, n = 1000): void {
  const dialect = dialectOf(connectionId);
  const defaultSchema = useCatalog.getState().dbs[dbKey(connectionId, catalogDatabase(connectionId, database))]?.defaultSchema ?? null;
  const sql = selectTopSql(ref, dialect, n, defaultSchema);
  const id = useTabs.getState().newConsole({ connectionId, database, text: sql, title: ref.name });
  void preloadCatalog(connectionId, database);
  void runInTab(id, 'statement', [{ sql: sql.replace(/;\s*$/, ''), line: 1, col: 1 }]);
}

export function openObject(connectionId: string, database: string | null, ref: ObjectRef, column?: string | null): void {
  useTabs.getState().openObject(connectionId, database, ref, column);
}

/** Types "Open procedures and functions in edit mode" opens in an F4 "Edit:" console (the designer's script edit path). */
const EDIT_ON_OPEN = new Set<string>(['proc', 'func', 'tablefunc', 'package', 'trigger']);

/**
 * The default "open" of an object (explorer double-click / Enter, Ctrl+P Enter). With "Open procedures and functions
 * in edit mode" on, routines (and packages and triggers, which take the same script edit path) open in their "Edit:"
 * console, and an already open one comes to the front; everything else, and every object with the setting off, opens
 * the read-only object tab. Explicit commands (Edit / F4, Open DDL) do not come through here.
 */
export function activateObject(connectionId: string, database: string | null, ref: ObjectRef, column?: string | null): void {
  if (!column && EDIT_ON_OPEN.has(ref.type) && openRoutinesInEditMode()) {
    const open = useTabs.getState().tabs.find((t) => {
      const e = t.kind === 'console' ? peekEditSession(t.id) : undefined;
      return !!e && e.connectionId === connectionId && e.ref.type === ref.type && e.ref.name === ref.name && (e.ref.schema ?? null) === (ref.schema ?? null);
    });
    if (open) {
      useTabs.getState().activate(open.id);
      return;
    }
    if (runCommand('designer.edit', { kind: 'object', connectionId, database, ref })) return;
  }
  openObject(connectionId, database, ref, column);
}

/**
 * What a click (double-click / Enter) on an object does, from every list that shows objects (explorer, Objects tab,
 * Find in database, Ctrl+P, dependencies): a table, view, materialized view, synonym or ClickHouse dictionary opens its
 * DATA (the Data tab), never its structure; routines and the rest keep the default open of `activateObject`. With a
 * `column` (a column row, a column search hit) the object tab opens on that column.
 */
export function openObjectDefault(connectionId: string, database: string | null, ref: ObjectRef, column?: string | null): void {
  // A table function is a routine: `SELECT * FROM fn` needs its arguments, so it opens like one (editor / structure).
  if (!column && ref.type !== 'tablefunc' && isTabular(ref.type, dialectOf(connectionId))) {
    const target = { kind: 'object' as const, connectionId, database, ref };
    if (hasCommand('data.open') && runCommand('data.open', target)) return;
    // The data view could not start (never silently): say so, and fall back to the object's structure.
    toast('error', `Could not open the data of ${ref.name}`, 'The table data view is not available; showing its structure instead.');
  }
  activateObject(connectionId, database, ref, column);
}

export function reopenSql(sql: string, connectionId: string | null, database: string | null): void {
  newConsole(connectionId, database, sql);
}

export function insertIntoActiveEditor(text: string): void {
  const ed = getEditor(useTabs.getState().activeId);
  if (ed) {
    ed.insertText(text);
    ed.focus();
  }
}

// ---------------- results: copy & export ----------------

export function visibleRows(exec: ExecutionState, rs: ResultSetState) {
  const view = useResults.getState().views[viewKey(exec.localId, rs.id)];
  const idx = view ? computeView(rs.rows, rs.columns, view) : null;
  if (!idx) return rs.rows.toArray();
  return Array.from(idx, (i) => rs.rows.get(i)!);
}

export async function copyText(text: string, what = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', what);
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('success', what);
  }
}


/** Export a result set: engine-side via ResultStore when possible, else from the rows the UI already has. */
export async function exportResultSet(exec: ExecutionState, rs: ResultSetState, format: ExportFormat): Promise<void> {
  const platform = getPlatform();
  const base = (rs.columns.find((c) => c.table)?.table ?? `result_${rs.id + 1}`).replace(/[^\p{L}\p{N}_.-]+/gu, '_');
  const name = `${base}.${EXPORT_EXT[format]}`;
  const filters = [{ name: EXPORT_FILTER_NAME[format], extensions: [EXPORT_EXT[format]] }];
  const nullAs = format === 'csv' ? '' : undefined;
  const view = useResults.getState().views[viewKey(exec.localId, rs.id)];
  const hasView = !!view && (view.quickFilter || view.filter || view.sort.length);
  try {
    if (exec.executionId && !hasView) {
      if (platform.hasFileSystem) {
        const path = await platform.showSaveDialog({ title: 'Export result set', defaultPath: name, filters });
        if (!path) return;
        const r = await api.exportResultSet(exec.executionId, rs.id, { format, path, options: { header: true, nullAs } });
        toast('success', `Exported ${pluralize('rows' in r ? r.rows : rs.rowCount, 'row')}`, 'path' in r ? r.path : undefined);
        return;
      }
      const r = await api.exportResultSet(exec.executionId, rs.id, { format, path: null, options: { header: true, nullAs } });
      if ('blob' in r) {
        await platform.saveFile({ suggestedName: r.filename ?? name, content: r.blob, mime: EXPORT_MIME[format] });
        toast('success', `Exported ${r.filename ?? name}`);
        return;
      }
    }
  } catch (e) {
    console.warn('[export] engine export failed, falling back to client-side export', e);
  }
  const content = format === 'xlsx'
    ? (await import('../components/Grid/clientExport').then((m) => m.rowsToXlsx(rs.columns, visibleRows(exec, rs), { sheetName: base }))).blob
    : serializeRows(format satisfies CopyFormat, rs.columns, visibleRows(exec, rs), { dialect: dialectOf(exec.connectionId), header: true });
  const saved = await platform.saveFile({ suggestedName: name, content, mime: EXPORT_MIME[format], filters });
  if (saved) toast('success', `Exported ${saved}`);
}

// ---------------- files ----------------

export async function openSqlFile(): Promise<void> {
  const f = await getPlatform().openTextFile({ filters: [{ name: 'SQL', extensions: ['sql', 'txt'] }] });
  if (!f) return;
  const id = newConsole(undefined, undefined, f.content);
  useTabs.getState().markSaved(id, f.path, f.name);
}

export const OBJECT_NOUN: Record<string, string> = {
  proc: 'procedure', func: 'function', tablefunc: 'function', view: 'view', mview: 'materialized view',
  trigger: 'trigger', package: 'package', type: 'type', table: 'table',
};

/**
 * Ctrl+S in an F4 "Edit:" console: save the object's changes to the database, like SSMS / Navicat / DataGrip (the
 * console holds CREATE OR ALTER / CREATE OR REPLACE / DROP+CREATE for the object). SQLite views and triggers take the
 * atomic apply (runEditTab); everything else runs the whole script on the tab's session. Saving the text to a .sql
 * file stays on Save as (Ctrl+Shift+S).
 */
export async function saveEditToDatabase(tabId: string): Promise<void> {
  const session = editSessionOf(tabId);
  const tab = consoleTab(tabId);
  if (!session || !tab) return;
  // A new object (wizard console): its name comes from the script, which the user may have changed.
  const edit = session.isNew ? { ...session, ref: newObjectRef(getEditor(tabId)?.getValue() ?? tab.text, session) } : session;
  if (session.isNew) rememberEdit(tabId, edit);
  const noun = OBJECT_NOUN[edit.ref.type] ?? edit.ref.type;
  // CREATE OR ALTER / CREATE OR REPLACE would overwrite an object that already has this name: refuse instead.
  if (edit.isNew && (await newObjectNameTaken(tabId))) return;
  if (tab.connectionId !== edit.connectionId) {
    toast('warning', `This console no longer points at ${edit.ref.name}'s connection`, 'Switch the connection back to save, or use Save as… to write a .sql file.');
    return;
  }
  if (await runEditTab(tabId)) return; // SQLite view/trigger: atomic apply with its own toasts
  // The whole CREATE / ALTER, never just the selection: a selected statement must not be "saved" on its own.
  const target = getEditor(tabId)?.getRunTarget('script', { ignoreSelection: true });
  if (!target) {
    toast('info', 'Nothing to save');
    return;
  }
  const before = useResults.getState().byTab[tabId];
  // The text being saved: the "unsaved changes" dot of the toolbar's Save button compares with it.
  const savedText = getEditor(tabId)?.getValue() ?? tab.text;
  // Quiet: saving produces messages, not a result worth the editor's space. They come back as a compact toast below; only
  // an error (or rows) opens the results pane.
  await runInTab(tabId, 'script', target.batches, { quiet: true });
  const id = useResults.getState().byTab[tabId];
  if (!id || id === before) return; // did not start (cancelled confirm, no connection…): runInTab already said why
  let settled = false; // showResults below changes the results store, which calls settle again
  const settle = (e: ExecutionState | undefined): boolean => {
    if (!e || isRunning(e)) return false;
    if (settled) return true;
    settled = true;
    if (e.status === 'ok') {
      if (edit.isNew) {
        toast('success', `Created ${noun} ${edit.ref.name}`, withMessages(`${displayShortcut('Mod+S')} saves further changes to the database.`, e), showMessagesAction(tabId, e));
        promoteNewEdit(tabId, edit);
      } else {
        toast('success', `Saved ${noun} ${edit.ref.name}`, withMessages('The changes were applied to the database.', e), showMessagesAction(tabId, e));
      }
      // Only the object's schema, revalidated in place: the explorer keeps its rows (no full refresh, no flash).
      void useCatalog.getState().revalidate(edit.connectionId, catalogDatabase(edit.connectionId, edit.ref.database ?? edit.database), [edit.ref.schema]);
      // New "Compare with server" baseline.
      void api.ddl(edit.connectionId, edit.database, edit.ref)
        .then((d) => { if (peekEditSession(tabId)) rememberEdit(tabId, { ...edit, isNew: false, serverDdl: d.ddl, savedText }); })
        .catch(() => { if (peekEditSession(tabId)) rememberEdit(tabId, { ...edit, isNew: false, savedText }); });
    } else if (e.status === 'error') {
      showResults(tabId, 'messages');
      toast('error', `${edit.ref.name} was not saved`, firstErrorLine(e) ?? 'The database reported an error; see Messages for the line.');
    }
    return true;
  };
  if (settle(useResults.getState().executions[id])) return;
  const unsub = useResults.subscribe((s) => { if (settle(s.executions[id])) unsub(); });
}

/** The first message of a finished run, shortened, with how many more there are ("Line 4: …" for a located one). */
function messageSummary(e: ExecutionState): string | null {
  const list = outputMessages(e);
  if (!list.length) return null;
  const m = list[0];
  const text = m.text.trim().replace(/\s+/g, ' ');
  const head = text.length > 140 ? `${text.slice(0, 139)}…` : text;
  return `${m.line ? `Line ${m.line}: ` : ''}${head}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`;
}

/** The toast detail of a save: what it did, plus the server's own messages (PRINT, NOTICE, warnings) when it sent any. */
function withMessages(base: string, e: ExecutionState): string {
  const note = messageSummary(e);
  return note ? `${base} Server: ${note}` : base;
}

/** "Show messages" on a toast, when the run has messages or rows the toast cannot hold. */
function showMessagesAction(tabId: string, e: ExecutionState): { label: string; run: () => void } | undefined {
  if (e.resultSets.length) return { label: 'Show results', run: () => showResults(tabId) };
  return outputMessages(e).length ? { label: 'Show messages', run: () => showResults(tabId, 'messages') } : undefined;
}

/** "Line 7: ORA-…" of the first error message of a failed run. */
function firstErrorLine(e: ExecutionState): string | null {
  const m = e.messages.find((x) => x.severity === 'error' && x.text.trim());
  if (!m) return null;
  const t = m.text.trim().replace(/\s+/g, ' ');
  return `${m.line ? `Line ${m.line}: ` : ''}${t.length > 200 ? `${t.slice(0, 199)}…` : t}`;
}

/** After a new object was created: an ordinary "Edit:" console from now on (Run executes routines, Save alters). */
export function promoteNewEdit(tabId: string, edit: EditSession): void {
  rememberEdit(tabId, { ...edit, isNew: false });
  const tab = consoleTab(tabId);
  if (tab?.title.startsWith('New: ')) useTabs.getState().rename(tabId, `Edit: ${edit.ref.name}`);
}

export async function saveActiveFile(saveAs = false): Promise<void> {
  const tab = consoleTab(useTabs.getState().activeId ?? '');
  if (!tab) return;
  const p = getPlatform();
  if (p.hasFileSystem) {
    let path = saveAs ? null : tab.filePath;
    if (!path) path = await p.showSaveDialog({ title: 'Save SQL file', defaultPath: `${tab.title}.sql`, filters: [{ name: 'SQL', extensions: ['sql'] }] });
    if (!path) return;
    await p.writeTextFile(path, tab.text);
    useTabs.getState().markSaved(tab.id, path, path.split(/[\\/]/).pop());
  } else {
    await p.saveFile({ suggestedName: tab.title.endsWith('.sql') ? tab.title : `${tab.title}.sql`, content: tab.text, mime: 'application/sql' });
    useTabs.getState().markSaved(tab.id, null);
  }
}

export function refreshHistorySoon(): void {
  useHistory.getState().reloadSoon();
}

// ---------------- M1.5: connections, onboarding ----------------

/** Idle consoles (no running query, no open transaction) holding a session on the connection. */
export function idleSessionTabs(connectionId: string): string[] {
  const { sessions, byTab } = useSessions.getState();
  const active = useTabs.getState().activeId;
  return Object.entries(byTab)
    .filter(([tabId, sid]) => {
      const s = sessions[sid];
      if (!s || s.connectionId !== connectionId || s.txOpen || s.state === 'executing' || tabId === active) return false;
      return !isRunning(useResults.getState().executions[useResults.getState().byTab[tabId]]);
    })
    .map(([tabId]) => tabId);
}

/** Sessions on the connection no open tab owns and that are safe to close (no transaction, not running). */
export function releasableOrphans(connectionId: string): string[] {
  return useSessions.getState().orphans(connectionId).filter((s) => !s.txOpen && s.state !== 'executing').map((s) => s.sessionId);
}

/**
 * SESSION_LIMIT: offer to release the sessions of idle consoles and unused (orphaned) sessions on that connection,
 * then run again (`rerun`).
 */
export function offerCloseIdle(connectionId: string, rerun?: () => void): void {
  const idle = idleSessionTabs(connectionId);
  const orphans = releasableOrphans(connectionId);
  const n = idle.length + orphans.length;
  const limit = useSettings.getState().settings.connections.maxSessionsPerProfile;
  const held = [idle.length ? pluralize(idle.length, 'idle console') : '', orphans.length ? pluralize(orphans.length, 'unused session') : '']
    .filter(Boolean).join(' and ');
  const conn = getConnection(connectionId)?.name ?? 'this connection';
  toast('warning', `Session limit reached (${limit} per connection)`,
    n ? `${held} on “${conn}” hold a session.` : `Close a console on “${conn}” first.`,
    n
      ? {
          label: rerun ? `Release ${pluralize(n, 'unused session')} and run again` : `Release ${pluralize(n, 'unused session')}`,
          run: () => {
            void Promise.all([
              ...idle.map((t) => useSessions.getState().close(t, true).catch(() => undefined)),
              ...orphans.map((sid) => useSessions.getState().closeSession(sid, false).catch(() => undefined)),
            ]).then(() => {
              if (rerun) rerun();
              else toast('success', `Released ${pluralize(n, 'session')}`, 'Run the statement again.');
            });
          },
        }
      : undefined);
}

/** Short windows: after the first run of a console, give the results 60 % of the height (unless the user chose). */
function noteFirstRun(tabId: string): void {
  if (typeof window === 'undefined' || effectiveViewportHeight() >= SHORT_WINDOW) return;
  const ui = useUi.getState();
  if (ui.tabSplits[tabId] === undefined) ui.setTabSplit(tabId, 0.6);
}

/**
 * Sessions this window may close: everything except those another live window uses (isForeignSession). Disconnect
 * and Disconnect all only ever close these (useSessions.closeConnection), so they alone count for the
 * open-transaction prompt, the enablement of the commands and the toast.
 */
export function ownSessions(connectionId?: string): SessionInfo[] {
  return Object.values(useSessions.getState().sessions).filter(
    (s) => !isForeignSession(s) && (!connectionId || s.connectionId === connectionId),
  );
}

/** "1 console has an uncommitted transaction" / "2 sessions have uncommitted transactions" (consoles when all are). */
function uncommittedText(withTx: SessionInfo[]): string {
  const owned = new Set(Object.values(useSessions.getState().byTab));
  const n = withTx.length;
  const noun = withTx.every((s) => owned.has(s.sessionId)) ? 'console' : 'session';
  return n === 1 ? `1 ${noun} has an uncommitted transaction` : `${pluralize(n, noun)} have uncommitted transactions`;
}

const sameDb = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** This window's sessions that "Close connection" / "Close database" release (live ones, on the database when given). */
function closableSessions(connectionId?: string, database?: string | null): SessionInfo[] {
  return ownSessions(connectionId).filter((s) => s.state !== 'closed' && !s.released && (database == null || sameDb(s.database, database)));
}

/** Running console queries of this window on the connection, as confirmation items ("Console 1 — running query, cancelled"). */
function runningItems(connectionId?: string): string[] {
  const { executions } = useResults.getState();
  const tabs = useTabs.getState().tabs;
  return Object.values(executions)
    .filter((e) => isRunning(e) && (!connectionId || e.connectionId === connectionId))
    .map((e) => `${tabs.find((t) => t.id === e.tabId)?.title ?? 'A tab'} — running query, cancelled`);
}

/**
 * Close connection / Close database / Disconnect all with unsaved grid edits (Data tabs, console results): the user
 * saves them, discards them or cancels. True = go on closing. Saving a Data tab reopens its connection for the save and
 * the close then releases it again.
 */
async function resolvePendingEdits(title: string, where: string, connectionId?: string, database?: string | null): Promise<boolean> {
  const grids = pendingGrids(connectionId, database);
  if (!grids.length) return true;
  const canSave = grids.every((g) => g.save);
  const n = grids.length;
  const message = n === 1
    ? `“${grids[0].title}” has row changes that are not saved${where}.`
    : `${n} grids have row changes that are not saved${where}.`;
  const items = n > 1 ? grids.map((g) => g.title) : undefined;
  let choice: 'ok' | 'alt' | 'cancel';
  if (canSave) {
    choice = await useUi.getState().askConfirmChoice({ title, message: `${message} Save them before closing, or discard them.`, items, confirmLabel: 'Save', altLabel: 'Discard', cancelLabel: 'Cancel' });
  } else {
    // A console result's edits cannot be saved from here (its grid does that): discard or cancel.
    const ok = await useUi.getState().askConfirm({ title, message: `${message} Save them in their tab first, or discard them to close.`, items, confirmLabel: 'Discard changes', danger: true });
    choice = ok ? 'alt' : 'cancel';
  }
  if (choice === 'cancel') return false;
  if (choice === 'ok') {
    for (const g of grids) {
      let saved = false;
      try {
        saved = (await g.save?.()) ?? false;
      } catch (e) {
        console.warn('[close] saving pending edits failed', e);
      }
      if (!saved) {
        toast('error', `Not closed: “${g.title}” could not be saved`, 'Fix the changes and save again, or discard them.');
        return false;
      }
    }
    return true;
  }
  for (const g of grids) useEdits.getState().revertAll(g.gridKey);
  return true;
}

/** After a successful close: the explorer node folds up (it reloads on the next expand) and the Resources numbers refresh. */
function afterClose(nodeIds: string[]): void {
  const ex = useExplorer.getState();
  for (const id of nodeIds) if (ex.expanded.has(id)) ex.toggle(id, false);
  void useResources.getState().refresh();
}

/**
 * Resources (docs/resources.md): asks the engine to release a connection (or one database), first confirming what
 * that interrupts — this window's open transactions and running queries, then whatever else the engine reports
 * (409 RESOURCE_BUSY: exports, imports, live streams). Null when the user cancelled or the request failed.
 */
async function closeWithConfirm(title: string, what: string, localTx: SessionInfo[], running: string[], call: (force: boolean) => Promise<CloseResourcesResult>): Promise<CloseResourcesResult | null> {
  let force = false;
  if (localTx.length || running.length) {
    const parts = [localTx.length ? `${uncommittedText(localTx)}${what}. Closing rolls ${localTx.length === 1 ? 'it' : 'them'} back.` : null,
      running.length ? `${pluralize(running.length, 'running query', 'running queries')} will be cancelled.` : null].filter(Boolean);
    const ok = await useUi.getState().askConfirm({
      title, message: parts.join(' '), items: localTx.length + running.length > 1 ? [...localTx.map((s) => `${s.label ?? s.sessionId} — uncommitted transaction, rolled back`), ...running] : undefined,
      confirmLabel: localTx.length ? 'Roll back and close' : 'Cancel and close', danger: true,
    });
    if (!ok) return null;
    force = true;
  }
  try {
    return await call(force);
  } catch (e) {
    if (!isApiError(e, 'RESOURCE_BUSY')) {
      toast('error', `Could not close${what}`, errorMessage(e));
      return null;
    }
    const blockers = (e.detail as ResourceBusyDetail | undefined)?.blockers ?? [];
    const ok = await useUi.getState().askConfirm({
      title,
      message: `Closing${what} interrupts ${pluralize(blockers.length, 'operation')}: transactions roll back, queries, exports and imports are cancelled, live views stop.`,
      items: blockers.map((b) => b.label), confirmLabel: 'Interrupt and close', danger: true,
    });
    if (!ok) return null;
    try {
      return await call(true);
    } catch (e2) {
      toast('error', `Could not close${what}`, errorMessage(e2));
      return null;
    }
  }
}

/** "2 sessions released · 1 transaction rolled back · 1 MB of metadata freed". */
function closeDetail(r: CloseResourcesResult): string | undefined {
  const parts = [
    r.sessions ? `${pluralize(r.sessions, 'session')} released` : null,
    r.rolledBack ? `${pluralize(r.rolledBack, 'transaction')} rolled back` : null,
    r.cancelled ? `${pluralize(r.cancelled, 'operation')} cancelled` : null,
    r.streams ? `${pluralize(r.streams, 'live view')} stopped` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Explorer "Close connection" (Navicat-like): the engine releases this window's sessions of the connection (open
 * tabs keep their results and reconnect lazily on the next run), closes its streams, source client and jobs, and drops
 * its catalog cache. Another window's sessions stay open.
 */
export async function disconnectConnection(connectionId: string): Promise<void> {
  const conn = getConnection(connectionId);
  const own = closableSessions(connectionId);
  const where = ` on “${conn?.name ?? 'this connection'}”`;
  if (!(await resolvePendingEdits('Close connection', where, connectionId))) return;
  const r = await closeWithConfirm('Close connection', where, own.filter((s) => s.txOpen), runningItems(connectionId),
    (force) => api.resources.close(connectionId, { force }));
  if (!r) return;
  useSessions.getState().markReleased(own.map((s) => s.sessionId), 'closed');
  // Open tabs stay (their text and rows are kept) but nothing reloads the catalog or reconnects until the user acts.
  useCatalog.getState().close(connectionId);
  if (conn && providerKind(conn.providerId) !== 'relational') {
    // M2: the engine closed the source client (its streams ended); the module drops cached data.
    useSourceClients.getState().apply(connectionId, 'closed');
    getSourceModule(conn.providerId)?.onDisconnect?.(connectionId);
  }
  afterClose([`c:${connectionId}`]);
  toast('info', `Closed ${conn?.name ?? 'the connection'}`, closeDetail(r));
}

/** Explorer "Close database": releases this window's sessions on that database and drops its cached catalog. */
export async function closeDatabase(connectionId: string, database: string | null): Promise<void> {
  const conn = getConnection(connectionId);
  const own = closableSessions(connectionId, database);
  const label = database ?? conn?.name ?? 'the database';
  if (!(await resolvePendingEdits('Close database', ` on “${label}”`, connectionId, database))) return;
  const r = await closeWithConfirm('Close database', ` on “${label}”`, own.filter((s) => s.txOpen), runningItems(connectionId),
    (force) => api.resources.close(connectionId, { database, force }));
  if (!r) return;
  useSessions.getState().markReleased(own.map((s) => s.sessionId), 'closed');
  useCatalog.getState().close(connectionId, database);
  afterClose([`d:${connectionId}:${database ?? ''}`]);
  toast('info', `Closed ${label}`, closeDetail(r));
}

/** Connections ▸ Disconnect all: every connection this window holds or has cached (another window's sessions stay open). */
export async function disconnectAll(): Promise<void> {
  const mine = closableSessions();
  const ids = [...new Set(mine.map((s) => s.connectionId))];
  const cached = Object.keys(useCatalog.getState().conns);
  const all = [...new Set([...ids, ...cached, ...Object.keys(useSourceClients.getState().clients)])];
  if (!all.length) return;
  if (!(await resolvePendingEdits('Disconnect all', ''))) return;
  const r = await closeWithConfirm('Disconnect all', '', mine.filter((s) => s.txOpen), runningItems(), (force) => api.resources.closeAll(force));
  if (!r) return;
  useSessions.getState().markReleased(mine.map((s) => s.sessionId), 'closed');
  for (const cid of all) useCatalog.getState().close(cid);
  for (const cid of Object.keys(useSourceClients.getState().clients)) {
    useSourceClients.getState().apply(cid, 'closed');
    const c = getConnection(cid);
    if (c) getSourceModule(c.providerId)?.onDisconnect?.(cid);
  }
  afterClose(all.map((cid) => `c:${cid}`));
  toast('info', `Disconnected ${pluralize(all.length, 'connection')}`, mine.length ? `${pluralize(mine.length, 'session')} released` : closeDetail(r));
}

/** Explorer folder "Connect all": loads every connection of the folder in parallel (per-root spinners). */
export function connectAllInFolder(folder: string): string[] {
  const list = useConnections.getState().connections.filter((c) => (c.folder ?? '') === folder);
  for (const c of list) void preloadCatalog(c.id, null);
  return list.map((c) => c.id);
}

/** Onboarding: "Try the sample database" (POST /sample-db) → console with a runnable query. */
export async function openSampleDatabase(): Promise<void> {
  try {
    const r = await api.createSampleDb({});
    await useConnections.getState().load();
    const cid = r.connectionId ?? r.profile?.id;
    if (!cid) throw new Error('The engine did not return the sample connection');
    const sql = [
      'SELECT c.FirstName, c.LastName, c.City, COUNT(o.Id) AS Orders, ROUND(SUM(o.Total), 2) AS Revenue',
      'FROM Customers c',
      'LEFT JOIN Orders o ON o.CustomerId = c.Id',
      'GROUP BY c.Id, c.FirstName, c.LastName, c.City',
      'ORDER BY Revenue DESC;',
      '',
      `-- Sample "Shop" database: Customers, Orders, OrderLines, Products, Countries.`,
      `-- ${displayShortcut('Mod+Enter')} runs the statement under the cursor, ${displayShortcut('Mod+P')} jumps to a table.`,
      '',
    ].join('\n');
    const id = useTabs.getState().newConsole({ connectionId: cid, database: null, text: sql, title: 'Sample: Shop' });
    void preloadCatalog(cid, null);
    useUi.getState().showDock('explorer');
    setTimeout(() => getEditor(id)?.focus(), 80);
    toast('success', r.created === false ? 'Opened the sample database' : 'Created the sample database', r.path);
  } catch (e) {
    toast('error', 'Could not create the sample database', errorMessage(e));
  }
}

/** Onboarding: "Open a SQLite file" — native picker in Electron, connection dialog with SQLite preselected in the browser. */
export async function openSqliteFile(): Promise<void> {
  const p = getPlatform();
  if (!p.hasFileSystem) {
    useUi.getState().openConnectionDialog({ mode: 'new', providerId: 'sqlite', connectAfter: true });
    return;
  }
  const path = await p.showOpenDialog({
    title: 'Open a SQLite database',
    filters: [{ name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (!path) return;
  const existing = useConnections.getState().connections.find((c) => c.providerId === 'sqlite' && c.props.path === path);
  try {
    const conn = existing ?? (await useConnections.getState().save({
      name: path.split(/[\\/]/).pop()!.replace(/\.(db|sqlite3?|db3)$/i, '') || 'SQLite',
      providerId: 'sqlite', color: null, folder: null, readOnly: false, props: { path }, savePassword: false, password: null,
    }));
    newConsole(conn.id, null);
    useUi.getState().showDock('explorer');
  } catch (e) {
    toast('error', 'Could not open the SQLite file', errorMessage(e));
  }
}

/**
 * Open a console on a connection (welcome screen, explorer, connection dialog "Connect"). M2: Redis/MongoDB/Kafka
 * open their module's default workspace instead (Redis browser, Mongo documents, Kafka overview) and return ''.
 */
export function connectAndOpen(connectionId: string): string {
  const conn = getConnection(connectionId);
  if (conn && providerKind(conn.providerId) !== 'relational') {
    const mod = getSourceModule(conn.providerId);
    if (mod) mod.defaultWorkspace(connectionId);
    else toast('info', `${conn.name}: support for this source is not available in this build`);
    useUi.getState().showDock('explorer');
    return '';
  }
  // D7: start loading a lazy dialect spec (Batch 3) while the console opens; the editor waits for it.
  void ensureDialect(dialectOf(connectionId));
  const id = newConsole(connectionId, null);
  useUi.getState().showDock('explorer');
  return id;
}
