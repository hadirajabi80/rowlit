// Controller of one transfer tab: owns the wizard state, talks to the engine (support, dump dialects, types, plan,
// run / cancel / progress) and derives what each step needs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../api/client';
import type { DumpDialect, TransferSupport, TransferTypeInfo } from '../../api/types.transfer';
import { catalogDatabase } from '../../app/actions';
import { dbKey, useCatalog } from '../../store/catalog';
import { getConnection, hasDatabaseLevel, isRelational, useConnections } from '../../store/connections';
import { useTabs, type ViewTab } from '../../store/tabs';
import { transferApi } from './api';
import { listenForJobs, waitForTransferJob } from './jobs';
import {
  applyProgress, buildSpec, dumpPathIssue, filterObjects, IDLE_RUN, initialState, mappingIssues, optionIssues, planErrors, specKey,
  STEP_MAPPING, STEP_OPTIONS, STEP_RUN, STEP_SOURCE, STEP_TARGET, type TransferState,
} from './model';
import type { TransferTabState } from './open';
import { rememberRecent, type RecentTransfer } from './recent';

export const PLAN_DEBOUNCE_MS = 300;

export type Transfer = ReturnType<typeof useTransfer>;

interface SideCatalog {
  databases: string[] | undefined;
  schemaNames: string[];
  defaultSchema: string | null;
}

