// Controller of one wizard tab: owns the state, talks to the engine (capabilities, preview, table info, DDL preview,
// start / cancel / progress) and derives what each step needs (issues, request, gating).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import { dbKey, useCatalog } from '../../store/catalog';
import { getConnection, hasDatabaseLevel } from '../../store/connections';
import { useTabs, type ViewTab } from '../../store/tabs';
import { importApi } from './api';
import { listenForJobs, waitForImportJob } from './jobs';
import {
  buildImportRequest, formatOfPath, isUniqueKey, mappedTargets, mappingIssues, newTableIssues, pickDefaultKey,
  type MapChoice, type NewColumnRow,
} from './model';
import type { ImportTabState } from './open';
import type { ImportMode, ImportRequest, SourceOptions } from './types';
import { applyPreview, applyTableInfo, effectiveSource, IDLE_RUN, initialState, STEP_FORMAT, STEP_MODE, STEP_RUN, STEP_SOURCE, STEP_TARGET, type WizardState } from './wizardState';

export const PREVIEW_DEBOUNCE_MS = 300;
export const DDL_DEBOUNCE_MS = 300;
export const DEFAULT_MAX_ERRORS = 1000;

export type Wizard = ReturnType<typeof useWizard>;

export function useWizard(tab: ViewTab) {
  const persisted = (tab.state ?? {}) as Partial<ImportTabState>;
  const [s, setS] = useState<WizardState>(() => initialState(persisted));
  const patch = useCallback((p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p })), []);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const cid = tab.connectionId ?? '';
  const conn = getConnection(cid);
  /** Catalog key of the tab's database (null for providers without a database level). */
  const dbCatalog = tab.database;
  /** The `database` of engine requests (only providers with a database level take one). */
  const dbEngine = hasDatabaseLevel(conn?.providerId) ? dbCatalog : null;

  // ---------------------------------------------------------------- capabilities
  useEffect(() => {
    if (!cid) return;
    let off = false;
    importApi.capabilities(cid, dbEngine).then(
      (caps) => !off && alive.current && setS((p) => ({ ...p, caps, capsError: null })),
      (e) => !off && alive.current && setS((p) => ({ ...p, capsError: errorMessage(e) })),
    );
    return () => {
      off = true;
    };
  }, [cid, dbEngine]);

  // ---------------------------------------------------------------- preview (debounced)
  const previewSeq = useRef(0);
  useEffect(() => {
    const path = s.path.trim();
    if (!path) {
      previewSeq.current++;
      setS((p) => (p.preview || p.previewError || p.previewLoading ? { ...p, preview: null, previewError: null, previewLoading: false, columnSig: '' } : p));
      return;
    }
    const format = s.userOpts.format ?? formatOfPath(path) ?? undefined;
    const timer = setTimeout(() => {
      const seq = ++previewSeq.current;
      setS((p) => ({ ...p, previewLoading: true }));
      importApi
        .preview({ path, options: { ...(format ? { format } : {}), ...s.userOpts }, maxRows: 100 })
        .then(
          (r) => seq === previewSeq.current && alive.current && setS((p) => applyPreview(p, r)),
          (e) => seq === previewSeq.current && alive.current && setS((p) => ({ ...p, previewLoading: false, previewError: errorMessage(e), preview: null, columnSig: '' })),
        );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [s.path, s.userOpts]);

  // ---------------------------------------------------------------- catalog (schemas and tables)
  const dbCat = useCatalog((c) => c.dbs[dbKey(cid, dbCatalog)]);
  useEffect(() => {
    if (cid) void useCatalog.getState().loadSchemas(cid, dbCatalog);
  }, [cid, dbCatalog]);
  const schemaNames = useMemo(() => {
    const names = dbCat?.schemasResp?.schemas.map((x) => x.name) ?? [];
    if (s.schema && !names.includes(s.schema)) names.push(s.schema);
    return names;
  }, [dbCat?.schemasResp, s.schema]);
  const defaultSchema = dbCat?.defaultSchema ?? dbCat?.schemasResp?.defaultSchema ?? null;
  useEffect(() => {
    if (s.schema === null && defaultSchema) setS((p) => (p.schema === null ? { ...p, schema: defaultSchema } : p));
  }, [s.schema, defaultSchema]);
  useEffect(() => {
    if (cid && s.schema && !dbCat?.loaded[s.schema]) void useCatalog.getState().loadSchema(cid, dbCatalog, s.schema);
  }, [cid, dbCatalog, s.schema, dbCat?.loaded]);
  const tables = useMemo(
    () => (s.schema ? (dbCat?.loaded[s.schema]?.objects ?? []).filter((o) => o.t === 'table').map((o) => o.n).sort((a, b) => a.localeCompare(b)) : []),
    [dbCat?.loaded, s.schema],
  );

  // ---------------------------------------------------------------- target table info
  const infoSeq = useRef(0);
  useEffect(() => {
    if (!cid || s.targetMode !== 'existing' || !s.table.trim()) {
      infoSeq.current++;
      setS((p) => (p.tableInfo || p.tableInfoError ? { ...p, tableInfo: null, tableInfoError: null, tableInfoLoading: false, mapping: {} } : p));
      return;
    }
    const seq = ++infoSeq.current;
    setS((p) => ({ ...p, tableInfoLoading: true }));
    importApi.tableInfo(cid, { database: dbEngine, schema: s.schema, table: s.table }).then(
      (info) => {
        if (seq !== infoSeq.current || !alive.current) return;
        setS((p) => (info.exists ? applyTableInfo(p, info) : { ...p, tableInfo: null, tableInfoLoading: false, tableInfoError: `The table "${s.table}" does not exist.`, mapping: {} }));
      },
      (e) => seq === infoSeq.current && alive.current && setS((p) => ({ ...p, tableInfo: null, tableInfoLoading: false, tableInfoError: errorMessage(e), mapping: {} })),
    );
  }, [cid, dbEngine, s.targetMode, s.schema, s.table]);

  // ---------------------------------------------------------------- derived
  const { preview: previewResult, userOpts } = s;
  const source: SourceOptions | null = useMemo(() => effectiveSource({ preview: previewResult, userOpts }), [previewResult, userOpts]);
  const columns = useMemo(() => previewResult?.columns ?? [], [previewResult]);
  const existingIssues = useMemo(() => mappingIssues(s.tableInfo, s.mapping, columns), [s.tableInfo, s.mapping, columns]);
  const newIssues = useMemo(() => newTableIssues(s.newTable, s.newColumns, s.primaryKey), [s.newTable, s.newColumns, s.primaryKey]);
  const create = s.targetMode === 'new';
  const tableName = create ? s.newTable.trim() : s.table;
  const capsModes = s.caps?.modes ?? ['append'];
  const modes: ImportMode[] = create ? ['append'] : capsModes;
  const mode: ImportMode = modes.includes(s.mode) ? s.mode : modes[0] ?? 'append';
  const transactional = s.caps?.transactional ?? false;
  const transaction = transactional && (s.transaction ?? true);
  const batchSize = s.batchSize ?? s.caps?.defaultBatchSize ?? 1000;
  const keyed = !create && (mode === 'upsert' || mode === 'updateOnly');
  const mappedNames = useMemo(() => mappedTargets(s.tableInfo, s.mapping).map((c) => c.name), [s.tableInfo, s.mapping]);
  const keyErrors: string[] = [];
  if (keyed) {
    if (s.keyColumns.length === 0) keyErrors.push('Choose the key column(s) that identify a row.');
    for (const k of s.keyColumns) if (!mappedNames.includes(k)) keyErrors.push(`The key column "${k}" is not loaded from the file.`);
  }
  const keyIsUnique = isUniqueKey(s.tableInfo, s.keyColumns);
  const blocker =
    s.caps && !s.caps.canImport ? s.caps.reason ?? 'Importing is not available for this connection.'
      : conn?.readOnly ? 'This connection is read-only.'
        : null;

  const request: ImportRequest | null = useMemo(() => {
    if (!source) return null;
    return buildImportRequest({
      path: s.path.trim(), source, target: { database: dbEngine, schema: s.schema, table: tableName, create }, tableInfo: s.tableInfo,
      mapping: s.mapping, newColumns: s.newColumns, primaryKey: s.primaryKey, mode, keyColumns: s.keyColumns, onError: s.onError,
      maxErrors: s.maxErrors, batchSize, transaction, useBulk: s.useBulk, limit: s.limit,
    });
  }, [source, s.path, dbEngine, s.schema, tableName, create, s.tableInfo, s.mapping, s.newColumns, s.primaryKey, mode, s.keyColumns, s.onError, s.maxErrors, batchSize, transaction, s.useBulk, s.limit]);

  const targetErrors = create
    ? newIssues
    : [...(s.tableInfoError ? [s.tableInfoError] : []), ...(!s.table.trim() ? ['Choose the table to load into.'] : []), ...existingIssues.errors];
  const truncating = !create && mode === 'truncateInsert';

  const canNext: Record<number, boolean> = {
    [STEP_SOURCE]: s.path.trim().length > 0,
    [STEP_FORMAT]: !!s.preview && s.preview.columns.length > 0 && !s.previewLoading && !s.previewError,
    [STEP_TARGET]: !!s.preview && !s.tableInfoLoading && targetErrors.length === 0 && !blocker,
    [STEP_MODE]:
      !!request && !blocker && keyErrors.length === 0 && (!truncating || s.confirmTruncate) && (s.onError === 'stop' || s.maxErrors >= 0) && batchSize > 0,
  };

  // ---------------------------------------------------------------- DDL preview (new table)
  const ddlKey = useMemo(
    () =>
      create && request
        ? JSON.stringify({ t: s.newTable, sc: s.schema, db: dbEngine, c: s.newColumns.filter((c) => c.include).map((c) => [c.name, c.sqlType, c.nullable, c.inferred]), pk: s.primaryKey })
        : null,
    [create, request, s.newTable, s.schema, dbEngine, s.newColumns, s.primaryKey],
  );
  const ddlSeq = useRef(0);
  const showTarget = s.step >= STEP_TARGET;
  useEffect(() => {
    if (!ddlKey || !cid || !showTarget) return;
    const included = s.newColumns.filter((c) => c.include);
    if (!s.newTable.trim() || included.length === 0 || newIssues.length > 0) {
      setS((p) => (p.ddl ? { ...p, ddl: null } : p));
      return;
    }
    const timer = setTimeout(() => {
      const seq = ++ddlSeq.current;
      importApi
        .ddl(cid, {
          database: dbEngine, schema: s.schema, table: s.newTable.trim(), primaryKey: s.primaryKey,
          columns: included.map((c) => ({ name: c.name.trim(), ...(c.sqlType ? { sqlType: c.sqlType } : {}), nullable: s.primaryKey.includes(c.name) ? false : c.nullable, inferred: c.inferred })),
        })
        .then(
          (ddl) => seq === ddlSeq.current && alive.current && setS((p) => ({ ...p, ddl, ddlError: null })),
          (e) => seq === ddlSeq.current && alive.current && setS((p) => ({ ...p, ddlError: errorMessage(e) })),
        );
    }, DDL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ddlKey, cid, showTarget]);

  // ---------------------------------------------------------------- persistence of path / target
  useEffect(() => {
    const next: ImportTabState = { path: s.path.trim() || null, targetMode: s.targetMode, schema: s.schema, table: s.targetMode === 'existing' ? s.table || null : null };
    useTabs.getState().updateView(tab.id, { state: next });
  }, [tab.id, s.path, s.targetMode, s.schema, s.table]);

  // unsaved-work guard: closing a tab with a running import asks first
  const running = s.run.status === 'starting' || s.run.status === 'running';
  useEffect(() => {
    useTabs.getState().updateView(tab.id, { dirty: running });
  }, [tab.id, running]);

  // ---------------------------------------------------------------- actions
  const setOpt = useCallback(<K extends keyof SourceOptions>(key: K, value: SourceOptions[K] | undefined) => {
    setS((p) => {
      const userOpts = { ...p.userOpts };
      if (value === undefined) delete userOpts[key];
      else userOpts[key] = value;
      return { ...p, userOpts };
    });
  }, []);

  const setMapping = useCallback((target: string, choice: MapChoice) => {
    setS((p) => ({ ...p, mapping: { ...p.mapping, [target]: choice }, mappingTouched: true }));
  }, []);

  const runAutoMatch = useCallback(() => {
    setS((p) => (p.tableInfo ? applyTableInfo({ ...p, keyColumns: p.keyColumns }, p.tableInfo) : p));
  }, []);

  const updateNewColumn = useCallback((index: number, change: Partial<NewColumnRow>) => {
    setS((p) => {
      const old = p.newColumns.find((c) => c.index === index);
      const newColumns = p.newColumns.map((c) => (c.index === index ? { ...c, ...change } : c));
      let primaryKey = p.primaryKey;
      if (old && change.name !== undefined && change.name !== old.name) primaryKey = primaryKey.map((k) => (k === old.name ? change.name! : k));
      if (old && change.include === false) primaryKey = primaryKey.filter((k) => k !== old.name);
      return { ...p, newColumns, primaryKey };
    });
  }, []);

  const togglePk = useCallback((name: string) => {
    setS((p) => ({ ...p, primaryKey: p.primaryKey.includes(name) ? p.primaryKey.filter((k) => k !== name) : [...p.primaryKey, name] }));
  }, []);

  const setMode = useCallback((m: ImportMode) => {
    setS((p) => {
      const keyColumns = (m === 'upsert' || m === 'updateOnly') && p.keyColumns.length === 0 ? pickDefaultKey(p.tableInfo, p.mapping) : p.keyColumns;
      return { ...p, mode: m, keyColumns, confirmTruncate: false };
    });
  }, []);

  const goTo = useCallback((step: number) => setS((p) => ({ ...p, step })), []);

  const start = useCallback(async () => {
    if (!request || !cid) return;
    listenForJobs();
    setS((p) => ({ ...p, step: STEP_RUN, run: { ...IDLE_RUN, status: 'starting', startedAt: Date.now() } }));
    try {
      const { jobId } = await importApi.start(cid, request);
      if (!alive.current) return;
      setS((p) => ({ ...p, run: { ...p.run, status: 'running', jobId } }));
      const end = await waitForImportJob(jobId, (progress, ev) => {
        if (!alive.current) return;
        setS((p) => ({ ...p, run: { ...p.run, progress: progress ?? p.run.progress, rowsRead: ev.done } }));
      });
      if (!alive.current) return;
      if (end.status === 'ok' && end.summary) {
        const summary = end.summary;
        setS((p) => ({ ...p, run: { ...p.run, status: 'done', summary, progress: p.run.progress } }));
        if (summary.createdTable) void useCatalog.getState().revalidate(cid, dbCatalog, [request.target.schema ?? null]).catch(() => {});
      } else {
        const message = end.status === 'cancelled' ? 'The import was cancelled.' : end.error ?? 'The import failed.';
        setS((p) => ({ ...p, run: { ...p.run, status: 'failed', error: message } }));
      }
    } catch (e) {
      if (alive.current) setS((p) => ({ ...p, run: { ...p.run, status: 'failed', error: errorMessage(e) } }));
    }
  }, [request, cid, dbCatalog]);

  const cancel = useCallback(async () => {
    const id = s.run.jobId;
    if (!id) return;
    setS((p) => ({ ...p, run: { ...p.run, cancelling: true } }));
    try {
      await importApi.cancel(id);
    } catch {
      /* the job may have just finished */
    }
  }, [s.run.jobId]);

  /** "Import another file": back to step 1, keeping the connection and target. */
  const restart = useCallback(() => {
    setS((p) => ({
      ...initialState({ path: '', targetMode: p.targetMode, schema: p.schema, table: p.targetMode === 'existing' ? p.table : null }),
      caps: p.caps, newTable: '',
    }));
  }, []);

  return {
    s, patch, tab, cid, conn, dbEngine, dbCatalog, schemaNames, tables, source, columns, existingIssues, newIssues, create, tableName, modes, mode,
    transactional, transaction, batchSize, keyed, keyErrors, keyIsUnique, mappedNames, blocker, request, targetErrors, truncating, canNext,
    running, setOpt, setMapping, runAutoMatch, updateNewColumn, togglePk, setMode, goTo, start, cancel, restart,
  };
}

