// Materialize dialog (plan-links 3): writes the result of a link query (or a linked view) into a table of a writable
// connection. Target connection > database > schema, table name with live validation, mode create / replace / append,
// DDL preview from the engine, progress from the job events, "Open table" when it is done. Lazy chunk.
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, Table2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { errorMessage, api } from '../../../api/client';
import { linksApi, type MaterializeMode, type MaterializePreview, type MaterializeResult } from '../../../api/links';
import { activateObject } from '../../../app/actions';
import { useCatalog } from '../../../store/catalog';
import { schemaLevelLabel } from '../../../lib/providerLevels';
import { getConnection, useConnections } from '../../../store/connections';
import { toast } from '../../../store/ui';
import { Dialog } from '../../common/Dialog';
import { formatCount, formatDuration } from '../../ImportWizard/model';
import { listenForJobs, waitForMaterializeJob } from './jobs';
import {
  buildRequest, defaultTableName, hasSource, MODES, progressPercent, tableNameIssue, type MaterializeProgress, type MaterializeSource,
} from './model';
import { lastTarget, materializeTargets, rememberTarget, usePlacement } from './target';
import './wizard.css';

export const PREVIEW_DEBOUNCE_MS = 350;

type Run =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'running'; jobId: string; progress: MaterializeProgress | null }
  | { status: 'done'; result: MaterializeResult }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();