/** Databases, schemas and default schema of one side (loads what is missing). */
function useSide(cid: string, db: string | null, schema: string | null): SideCatalog & { objects: { name: string; type: 'table' | 'view' }[] } {
  const conn = getConnection(cid);
  const dbLevel = hasDatabaseLevel(conn?.providerId);
  const databases = useCatalog((c) => (cid ? c.conns[cid]?.databases?.databases : undefined));
  const dbCat = useCatalog((c) => (cid ? c.dbs[dbKey(cid, db)] : undefined));
  useEffect(() => {
    if (cid && dbLevel) void useCatalog.getState().loadDatabases(cid);
  }, [cid, dbLevel]);
  useEffect(() => {
    if (cid) void useCatalog.getState().loadSchemas(cid, db);
  }, [cid, db]);
  const defaultSchema = dbCat?.defaultSchema ?? dbCat?.schemasResp?.defaultSchema ?? null;
  const effSchema = schema ?? defaultSchema;
  useEffect(() => {
    if (cid && effSchema && !dbCat?.loaded[effSchema]) void useCatalog.getState().loadSchema(cid, db, effSchema);
  }, [cid, db, effSchema, dbCat?.loaded]);
  const schemaNames = useMemo(() => dbCat?.schemasResp?.schemas.map((x) => x.name) ?? [], [dbCat?.schemasResp]);
  const objects = useMemo(
    () => (effSchema ? (dbCat?.loaded[effSchema]?.objects ?? []) : [])
      .filter((o) => o.t === 'table' || o.t === 'view')
      .map((o) => ({ name: o.n, type: o.t as 'table' | 'view' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [dbCat?.loaded, effSchema],
  );
  return { databases: dbLevel ? databases : undefined, schemaNames, defaultSchema, objects };
}

export function useTransfer(tab: ViewTab) {
  const persisted = (tab.state ?? {}) as Partial<TransferTabState>;
  const [s, setS] = useState<TransferState>(() => initialState(persisted));
  const patch = useCallback((p: Partial<TransferState>) => setS((prev) => ({ ...prev, ...p })), []);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---------------------------------------------------------------- source side
  const cid = tab.connectionId ?? '';
  const conn = getConnection(cid);
  const sourceDb = tab.database;
  const sourceDbEngine = hasDatabaseLevel(conn?.providerId) ? sourceDb : null;
  const source = useSide(cid, sourceDb, s.sourceSchema);
  useEffect(() => {
    if (s.sourceSchema === null && source.defaultSchema) setS((p) => (p.sourceSchema === null ? { ...p, sourceSchema: source.defaultSchema } : p));
  }, [s.sourceSchema, source.defaultSchema]);
  const listed = useMemo(
    () => filterObjects(source.objects.filter((o) => s.includeViews || o.type === 'table'), s.search),
    [source.objects, s.includeViews, s.search],
  );

  const allConnections = useConnections((c) => c.connections);
  const connections = useMemo(() => allConnections.filter((c) => isRelational(c.id)), [allConnections]);

  const [support, setSupport] = useState<Record<string, TransferSupport | { error: string }>>({});
  const loadSupport = useCallback((id: string) => {
    if (!id) return;
    transferApi.support(id).then(
      (r) => alive.current && setSupport((m) => ({ ...m, [id]: r })),
      (e) => alive.current && setSupport((m) => ({ ...m, [id]: { error: errorMessage(e) } })),
    );
  }, []);
  useEffect(() => {
    if (cid && !support[cid]) loadSupport(cid);
  }, [cid, support, loadSupport]);
  const supportOf = (id: string): TransferSupport | null => {
    const v = support[id];
    return v && !('error' in v) ? v : null;
  };
  const supportError = (id: string): string | null => {
    const v = support[id];
    return v && 'error' in v ? v.error : null;
  };
  const sourceSupport = supportOf(cid);
  const sourceBlocker = supportError(cid) ?? (sourceSupport && !sourceSupport.asSource ? sourceSupport.reason ?? 'This connection cannot be a source.' : null);

  // ---------------------------------------------------------------- target side
  const targetConn = getConnection(s.targetCid);
  const targetDbEngine = hasDatabaseLevel(targetConn?.providerId) ? s.targetDb : null;
  const target = useSide(s.targetKind === 'connection' ? s.targetCid : '', s.targetDb, s.targetSchema.trim() || null);
  useEffect(() => {
    if (s.targetKind === 'connection' && s.targetCid && !support[s.targetCid]) loadSupport(s.targetCid);
  }, [s.targetKind, s.targetCid, support, loadSupport]);
  const targetSupport = supportOf(s.targetCid);
  const targetBlocker = s.targetKind !== 'connection' || !s.targetCid ? null
    : supportError(s.targetCid) ?? (targetSupport && !targetSupport.asTarget ? targetSupport.reason ?? 'This connection cannot be a target.' : null);

  const [dumpDialects, setDumpDialects] = useState<DumpDialect[] | null>(null);
  const [dumpError, setDumpError] = useState<string | null>(null);
  useEffect(() => {
    if (s.targetKind !== 'file' || dumpDialects) return;
    transferApi.dumpDialects().then(
      (d) => alive.current && setDumpDialects(d),
      (e) => alive.current && setDumpError(errorMessage(e)),
    );
  }, [s.targetKind, dumpDialects]);
  // The dump's dialect defaults to the source's own when it can be written, else the first one.
  useEffect(() => {
    if (s.targetKind !== 'file' || s.dumpProvider || !dumpDialects?.length) return;
    const own = dumpDialects.find((d) => d.provider === sourceSupport?.providerId);
    setS((p) => (p.dumpProvider ? p : { ...p, dumpProvider: (own ?? dumpDialects[0]).provider }));
  }, [s.targetKind, s.dumpProvider, dumpDialects, sourceSupport?.providerId]);

  /** Provider id whose types the target columns use. */
  const targetProvider = s.targetKind === 'file' ? s.dumpProvider : targetSupport?.providerId ?? '';
  const [types, setTypes] = useState<{ provider: string; list: TransferTypeInfo[] } | null>(null);
  useEffect(() => {
    if (!targetProvider || s.step < STEP_MAPPING || types?.provider === targetProvider) return;
    let off = false;
    transferApi.types(targetProvider, s.targetKind === 'connection' ? s.targetCid : null).then(
      (r) => !off && alive.current && setTypes({ provider: targetProvider, list: r.types }),
      () => {
        /* the picker is a convenience: free text still works */
      },
    );
    return () => {
      off = true;
    };
  }, [targetProvider, s.step, s.targetKind, s.targetCid, types?.provider]);

  // ---------------------------------------------------------------- request + plan
  const spec = useMemo(
    () => buildSpec(s, { sourceCid: cid, sourceDb: sourceDbEngine, targetDb: targetDbEngine }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cid, sourceDbEngine, targetDbEngine, s.sourceSchema, s.selected, s.targetKind, s.targetCid, s.targetSchema, s.dumpProvider, s.filePath, s.options],
  );
  const key = specKey(spec);
  const planSeq = useRef(0);
  const wantsPlan = s.step >= STEP_MAPPING && s.run.status === 'idle';
  useEffect(() => {
    if (!wantsPlan || !spec || !key) return;
    if (key === s.planKey && (s.plan || s.planError)) return;
    const timer = setTimeout(() => {
      const seq = ++planSeq.current;
      setS((p) => ({ ...p, planLoading: true }));
      transferApi.plan(spec).then(
        (plan) => seq === planSeq.current && alive.current && setS((p) => ({ ...p, plan, planKey: key, planError: null, planLoading: false })),
        (e) => seq === planSeq.current && alive.current && setS((p) => ({ ...p, plan: null, planKey: key, planError: errorMessage(e), planLoading: false })),
      );
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsPlan, key]);
  const planFresh = !!s.plan && s.planKey === key && !s.planLoading;

  // ---------------------------------------------------------------- gating
  const sourceIssues: string[] = [];
  if (!cid) sourceIssues.push('Choose the source connection.');
  else if (sourceBlocker) sourceIssues.push(sourceBlocker);
  if (s.selected.length === 0) sourceIssues.push('Tick at least one table.');

  const targetIssues: string[] = [];
  if (s.targetKind === 'file') {
    if (!s.dumpProvider) targetIssues.push('Choose the dialect of the script.');
    const pi = dumpPathIssue(s.filePath);
    if (pi) targetIssues.push(pi);
  } else {
    if (!s.targetCid) targetIssues.push('Choose the target connection.');
    else if (targetBlocker) targetIssues.push(targetBlocker);
    else if (!targetSupport) targetIssues.push('Checking the target…');
  }

  const mapIssues = mappingIssues(s);
  const optIssues = optionIssues(s.options);
  const refused = planErrors(planFresh ? s.plan : null);
  const blockedByPlan = refused.length > 0 && !s.options.continueOnError;
  const canNext: Record<number, boolean> = {
    [STEP_SOURCE]: sourceIssues.length === 0,
    [STEP_TARGET]: sourceIssues.length === 0 && targetIssues.length === 0,
    [STEP_MAPPING]: planFresh && !s.planError && mapIssues.length === 0,
    [STEP_OPTIONS]: optIssues.length === 0,
    [STEP_RUN]: !!spec && planFresh && !s.planError && mapIssues.length === 0 && optIssues.length === 0 && !blockedByPlan
      && refused.length < (s.plan?.tables.length ?? 0),
  };
  const nextHint = (step: number): string | null => {
    if (canNext[step]) return null;
    switch (step) {
      case STEP_SOURCE: return sourceIssues[0] ?? null;
      case STEP_TARGET: return sourceIssues[0] ?? targetIssues[0] ?? null;
      case STEP_MAPPING:
        if (s.planLoading || !planFresh) return s.planError ? 'The transfer cannot be planned yet.' : 'Planning…';
        return mapIssues[0] ?? 'The transfer cannot be planned yet.';
      case STEP_OPTIONS: return optIssues[0] ?? null;
      default:
        if (!planFresh) return s.planError ? 'The transfer cannot be planned.' : 'Planning…';
        if (blockedByPlan) return `${refused.length} ${refused.length === 1 ? 'table needs' : 'tables need'} attention.`;
        return mapIssues[0] ?? optIssues[0] ?? null;
    }
  };

  // ---------------------------------------------------------------- persistence
  useEffect(() => {
    const next: TransferTabState = { schema: s.sourceSchema, tables: s.selected.map((t) => ({ name: t.name, type: t.type })), targetKind: s.targetKind };
    useTabs.getState().updateView(tab.id, { state: next });
  }, [tab.id, s.sourceSchema, s.selected, s.targetKind]);
  const running = s.run.status === 'starting' || s.run.status === 'running';
  useEffect(() => {
    useTabs.getState().updateView(tab.id, { dirty: running });
  }, [tab.id, running]);

  // ---------------------------------------------------------------- actions
  const setSourceConnection = useCallback((id: string) => {
    useTabs.getState().updateView(tab.id, { connectionId: id || null, database: id ? catalogDatabase(id, null) : null });
    setS((p) => ({ ...p, sourceSchema: null, selected: [], plan: null, planKey: null, planError: null, expanded: null }));
  }, [tab.id]);
  const setSourceDatabase = useCallback((db: string | null) => {
    useTabs.getState().updateView(tab.id, { database: db });
    setS((p) => ({ ...p, sourceSchema: null, selected: [], expanded: null }));
  }, [tab.id]);
  const setSourceSchema = useCallback((schema: string | null) => setS((p) => ({ ...p, sourceSchema: schema, selected: [], expanded: null })), []);
  const setTargetConnection = useCallback((id: string) => {
    setS((p) => ({ ...p, targetCid: id, targetDb: id ? catalogDatabase(id, null) : null, targetSchema: '' }));
  }, []);

  const goTo = useCallback((step: number) => setS((p) => ({ ...p, step, run: step < STEP_RUN && p.run.status === 'failed' ? IDLE_RUN : p.run })), []);

  const applyRecent = useCallback((r: RecentTransfer) => {
    useTabs.getState().updateView(tab.id, { connectionId: r.sourceCid, database: r.sourceDb });
    setS((p) => ({
      ...p, sourceSchema: r.sourceSchema, selected: r.tables.map((t) => ({ name: t.name, type: t.type, targetName: '', where: '', columnTypes: {}, excluded: [] })),
      includeViews: r.tables.some((t) => t.type === 'view'), targetKind: r.targetKind, targetCid: r.targetCid, targetDb: r.targetDb,
      targetSchema: r.targetSchema, dumpProvider: r.dumpProvider, filePath: r.filePath, options: r.options, plan: null, planKey: null, planError: null,
    }));
  }, [tab.id]);

  const start = useCallback(async () => {
    if (!spec || !cid) return;
    listenForJobs();
    rememberRecent({
      sourceCid: cid, sourceDb, sourceSchema: s.sourceSchema, tables: s.selected.map((t) => ({ name: t.name, type: t.type })), targetKind: s.targetKind,
      targetCid: s.targetCid, targetDb: s.targetDb, targetSchema: s.targetSchema, dumpProvider: s.dumpProvider, filePath: s.filePath, options: s.options,
    });
    const tables = Object.fromEntries((s.plan?.tables ?? []).filter((t) => !t.error).map((t) => [t.sourceName, { status: 'waiting' as const, rows: 0, total: null }]));
    setS((p) => ({ ...p, step: STEP_RUN, run: { ...IDLE_RUN, status: 'starting', startedAt: Date.now(), tables } }));
    try {
      const { jobId } = await transferApi.run(spec);
      if (!alive.current) return;
      setS((p) => ({ ...p, run: { ...p.run, status: 'running', jobId } }));
      const end = await waitForTransferJob(jobId, (progress, ev) => {
        if (alive.current) setS((p) => ({ ...p, run: applyProgress(p.run, progress, ev) }));
      });
      if (!alive.current) return;
      if (end.status === 'ok' && end.result) {
        const result = end.result;
        setS((p) => ({ ...p, run: { ...p.run, status: 'done', result } }));
        if (s.targetKind === 'connection' && s.targetCid) {
          void useCatalog.getState().revalidate(s.targetCid, s.targetDb, [s.targetSchema.trim() || target.defaultSchema]).catch(() => {});
        }
      } else {
        const message = end.status === 'cancelled' ? 'The transfer was cancelled.' : end.error ?? 'The transfer failed.';
        setS((p) => ({ ...p, run: { ...p.run, status: 'failed', error: message } }));
      }
    } catch (e) {
      if (alive.current) setS((p) => ({ ...p, run: { ...p.run, status: 'failed', error: errorMessage(e) } }));
    }
  }, [spec, cid, sourceDb, s.sourceSchema, s.selected, s.targetKind, s.targetCid, s.targetDb, s.targetSchema, s.dumpProvider, s.filePath, s.options, s.plan, target.defaultSchema]);

  const cancel = useCallback(async () => {
    const id = s.run.jobId;
    if (!id) return;
    setS((p) => ({ ...p, run: { ...p.run, cancelling: true } }));
    try {
      await transferApi.cancel(id);
    } catch {
      /* the job may have just finished */
    }
  }, [s.run.jobId]);

  /** "New transfer": back to the first step with the same source and target. */
  const restart = useCallback(() => setS((p) => ({ ...p, step: STEP_SOURCE, run: IDLE_RUN, plan: null, planKey: null, planError: null })), []);

  return {
    s, patch, setS, tab, cid, conn, sourceDb, sourceDbEngine, source, listed, connections, sourceSupport, sourceBlocker,
    targetConn, target, targetSupport, targetBlocker, targetProvider, dumpDialects, dumpError, types: types?.list ?? [], spec, planFresh,
    sourceIssues, targetIssues, mapIssues, optIssues, refused, blockedByPlan, canNext, nextHint, running,
    setSourceConnection, setSourceDatabase, setSourceSchema, setTargetConnection, goTo, applyRecent, start, cancel, restart,
  };
}
