// Link editor (plan-links 3): name, colour, folder and the sources of a linked database. Each source is a connection
// (→ database → schema) and the tables it mounts, queried as alias.table. Saved through /connections like any
// connection (provider 'linked', read-only). Opened by links.new / links.edit / links.duplicate and "Add to link…".
import { CircleAlert, Database, Eye, Link2, LoaderCircle, Plus, Search, Table2, TriangleAlert, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { errorMessage } from '../../../api/client';
import { LINK_DEFAULT_FOLDER, LINK_PROVIDER_ID, type LinkProblem } from '../../../api/links';
import type { CatalogObject, ConnectionProfile } from '../../../api/types';
import { readObjectDrag, ROWLIT_OBJECT_MIME } from '../../../lib/dragObject';
import { fuzzyFilter } from '../../../lib/fuzzy';
import { schemaIsDatabase, schemaLevelLabel } from '../../../lib/providerLevels';
import { dbKey, useCatalog } from '../../../store/catalog';
import { hasDatabaseLevel, providerKind, useConnections } from '../../../store/connections';
import { toast } from '../../../store/ui';
import { CONNECTION_PALETTE, connColorCss } from '../../../theme/connColors';
import { ProviderLogo } from '../../../theme/brand/ProviderLogo';
import { Dialog } from '../../common/Dialog';
import { Select, type SelectOption } from '../../common/Select';
import { openBuilder } from '../open';
import {
  addMembers, addSourceTables, draftFromProfile, draftSignature, emptyDraft, isSelected, linkNameOf, newMember, removeMember, renameTable,
  setAlias, setConnection, setScope, setTables, toConnectionInput, toDefinition, updateMember, validateDraft, type DraftMember, type DraftProblem,
  type LinkDraft,
} from './model';
import type { LinkEditorRequest } from './open';
import { engineProblems, saveLinkProfile } from './save';
import { databaseScopeField, isSourceProvider, mountsAll, SCOPE_LABELS, scopeNaming, scopesFor } from './scopes';
import './editor.css';

const TABULAR = new Set(['table', 'view', 'mview']);
/** Rows rendered in a table list before "refine the search". */
const LIST_LIMIT = 400;

/** The colour of a member: its connection's colour, else a palette colour by position. */
function memberColor(conn: Pick<ConnectionProfile, 'color'> | undefined, index: number): string {
  return connColorCss(conn?.color) ?? `var(${CONNECTION_PALETTE[index % CONNECTION_PALETTE.length].token})`;
}

/** The login's default schema, unless it is empty while others hold objects (then dbo / public / the fullest). */
function defaultSchemaOf(def: string | null, schemas: readonly { name: string; objectCount?: number | null }[]): string | null {
  if (!schemas.length) return def;
  const count = (n: string | null) => schemas.find((s) => s.name === n)?.objectCount;
  if (def && schemas.some((s) => s.name === def) && count(def) !== 0) return def;
  const full = schemas.filter((s) => (s.objectCount ?? 0) > 0);
  if (!full.length) return def && schemas.some((s) => s.name === def) ? def : schemas[0].name;
  return (full.find((s) => s.name === 'dbo' || s.name === 'public' || s.name === 'main') ?? [...full].sort((a, b) => (b.objectCount ?? 0) - (a.objectCount ?? 0))[0]).name;
}

/** The engine's problems mapped onto the draft (member index → member key). */
function fromEngine(problems: readonly LinkProblem[], d: LinkDraft): DraftProblem[] {
  return problems.map((p) => ({
    severity: p.severity, message: p.message,
    member: typeof p.member === 'number' ? d.members[p.member]?.key ?? null : null,
    field: p.code.startsWith('alias') ? 'alias' : p.code.startsWith('table') || p.code === 'noTables' ? 'tables' : p.code.startsWith('member') ? 'connection'
      : p.code.startsWith('scope') ? 'scope' : null,
    table: p.table ?? null,
  }));
}

function initialDraft(req: LinkEditorRequest, connections: readonly ConnectionProfile[]): { draft: LinkDraft; select: string | null; missing: boolean } {
  const editing = req.connectionId ? connections.find((c) => c.id === req.connectionId) : undefined;
  let draft: LinkDraft;
  if (req.mode !== 'new' && editing) draft = draftFromProfile(editing, req.mode);
  else draft = { ...emptyDraft(req.folder ?? LINK_DEFAULT_FOLDER), name: 'Linked database' };
  let select: string | null = draft.members[0]?.key ?? null;
  if (req.members?.length) {
    const r = addMembers(draft, req.members);
    draft = r.draft;
    select = r.select ?? select;
  }
  if (req.addTables?.length) {
    const r = addSourceTables(draft, req.addTables, connections);
    draft = r.draft;
    select = r.select ?? select;
  }
  if (!draft.members.length) {
    const m = newMember(draft);
    draft = { ...draft, members: [m] };
    select = m.key;
  }
  return { draft, select, missing: req.mode !== 'new' && !editing };
}

export function LinkEditorDialog({ req, onClose }: { req: LinkEditorRequest; onClose(): void }) {
  const connections = useConnections((s) => s.connections);
  const [init] = useState(() => initialDraft(req, useConnections.getState().connections));
  const [draft, setDraft] = useState<LinkDraft>(init.draft);
  const [selected, setSelected] = useState<string | null>(init.select);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engine, setEngine] = useState<DraftProblem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dropping, setDropping] = useState(false);
  // a new link, or an edit that opened with tables to add, starts dirty
  const [pristine] = useState(() => (req.mode === 'edit' && !req.addTables?.length && !req.members?.length ? draftSignature(init.draft) : null));
  const dirty = pristine === null || draftSignature(draft) !== pristine;
  const isEdit = req.mode === 'edit' && !init.missing;
  const editingId = isEdit ? req.connectionId ?? undefined : undefined;

  useEffect(() => {
    if (init.missing) {
      toast('error', 'The linked database no longer exists');
      onClose();
    }
  }, [init.missing, onClose]);

  const local = useMemo(() => validateDraft(draft, connections), [draft, connections]);
  const problems = useMemo(() => [...local, ...engine], [local, engine]);
  const errors = problems.filter((p) => p.severity === 'error');
  /** Shown problems: alias (once one is typed) and rename mistakes right away, the rest once Save was tried. */
  const visible = (p: DraftProblem) => attempted || (p.field === 'alias' && !!draft.members.find((m) => m.key === p.member)?.alias) || p.field === 'table';
  const member = draft.members.find((m) => m.key === selected) ?? null;
  const change = (fn: (d: LinkDraft) => LinkDraft) => {
    setDraft((d) => fn(d));
    setEngine([]);
    setSaveError(null);
    setConfirmDiscard(false);
  };

  const close = () => {
    if (dirty && !saving) setConfirmDiscard(true);
    else onClose();
  };

  const addSource = () => {
    const m = newMember(draft);
    change((d) => ({ ...d, members: [...d.members, m] }));
    setSelected(m.key);
  };

  const onDrop = (e: DragEvent) => {
    setDropping(false);
    const o = readObjectDrag(e.dataTransfer);
    if (!o) return;
    e.preventDefault();
    if (o.providerId === LINK_PROVIDER_ID || !TABULAR.has(o.type)) {
      toast('info', o.providerId === LINK_PROVIDER_ID ? 'That table already belongs to a linked database' : 'Only tables and views can be mounted');
      return;
    }
    const r = addSourceTables(draft, [{ connectionId: o.connectionId, database: o.database, schema: o.schema, name: o.name, type: o.type }], connections);
    change(() => r.draft);
    if (r.select) setSelected(r.select);
  };

  const save = async () => {
    setAttempted(true);
    const blocking = local.filter((p) => p.severity === 'error');
    if (blocking.length) {
      const first = blocking.find((p) => p.member)?.member;
      if (first) setSelected(first);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const fromServer = await engineProblems(toDefinition(draft), editingId ?? null);
      const mapped = fromServer ? fromEngine(fromServer, draft) : [];
      setEngine(mapped);
      const serverErrors = mapped.filter((p) => p.severity === 'error');
      if (serverErrors.length) {
        const first = serverErrors.find((p) => p.member)?.member;
        if (first) setSelected(first);
        return;
      }
      const saved = await saveLinkProfile(toConnectionInput(draft), editingId);
      onClose();
      const n = draft.members.length;
      const warnings = mapped.filter((p) => p.severity === 'warning');
      toast(warnings.length ? 'warning' : 'success', `Linked database “${saved.name}” saved`,
        warnings.length ? warnings.map((w) => w.message).join(' ') : `${n} source${n === 1 ? '' : 's'}. Query its tables as alias.table, or open the query builder.`);
      if (!isEdit && req.connectAfter !== false) openBuilder(saved.id);
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? `Edit linked database — ${draft.name || 'untitled'}` : req.mode === 'duplicate' ? 'Duplicate linked database' : 'New linked database';
  const shownErrors = errors.filter(visible);
  const general = problems.filter((p) => !p.member && p.field !== 'name' && visible(p));

  return (
    <Dialog
      title={<span className="lke-title"><Link2 size={16} aria-hidden /> {title}</span>}
      ariaLabel={title}
      onClose={close}
      width="min(1000px, calc(100vw - 32px))"
      className="lke"
      footer={confirmDiscard ? (
        <div className="lke-discard" role="alertdialog" aria-label="Discard changes">
          <TriangleAlert size={14} aria-hidden />
          <span>Discard your changes to this linked database?</span>
          <div className="flex-1" />
          <button className="btn" data-autofocus onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          <button className="btn btn-danger" onClick={onClose}>Discard</button>
        </div>
      ) : (
        <>
          {attempted && shownErrors.length > 0 ? (
            <span className="lke-foot-status error" role="status">
              <CircleAlert size={14} aria-hidden /> {shownErrors.length} problem{shownErrors.length === 1 ? '' : 's'} to fix
            </span>
          ) : (
            <span className="lke-foot-status muted">{summary(draft)}</span>
          )}
          <div className="flex-1" />
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <LoaderCircle size={14} className="spin" aria-hidden />}
            {isEdit ? 'Save' : 'Create linked database'}
          </button>
        </>
      )}
    >
      <div
        className={`lke-body${dropping ? ' dropping' : ''}`}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types ?? []).includes(ROWLIT_OBJECT_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!dropping) setDropping(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropping(false);
        }}
        onDrop={onDrop}
      >
        {req.mode === 'new' && (
          <p className="lke-intro">
            Mount tables from several connections and query them together as <code>alias.table</code>, in SQL or with the visual query builder.
            Rows are read from the sources when a query runs; nothing is copied or changed.
          </p>
        )}
        <div className="lke-head">
          <label className="lke-field lke-name">
            <span className="form-label">Name</span>
            <input
              className={`input${attempted && problems.some((p) => p.field === 'name') ? ' invalid' : ''}`}
              value={draft.name}
              placeholder="Linked database"
              aria-label="Name"
              onChange={(e) => change((d) => ({ ...d, name: e.target.value }))}
            />
          </label>
          <div className="lke-field">
            <span className="form-label" id="lke-color">Colour</span>
            <div className="color-swatches" role="radiogroup" aria-labelledby="lke-color">
              <button className={`swatch none${draft.color === null ? ' selected' : ''}`} role="radio" aria-checked={draft.color === null} title="No colour" aria-label="No colour" onClick={() => change((d) => ({ ...d, color: null }))} />
              {CONNECTION_PALETTE.map((c) => (
                <button
                  key={c.id}
                  className={`swatch${draft.color?.toLowerCase() === c.hex ? ' selected' : ''}`}
                  role="radio"
                  aria-checked={draft.color?.toLowerCase() === c.hex}
                  aria-label={c.name}
                  title={c.name}
                  style={{ background: connColorCss(c.hex) }}
                  onClick={() => change((d) => ({ ...d, color: c.hex }))}
                />
              ))}
            </div>
          </div>
          <label className="lke-field lke-folder">
            <span className="form-label">Folder</span>
            <input className="input" value={draft.folder} placeholder="None" aria-label="Folder" onChange={(e) => change((d) => ({ ...d, folder: e.target.value }))} />
          </label>
        </div>

        {(saveError || general.length > 0) && (
          <div className="lke-banner" role="alert">
            <CircleAlert size={14} aria-hidden />
            <ul>
              {saveError && <li>Could not save: {saveError}</li>}
              {general.map((p, i) => <li key={i} className={p.severity}>{p.message}</li>)}
            </ul>
          </div>
        )}

        <div className="lke-main">
          <MemberList
            draft={draft}
            connections={connections}
            selected={selected}
            problems={problems.filter(visible)}
            onSelect={setSelected}
            onAdd={addSource}
            onRemove={(key) => {
              const i = draft.members.findIndex((m) => m.key === key);
              change((d) => removeMember(d, key));
              if (selected === key) setSelected(draft.members[i + 1]?.key ?? draft.members[i - 1]?.key ?? null);
            }}
          />
          {member ? (
            <MemberEditor
              key={member.key}
              member={member}
              index={draft.members.indexOf(member)}
              connections={connections}
              problems={problems.filter((p) => p.member === member.key && visible(p))}
              onChange={change}
            />
          ) : (
            <div className="lke-empty">
              <Database size={28} strokeWidth={1.5} aria-hidden />
              <div>Add a source: a connection and the tables it brings into the link.</div>
              <button className="btn btn-primary" onClick={addSource}><Plus size={14} aria-hidden /> Add source</button>
              <div className="muted"><Upload size={12} aria-hidden /> Or drop tables from the explorer here.</div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function summary(d: LinkDraft): string {
  const sources = d.members.filter((m) => m.connectionId).length;
  const tables = d.members.reduce((a, m) => a + (mountsAll(m.scope) ? 0 : m.tables.length), 0);
  const all = d.members.filter((m) => mountsAll(m.scope)).length;
  if (!sources) return 'No source yet';
  return `${sources} source${sources === 1 ? '' : 's'} · ${tables} table${tables === 1 ? '' : 's'}${all ? ` + every table of ${all} source${all === 1 ? '' : 's'}` : ''}`;
}

/** "3 tables", "whole schema"… of a member (sources list). */
function memberCount(m: DraftMember): string {
  if (m.scope === 'tables') return `${m.tables.length} table${m.tables.length === 1 ? '' : 's'}`;
  return SCOPE_LABELS[m.scope].toLowerCase();
}

/** "Postgres Shop · public" / "· shop" (whole database) / nothing more (whole connection). */
function memberPlace(m: DraftMember): string {
  if (m.scope === 'connection') return '';
  if (m.scope === 'database') return m.database ? ` · ${m.database}` : m.schema ? ` · ${m.schema}` : '';
  return m.schema ? ` · ${m.schema}` : '';
}

// ---------------------------------------------------------------- members list

function MemberList({ draft, connections, selected, problems, onSelect, onAdd, onRemove }: {
  draft: LinkDraft;
  connections: readonly ConnectionProfile[];
  selected: string | null;
  problems: DraftProblem[];
  onSelect(key: string): void;
  onAdd(): void;
  onRemove(key: string): void;
}) {
  return (
    <aside className="lke-members" aria-label="Sources">
      <div className="lke-members-head">
        <span>Sources</span>
        <span className="muted">{draft.members.length}</span>
      </div>
      <ul className="lke-member-list" role="listbox" aria-label="Sources of the link">
        {draft.members.map((m, i) => {
          const conn = connections.find((c) => c.id === m.connectionId);
          const bad = problems.some((p) => p.member === m.key && p.severity === 'error');
          const count = memberCount(m);
          return (
            <li key={m.key} className={`lke-member-item${m.key === selected ? ' selected' : ''}${bad ? ' invalid' : ''}`}>
              <button
                className="lke-member-btn"
                role="option"
                aria-selected={m.key === selected}
                onClick={() => onSelect(m.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const next = draft.members[i + (e.key === 'ArrowDown' ? 1 : -1)];
                  if (next) {
                    onSelect(next.key);
                    (e.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('.lke-member-btn')[draft.members.indexOf(next)])?.focus();
                  }
                }}
              >
                <span className="lke-member-bar" style={{ background: memberColor(conn, i) }} aria-hidden />
                {conn ? <ProviderLogo providerId={conn.providerId} size={18} /> : <Database size={18} className="muted" aria-hidden />}
                <span className="lke-member-text">
                  <span className="lke-member-alias mono">{m.alias || 'new source'}</span>
                  <span className="lke-member-conn">{conn ? `${conn.name}${memberPlace(m)}` : 'Choose a connection'}</span>
                </span>
                <span className="lke-member-count">{m.connectionId ? count : ''}</span>
                {bad && <CircleAlert size={14} className="lke-member-bad" aria-label="Has problems" />}
              </button>
              <button className="icon-btn sm lke-member-remove" title={`Remove ${m.alias || 'this source'}`} aria-label={`Remove ${m.alias || 'source'}`} onClick={() => onRemove(m.key)}>
                <X size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn lke-add" onClick={onAdd}><Plus size={13} aria-hidden /> Add source</button>
      <div className="lke-members-hint muted">Tip: drag tables from the explorer onto this dialog.</div>
    </aside>
  );
}

// ---------------------------------------------------------------- one member

function MemberEditor({ member: m, index, connections, problems, onChange }: {
  member: DraftMember;
  index: number;
  connections: readonly ConnectionProfile[];
  problems: DraftProblem[];
  onChange(fn: (d: LinkDraft) => LinkDraft): void;
}) {
  const conn = connections.find((c) => c.id === m.connectionId);
  const files = m.rest?.kind === 'files';
  // MongoDB / Elasticsearch members mount without the explorer's table catalog: no schema or table pickers
  const catalogBacked = !!conn && !isSourceProvider(conn.providerId);
  const cid = conn && catalogBacked ? conn.id : null;
  const scope = m.scope;
  const dbField = conn ? databaseScopeField(conn.providerId) : null;
  /** The scope picks a schema (tables / schema; a whole database where the database is the provider's schema level). */
  const pickSchema = scope === 'tables' || scope === 'schema' || (scope === 'database' && dbField === 'schema');
  const withDb = !!conn && hasDatabaseLevel(conn.providerId) && scope !== 'connection';
  const db = withDb ? m.database : null;
  const conns = useCatalog((s) => (cid ? s.conns[cid] : undefined));
  const dbEntry = useCatalog((s) => (cid ? s.dbs[dbKey(cid, db)] : undefined));
  const schemaLabel = conn && schemaIsDatabase(conn.providerId) ? cap(schemaLevelLabel(conn.providerId)) : 'Schema';
  const problem = (field: DraftProblem['field']) => problems.find((p) => p.field === field);
  const scopes = conn ? scopesFor(conn.providerId, files ? 'files' : 'connection') : scopesFor(null, files ? 'files' : 'connection');

  // the place loads step by step: databases → (default database) → schemas → (default schema) → tables
  useEffect(() => {
    if (cid && withDb) void useCatalog.getState().loadDatabases(cid);
  }, [cid, withDb]);
  const databases = conns?.databases;
  useEffect(() => {
    if (!cid || !withDb || m.database || !databases) return;
    const pick = databases.current ?? databases.databases[0] ?? null;
    // filling in an empty place keeps the tables (Add to link… may have given them without a database)
    if (pick) onChange((d) => updateMember(d, m.key, (x) => ({ ...x, database: pick })));
  }, [cid, withDb, m.database, databases]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!cid && (!withDb || !!m.database) && pickSchema;
  useEffect(() => {
    if (ready && cid) void useCatalog.getState().loadSchemas(cid, db);
  }, [ready, cid, db]);
  const schemasResp = dbEntry?.schemasResp;
  useEffect(() => {
    if (!ready || m.schema || !schemasResp) return;
    const pick = defaultSchemaOf(schemasResp.defaultSchema, schemasResp.schemas);
    if (pick) onChange((d) => updateMember(d, m.key, (x) => ({ ...x, schema: pick })));
  }, [ready, m.schema, schemasResp]); // eslint-disable-line react-hooks/exhaustive-deps
  const listTables = ready && (scope === 'tables' || scope === 'schema');
  useEffect(() => {
    if (listTables && cid && m.schema) void useCatalog.getState().loadSchema(cid, db, m.schema);
  }, [listTables, cid, db, m.schema]);

  const connOptions = useMemo<SelectOption[]>(() => connections
    .filter((c) => c.providerId !== LINK_PROVIDER_ID)
    .map((c) => {
      const ok = providerKind(c.providerId) === 'relational' || isSourceProvider(c.providerId);
      return {
        value: c.id, label: c.name, group: c.folder ?? 'Connections', icon: <ProviderLogo providerId={c.providerId} size={14} />,
        disabled: !ok, hint: ok ? undefined : 'Not supported yet',
        title: ok ? undefined : 'Linked databases mount relational tables; this kind of source comes later.',
      };
    })
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label)), [connections]);

  const schemaOptions: SelectOption[] = (schemasResp?.schemas ?? []).map((s) => ({
    value: s.name, label: s.name, hint: typeof s.objectCount === 'number' ? `${s.objectCount} object${s.objectCount === 1 ? '' : 's'}` : undefined,
  }));
  if (m.schema && !schemaOptions.some((o) => o.value === m.schema)) schemaOptions.unshift({ value: m.schema, label: m.schema });
  const dbOptions: SelectOption[] = (databases?.databases ?? []).map((d) => ({ value: d, label: d }));
  if (m.database && !dbOptions.some((o) => o.value === m.database)) dbOptions.unshift({ value: m.database, label: m.database });

  const objects = m.schema ? dbEntry?.loaded[m.schema]?.objects : undefined;
  const schemaStatus = m.schema ? dbEntry?.schemaStatus[m.schema] : undefined;
  const schemaError = m.schema ? dbEntry?.schemaError[m.schema] : undefined;
  const aliasErr = problem('alias');
  const aliasLive = aliasErr?.message ?? null;
  const example = scope === 'database' && dbField !== 'schema' ? 'schema.table'
    : scope === 'connection' ? (hasDatabaseLevel(conn?.providerId) ? 'database.schema.table' : conn && dbField === 'schema' ? 'database.table' : conn?.providerId === 'elasticsearch' ? 'index' : 'schema.table')
      : m.tables[0] ? linkNameOf(m.tables[0]) : objects?.find((o) => TABULAR.has(o.t))?.n ?? 'table';
  const sourceDb = !!conn && !catalogBacked && scope === 'database' && dbField === 'schema';

  return (
    <section className="lke-editor" aria-label={`Source ${m.alias || index + 1}`}>
      <div className="lke-grid">
        <span className="form-label" id={`lke-conn-${m.key}`}>Connection</span>
        <div className="form-control">
          <Select
            aria-labelledby={`lke-conn-${m.key}`}
            aria-invalid={!!problem('connection')}
            value={m.connectionId}
            placeholder="Choose a connection…"
            options={connOptions}
            onChange={(id) => {
              const c = connections.find((x) => x.id === id);
              if (c) onChange((d) => setConnection(d, m.key, c));
            }}
            leadingIcon={conn ? <ProviderLogo providerId={conn.providerId} size={14} /> : undefined}
            searchable="auto"
          />
          {problem('connection') && <div className="form-error" role="alert">{problem('connection')!.message}</div>}
        </div>

        {conn && !files && (
          <>
            <span className="form-label" id={`lke-scope-${m.key}`}>Mount</span>
            <div className="form-control">
              <div className="segmented lke-scope" role="radiogroup" aria-labelledby={`lke-scope-${m.key}`}>
                {scopes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    className={scope === s ? 'on' : undefined}
                    title={scopeTitle(s)}
                    onClick={() => onChange((d) => setScope(d, m.key, s))}
                  >
                    {SCOPE_LABELS[s]}
                  </button>
                ))}
              </div>
              {problem('scope') && <div className="form-error" role="alert">{problem('scope')!.message}</div>}
              {mountsAll(scope) && scope !== 'schema' && (
                <div className="form-help lke-scope-note">
                  {scopeNaming(scope, conn.providerId, m.alias)} Its tables load when a query or the builder uses them.
                </div>
              )}
            </div>
          </>
        )}

        {withDb && (
          <>
            <span className="form-label" id={`lke-db-${m.key}`}>Database</span>
            <div className="form-control">
              <Select
                aria-labelledby={`lke-db-${m.key}`}
                value={m.database}
                placeholder={conns?.status === 'loading' ? 'Loading databases…' : 'Choose a database…'}
                options={dbOptions}
                onChange={(v) => onChange((d) => updateMember(d, m.key, (x) => ({ ...x, database: v, schema: null, tables: [] })))}
              />
              {conns?.status === 'error' && <div className="form-error">{conns.error}</div>}
              {problem('database') && <div className="form-error" role="alert">{problem('database')!.message}</div>}
            </div>
          </>
        )}

        {sourceDb && (
          <>
            <label className="form-label" htmlFor={`lke-sdb-${m.key}`}>Database</label>
            <div className="form-control">
              <input
                id={`lke-sdb-${m.key}`}
                className={`input mono${problem('schema') ? ' invalid' : ''}`}
                value={m.schema ?? ''}
                spellCheck={false}
                placeholder="Database name"
                onChange={(e) => onChange((d) => updateMember(d, m.key, (x) => ({ ...x, schema: e.target.value || null })))}
              />
              {problem('schema') && <div className="form-error" role="alert">{problem('schema')!.message}</div>}
            </div>
          </>
        )}

        {cid && pickSchema && (
          <>
            <span className="form-label" id={`lke-schema-${m.key}`}>{schemaLabel}</span>
            <div className="form-control">
              <Select
                aria-labelledby={`lke-schema-${m.key}`}
                aria-invalid={!!problem('schema')}
                value={m.schema}
                placeholder={dbEntry?.schemasStatus === 'loading' ? 'Loading…' : `Choose a ${schemaLabel.toLowerCase()}…`}
                options={schemaOptions}
                onChange={(v) => onChange((d) => updateMember(d, m.key, (x) => ({ ...x, schema: v, tables: [] })))}
              />
              {dbEntry?.schemasStatus === 'error' && <div className="form-error">{dbEntry.schemasError}</div>}
              {problem('schema') && <div className="form-error" role="alert">{problem('schema')!.message}</div>}
            </div>
          </>
        )}

        <label className="form-label" htmlFor={`lke-alias-${m.key}`}>Alias</label>
        <div className="form-control">
          <div className="lke-alias-row">
            <input
              id={`lke-alias-${m.key}`}
              className={`input mono lke-alias${aliasLive ? ' invalid' : ''}`}
              value={m.alias}
              spellCheck={false}
              autoComplete="off"
              placeholder="crm"
              aria-invalid={aliasLive ? true : undefined}
              aria-describedby={`lke-alias-help-${m.key}`}
              onChange={(e) => onChange((d) => setAlias(d, m.key, e.target.value))}
            />
            <span className="lke-alias-example" aria-hidden>
              <span className="mono">{m.alias || 'alias'}.{example}</span>
            </span>
          </div>
          <div className={aliasLive ? 'form-error' : 'form-help'} id={`lke-alias-help-${m.key}`} role={aliasLive ? 'alert' : undefined}>
            {aliasLive ?? (mountsAll(scope) && scope !== 'schema'
              ? `The name of this source inside the link: queries name its tables ${m.alias || 'alias'}.${example}.`
              : 'The schema name of this source inside the link: queries name its tables alias.table.')}
          </div>
        </div>

        <label className="form-label" htmlFor={`lke-label-${m.key}`}>Label</label>
        <div className="form-control">
          <input
            id={`lke-label-${m.key}`}
            className="input"
            value={m.label}
            placeholder="Optional description (shown in the builder)"
            onChange={(e) => onChange((d) => updateMember(d, m.key, (x) => ({ ...x, label: e.target.value })))}
          />
        </div>
      </div>

      {listTables && cid && m.schema && (
        <TableList
          member={m}
          objects={objects}
          status={schemaStatus}
          error={schemaError}
          problems={problems}
          onChange={onChange}
          onRetry={() => void useCatalog.getState().loadSchema(cid, db, m.schema!, true)}
        />
      )}
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function scopeTitle(s: DraftMember['scope']): string {
  switch (s) {
    case 'tables': return 'The tables you pick below';
    case 'schema': return 'Every table and view of the schema, including ones created later';
    case 'database': return 'Every schema of the database (tables load when used)';
    default: return 'Every database of the connection (tables load when used)';
  }
}

// ---------------------------------------------------------------- tables of a member

function highlight(text: string, positions: readonly number[]): ReactNode {
  if (!positions.length) return text;
  const set = new Set(positions);
  const out: ReactNode[] = [];
  let run = '';
  let hit = false;
  const flush = (k: number) => {
    if (!run) return;
    out.push(hit ? <mark key={k} className="lke-hit">{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== hit) {
      flush(i);
      hit = h;
    }
    run += text[i];
  }
  flush(text.length);
  return out;
}

function TableList({ member: m, objects, status, error, problems, onChange, onRetry }: {
  member: DraftMember;
  objects: readonly CatalogObject[] | undefined;
  status: string | undefined;
  error: string | undefined;
  problems: DraftProblem[];
  onChange(fn: (d: LinkDraft) => LinkDraft): void;
  onRetry(): void;
}) {
  const [q, setQ] = useState('');
  const tables = useMemo(() => (objects ?? []).filter((o) => TABULAR.has(o.t)), [objects]);
  // tables the link mounts that the source no longer has (renamed or dropped there) stay visible, flagged
  const missing = m.tables.filter((t) => objects && !tables.some((o) => o.n === t.name));
  const filtered = useMemo(() => fuzzyFilter(tables, q.trim(), (o) => o.n), [tables, q]);
  const shown = filtered.slice(0, LIST_LIMIT);
  const all = mountsAll(m.scope);
  const selectedCount = all ? tables.length : m.tables.length;
  const tablesProblem = problems.find((p) => p.field === 'tables');
  const set = (list: readonly CatalogObject[], on: boolean) => onChange((d) => setTables(d, m.key, list.map((o) => ({ name: o.n, type: o.t })), on));

  return (
    <div className="lke-tables-wrap">
      <div className="lke-tables-bar">
        <span className="lke-tables-title">Tables</span>
        <span className="lke-search">
          <Search size={13} aria-hidden className="lke-search-icon" />
          <input
            className="input sm"
            type="search"
            value={q}
            placeholder={`Search ${tables.length} table${tables.length === 1 ? '' : 's'}…`}
            aria-label="Search tables"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.stopPropagation();
                setQ('');
              }
            }}
          />
        </span>
        {all && <span className="muted lke-all-note">Whole schema: every table and view, including future ones. Rename any of them below.</span>}
        <div className="flex-1" />
        <button className="link-btn" disabled={all || !filtered.length} onClick={() => set(filtered.map((f) => f.item), true)}>
          Select {q.trim() ? 'matching' : 'all'}
        </button>
        <button className="link-btn" disabled={all || !m.tables.length} onClick={() => set(q.trim() ? filtered.map((f) => f.item) : tables, false)}>
          Select none
        </button>
        <span className="lke-count muted" aria-live="polite">{selectedCount} of {tables.length} {all ? 'mounted' : 'selected'}</span>
      </div>
      {tablesProblem && <div className="form-error lke-tables-error" role="alert">{tablesProblem.message}</div>}
      <div className="lke-tables" role="group" aria-label={`Tables of ${m.alias || 'the source'}`}>
        {status === 'loading' && !objects && (
          <div className="lke-tables-state"><LoaderCircle size={14} className="spin" aria-hidden /> Loading tables…</div>
        )}
        {status === 'error' && (
          <div className="lke-tables-state error">
            <CircleAlert size={14} aria-hidden /> {error ?? 'Could not load the tables.'}
            <button className="link-btn" onClick={onRetry}>Retry</button>
          </div>
        )}
        {objects && !tables.length && <div className="lke-tables-state muted">This {m.schema ? `“${m.schema}”` : 'schema'} has no tables or views.</div>}
        {objects && tables.length > 0 && !filtered.length && <div className="lke-tables-state muted">No table matches “{q}”.</div>}
        {shown.map(({ item: o, match }) => {
          const on = isSelected(m, o.n);
          const t = m.tables.find((x) => x.name === o.n);
          const err = problems.find((p) => p.field === 'table' && p.table === o.n);
          return (
            <div key={o.n} className={`lke-table${on ? ' on' : ''}${err ? ' invalid' : ''}`}>
              <label className="lke-table-main">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={all}
                  aria-label={`Mount ${o.n}`}
                  onChange={(e) => set([o], e.target.checked)}
                />
                {o.t === 'table' ? <Table2 size={14} className="lke-ico-table" aria-hidden /> : <Eye size={14} className="lke-ico-view" aria-hidden />}
                <span className="lke-table-name mono" title={o.cm ?? undefined}>{highlight(o.n, match.positions)}</span>
                <span className="lke-table-hint muted">
                  {o.t !== 'table' ? `${o.t === 'mview' ? 'materialized view' : 'view'} · ` : ''}{o.c ? `${o.c.length} column${o.c.length === 1 ? '' : 's'}` : ''}
                </span>
              </label>
              {on && (
                <span className="lke-as">
                  <span className="muted" aria-hidden>as</span>
                  <input
                    className={`input xs mono${err ? ' invalid' : ''}`}
                    value={t?.as ?? ''}
                    placeholder={o.n}
                    spellCheck={false}
                    aria-label={`Name of ${o.n} in the link`}
                    aria-invalid={err ? true : undefined}
                    title={err?.message ?? 'Optional: the name queries use for this table (default: the source name)'}
                    onChange={(e) => onChange((d) => renameTable(d, m.key, { name: o.n, type: o.t }, e.target.value))}
                  />
                </span>
              )}
              {err && <div className="form-error lke-table-error" role="alert">{err.message}</div>}
            </div>
          );
        })}
        {filtered.length > shown.length && (
          <div className="lke-tables-state muted">{filtered.length - shown.length} more: refine the search to see them.</div>
        )}
        {missing.map((t) => (
          <div key={`missing:${t.name}`} className="lke-table on missing">
            <label className="lke-table-main">
              <input type="checkbox" checked aria-label={`Mount ${t.name}`} onChange={() => onChange((d) => setTables(d, m.key, [t], false))} />
              <TriangleAlert size={14} className="lke-ico-missing" aria-hidden />
              <span className="lke-table-name mono">{t.name}</span>
              <span className="lke-table-hint">not found in {m.schema}</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