export function MaterializeDialog({ source, onClose }: { source: MaterializeSource; onClose: () => void }) {
  const link = getConnection(source.connectionId);
  const targets = useConnections((c) => c.connections);
  const remembered = useMemo(lastTarget, []);
  const firstTarget = useMemo(() => {
    const writable = materializeTargets(targets);
    return writable.find((c) => c.id === remembered?.connectionId)?.id ?? writable[0]?.id ?? '';
  }, [targets, remembered]);

  const [cid, setCid] = useState(firstTarget);
  const [database, setDatabase] = useState<string | null>(remembered && remembered.connectionId === firstTarget ? remembered.database : null);
  const [schema, setSchema] = useState<string | null>(remembered && remembered.connectionId === firstTarget ? remembered.schema : null);
  const [table, setTable] = useState(() => defaultTableName(source));
  const [mode, setMode] = useState<MaterializeMode>('create');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [preview, setPreview] = useState<MaterializePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const alive = useRef(true);
  const ids = { table: useId(), list: useId() };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const place = usePlacement(cid, database, schema);
  const conn = getConnection(cid);

  // a connection change starts the database / schema over; pick the connection's current ones when they load
  const changeConnection = (id: string) => {
    setCid(id);
    setDatabase(null);
    setSchema(null);
    setPreview(null);
  };
  const databases = place.databases;
  const currentDb = useCatalog((c) => c.conns[cid]?.databases?.current ?? null);
  useEffect(() => {
    if (place.dbLevel && !database && databases.length) setDatabase(currentDb && databases.includes(currentDb) ? currentDb : databases[0]);
  }, [place.dbLevel, database, databases, currentDb]);
  useEffect(() => {
    if (!schema && place.schemas.length) setSchema(place.defaultSchema && place.schemas.includes(place.defaultSchema) ? place.defaultSchema : place.schemas[0]);
  }, [schema, place.schemas, place.defaultSchema]);

  const name = table;
  const sourceOk = hasSource(source);
  const placed = !!cid && (!place.dbLevel || !!database) && (!!schema || place.schemas.length === 0);
  const structural = tableNameIssue(name, mode, null);
  const request = useMemo(
    () => (sourceOk && placed && !structural ? buildRequest(source, { connectionId: cid, database: place.dbLevel ? database : null, schema, table: name, mode }) : null),
    [sourceOk, placed, structural, source, cid, place.dbLevel, database, schema, name, mode],
  );

  // DDL preview (debounced; the newest request wins)
  const seq = useRef(0);
  useEffect(() => {
    if (!request) {
      seq.current++;
      setPreview(null);
      setPreviewError(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const timer = setTimeout(() => {
      const mine = ++seq.current;
      linksApi.materializePreview(source.connectionId, request).then(
        (p) => {
          if (mine !== seq.current || !alive.current) return;
          setPreview(p);
          setPreviewError(null);
          setPreviewing(false);
        },
        (e) => {
          if (mine !== seq.current || !alive.current) return;
          setPreview(null);
          setPreviewError(errorMessage(e));
          setPreviewing(false);
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [request, source.connectionId]);

  const exists = preview ? preview.tableExists : null;
  const nameIssue = tableNameIssue(name, mode, exists);
  const replacing = mode === 'replace' && exists === true;
  const busy = run.status === 'starting' || run.status === 'running';
  const canStart = !!request && !nameIssue && !!preview && !previewing && !previewError && (!replacing || confirmReplace) && !busy && run.status !== 'done';

  const start = useCallback(async () => {
    if (!request) return;
    setRun({ status: 'starting' });
    listenForJobs();
    try {
      const { jobId } = await linksApi.materialize(source.connectionId, request);
      if (!alive.current) return;
      setRun({ status: 'running', jobId, progress: null });
      const end = await waitForMaterializeJob(jobId, (p) => alive.current && setRun((r) => (r.status === 'running' ? { ...r, progress: p } : r)));
      if (!alive.current) return;
      if (end.status === 'ok' && end.result) {
        setRun({ status: 'done', result: end.result });
        rememberTarget({ connectionId: cid, database: place.dbLevel ? database : null, schema });
        const catDb = place.dbLevel ? database : null;
        void useCatalog.getState().loadSchema(cid, catDb, end.result.schema ?? schema ?? '', true);
      } else if (end.status === 'ok') {
        setRun({ status: 'done', result: { targetConnectionId: cid, database: place.dbLevel ? database : null, schema, table: name, rows: 0, elapsedMs: 0, warnings: [] } });
      } else if (end.status === 'cancelled') setRun({ status: 'cancelled' });
      else setRun({ status: 'error', message: end.error ?? 'The materialize job failed.' });
    } catch (e) {
      if (alive.current) setRun({ status: 'error', message: errorMessage(e) });
    }
  }, [request, source.connectionId, cid, place.dbLevel, database, schema, name]);

  const cancel = async () => {
    if (run.status !== 'running') return;
    try {
      await api.cancelJob(run.jobId);
    } catch (e) {
      toast('error', 'Could not cancel the job', errorMessage(e));
    }
  };

  const openTable = (r: MaterializeResult) => {
    const db = place.dbLevel ? r.database ?? database : null;
    activateObject(r.targetConnectionId || cid, db, { database: db, schema: r.schema, name: r.table, type: 'table' });
    onClose();
  };

  const level = schemaLevelLabel(conn?.providerId);
  const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
  const sqlText = source.viewId ? '' : oneLine(source.sql ?? '');
  const closeGuard = () => {
    if (!busy) onClose();
  };

  const body = (
    <div className="lw-body">
      <p className="lw-lede">
        Writes the result of {link ? <strong>{link.name}</strong> : 'the link'} into a table. The rows are read once from the member databases and loaded in batches.
      </p>
      <div className="lw-source" title={source.viewId ? undefined : sqlText}>
        <span className="lw-source-label">{source.viewId ? 'Linked view' : 'Query'}</span>
        <code className="lw-source-sql">{source.viewId ? source.name ?? source.viewId : sqlText || '(no query)'}</code>
      </div>
      {!sourceOk && <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>There is no query to materialize. Write a SELECT in the console first.</span></div>}

      <fieldset className="lw-group" disabled={busy || run.status === 'done'}>
        <legend className="lw-legend">Target</legend>
        <div className="lw-where">
          <label className="lw-field">
            <span className="lw-label">Connection</span>
            <select className="input" aria-label="Target connection" value={cid} onChange={(e) => changeConnection(e.target.value)}>
              {!cid && <option value="">Choose a connection…</option>}
              {place.connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {place.dbLevel && (
            <>
              <ArrowRight size={14} className="lw-crumb" aria-hidden="true" />
              <label className="lw-field">
                <span className="lw-label">Database</span>
                <select className="input" aria-label="Target database" value={database ?? ''} onChange={(e) => { setDatabase(e.target.value || null); setSchema(null); }}>
                  {!database && <option value="">Choose a database…</option>}
                  {database && !databases.includes(database) && <option value={database}>{database}</option>}
                  {databases.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </>
          )}
          {place.schemas.length > 0 || schema ? (
            <>
              <ArrowRight size={14} className="lw-crumb" aria-hidden="true" />
              <label className="lw-field">
                <span className="lw-label">{levelLabel}</span>
                <select className="input" aria-label="Target schema" value={schema ?? ''} onChange={(e) => setSchema(e.target.value || null)}>
                  {schema && !place.schemas.includes(schema) && <option value={schema}>{schema}</option>}
                  {place.schemas.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </>
          ) : null}
        </div>
        {place.connections.length === 0 && (
          <div className="lw-msg lw-warn" role="status"><TriangleAlert size={14} aria-hidden="true" /><span>No writable connection. Add a connection that is not read-only to load the result into.</span></div>
        )}

        <div className="lw-modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <label key={m.mode} className={`lw-mode${mode === m.mode ? ' on' : ''}`} title={m.help}>
              <input type="radio" name="lw-mode" checked={mode === m.mode} onChange={() => { setMode(m.mode); setConfirmReplace(false); }} />
              {m.label}
            </label>
          ))}
        </div>
        <p className="lw-help">{MODES.find((m) => m.mode === mode)?.help}</p>

        <label className="lw-field lw-table" htmlFor={ids.table}>
          <span className="lw-label">Table name</span>
          <input
            id={ids.table}
            className="input"
            value={table}
            spellCheck={false}
            list={mode === 'create' ? undefined : ids.list}
            aria-invalid={!!nameIssue}
            aria-describedby={nameIssue ? `${ids.table}-err` : undefined}
            onChange={(e) => { setTable(e.target.value); setConfirmReplace(false); }}
          />
          {mode !== 'create' && <datalist id={ids.list}>{place.tables.map((t) => <option key={t} value={t} />)}</datalist>}
          {(structural || nameIssue) && table !== '' ? <small id={`${ids.table}-err`} className="lw-note lw-error-text" role="alert">{nameIssue ?? structural}</small> : null}
        </label>
      </fieldset>

      <section className="lw-preview" aria-label="Preview" aria-busy={previewing}>
        <header className="lw-preview-head">
          <h3 className="lw-h">{mode === 'append' ? 'Columns appended' : 'Table that will be created'}</h3>
          {previewing && <LoaderCircle size={14} className="lw-spin" aria-label="Preparing the preview" />}
        </header>
        {previewError ? (
          <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{previewError}</span></div>
        ) : preview ? (
          <>
            {preview.ddl ? <pre className="lw-ddl" tabIndex={0} aria-label="DDL">{preview.ddl}</pre> : (
              <p className="lw-help">{preview.columns.length} {preview.columns.length === 1 ? 'column' : 'columns'}: {preview.columns.map((c) => c.name).join(', ')}.</p>
            )}
            {preview.warnings.map((w) => <div key={w} className="lw-msg lw-warn" role="status"><TriangleAlert size={14} aria-hidden="true" /><span>{w}</span></div>)}
            {replacing && (
              <label className="lw-confirm">
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                <span>The existing table <strong>{name}</strong> and all its rows are dropped first.</span>
              </label>
            )}
          </>
        ) : (
          <p className="lw-help">{request ? 'Preparing the preview…' : 'Choose the target and a table name to preview the table.'}</p>
        )}
      </section>

      <RunPanel run={run} onOpen={openTable} />
    </div>
  );

  return (
    <Dialog
      title="Materialize result"
      onClose={closeGuard}
      width="min(720px, calc(100vw - 32px))"
      className="lw-dialog"
      ariaLabel="Materialize result"
      footer={
        <>
          {run.status === 'done' ? (
            <>
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={() => openTable(run.result)} data-autofocus><Table2 size={14} aria-hidden="true" /> Open table</button>
            </>
          ) : busy ? (
            <button className="btn" onClick={() => void cancel()} disabled={run.status !== 'running'}>Cancel job</button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!canStart} onClick={() => void start()}>
                {run.status === 'error' || run.status === 'cancelled' ? 'Try again' : 'Materialize'}
              </button>
            </>
          )}
        </>
      }
    >
      {body}
    </Dialog>
  );
}

function RunPanel({ run, onOpen }: { run: Run; onOpen: (r: MaterializeResult) => void }) {
  if (run.status === 'idle') return null;
  if (run.status === 'starting' || run.status === 'running') {
    const p = run.status === 'running' ? run.progress : null;
    const pct = progressPercent(p);
    return (
      <section className="lw-run" aria-live="polite" aria-label="Progress">
        <div className="lw-run-line">
          <LoaderCircle size={14} className="lw-spin" aria-hidden="true" />
          <span>{run.status === 'starting' ? 'Starting…' : p ? `${formatCount(p.rows)} ${p.rows === 1 ? 'row' : 'rows'} written${p.total ? ` of ${formatCount(p.total)}` : ''}` : 'Reading the member databases…'}</span>
        </div>
        <div className="lw-bar" role="progressbar" aria-label="Materialize progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.round(pct)}>
          <div className={`lw-bar-fill${pct == null ? ' indeterminate' : ''}`} style={pct == null ? undefined : { width: `${pct}%` }} />
        </div>
        {p?.message ? <small className="lw-note">{p.message}</small> : null}
      </section>
    );
  }
  if (run.status === 'done') {
    const r = run.result;
    return (
      <section className="lw-run lw-ok" role="status" aria-label="Result">
        <div className="lw-run-line">
          <CircleCheck size={16} aria-hidden="true" />
          <span>
            <strong>{formatCount(r.rows)}</strong> {r.rows === 1 ? 'row' : 'rows'} written to <strong>{r.schema ? `${r.schema}.` : ''}{r.table}</strong>
            {r.elapsedMs > 0 ? ` in ${formatDuration(r.elapsedMs)}` : ''}.
          </span>
          <button className="btn btn-xs btn-ghost" onClick={() => onOpen(r)}>Open table</button>
        </div>
        {r.warnings.map((w) => <div key={w.message} className="lw-msg lw-warn"><TriangleAlert size={14} aria-hidden="true" /><span>{w.message}</span></div>)}
      </section>
    );
  }
  if (run.status === 'cancelled') {
    return <div className="lw-msg lw-warn" role="status"><TriangleAlert size={14} aria-hidden="true" /><span>The job was cancelled. Rows already written stay in the table.</span></div>;
  }
  return <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{run.message}</span></div>;
}
