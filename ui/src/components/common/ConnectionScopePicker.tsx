// Connection › database › schema picker for features that work on a whole schema of a connection (Schema compare;
// reusable by Data compare). Databases and schemas come from the catalog store; providers whose schema is the database
// (MySQL/MariaDB, Oracle...) show one level only. Connections can be greyed out with a reason (`disabledReason`).
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { schemaIsDatabase, schemaLevelLabel } from '../../lib/providerLevels';
import { dbKey, useCatalog } from '../../store/catalog';
import { getConnection, hasDatabaseLevel, isRelational, useConnections } from '../../store/connections';

export interface ConnectionScope {
  connectionId: string | null;
  /** Catalog database key (null: the connection's current database, or no database level). */
  database: string | null;
  /** Null: the default schema. */
  schema: string | null;
}

export interface ConnectionScopePickerProps {
  /** "Source" / "Target": prefixes the accessible names ("Source connection"). */
  label: string;
  value: ConnectionScope;
  onChange: (next: ConnectionScope) => void;
  /** Why a connection cannot be picked (shown in its option title, the option is disabled); null/undefined = it can. */
  disabledReason?: (connectionId: string) => string | null | undefined;
  disabled?: boolean;
}

/** The catalog database key the picker reads schemas from (the connection's current database when none is chosen). */
export function scopeCatalogDatabase(connectionId: string | null, database: string | null): string | null {
  if (!connectionId) return null;
  const c = getConnection(connectionId);
  if (!c || !hasDatabaseLevel(c.providerId)) return null;
  return database ?? useCatalog.getState().conns[connectionId]?.databases?.current ?? null;
}

/**
 * The engine endpoint of a scope: the database only for providers with a database level, and the schema the picker shows
 * as "(default: x)" when none is chosen (single-level providers need one: there the schema is the database).
 */
export function scopeEndpoint(v: ConnectionScope): { connectionId: string; database: string | null; schema: string | null } | null {
  if (!v.connectionId) return null;
  const database = scopeCatalogDatabase(v.connectionId, v.database);
  const cat = useCatalog.getState().dbs[dbKey(v.connectionId, database)];
  const schema = v.schema ?? cat?.schemasResp?.defaultSchema ?? cat?.defaultSchema ?? null;
  return { connectionId: v.connectionId, database, schema };
}

export function ConnectionScopePicker({ label, value, onChange, disabledReason, disabled }: ConnectionScopePickerProps) {
  const all = useConnections((s) => s.connections);
  const connections = useMemo(() => all.filter((c) => isRelational(c.id)), [all]);
  const cid = value.connectionId ?? '';
  const conn = connections.find((c) => c.id === cid) ?? getConnection(cid);
  const dbLevel = !!conn && hasDatabaseLevel(conn.providerId);
  const current = useCatalog((s) => (cid ? s.conns[cid]?.databases?.current ?? null : null));
  const databases = useCatalog((s) => (cid ? s.conns[cid]?.databases?.databases : undefined));
  const dbCatalog = dbLevel ? value.database ?? current : null;
  const dbCat = useCatalog((s) => (cid ? s.dbs[dbKey(cid, dbCatalog)] : undefined));

  useEffect(() => {
    if (cid && dbLevel) void useCatalog.getState().loadDatabases(cid);
  }, [cid, dbLevel]);
  useEffect(() => {
    if (cid && (!dbLevel || dbCatalog !== null || current !== null)) void useCatalog.getState().loadSchemas(cid, dbCatalog);
  }, [cid, dbLevel, dbCatalog, current]);

  const schemaNames = useMemo(() => {
    const names = dbCat?.schemasResp?.schemas.map((s) => s.name) ?? [];
    if (value.schema && !names.includes(value.schema)) names.push(value.schema);
    return names;
  }, [dbCat?.schemasResp, value.schema]);
  const defaultSchema = dbCat?.schemasResp?.defaultSchema ?? dbCat?.defaultSchema ?? null;
  const levelLabel = conn && schemaIsDatabase(conn.providerId) ? schemaLevelLabel(conn.providerId) : 'schema';
  const level = levelLabel.charAt(0).toUpperCase() + levelLabel.slice(1);

  return (
    <div className="scope-picker" role="group" aria-label={label}>
      <label className="scope-field">
        <span className="scope-label">{label}</span>
        <select
          className="input"
          aria-label={`${label} connection`}
          value={cid}
          disabled={disabled}
          onChange={(e) => onChange({ connectionId: e.target.value || null, database: null, schema: null })}
        >
          <option value="">Choose a connection…</option>
          {connections.map((c) => {
            const why = disabledReason?.(c.id) ?? null;
            return (
              <option key={c.id} value={c.id} disabled={!!why && c.id !== cid} title={why ?? undefined}>
                {c.name}
              </option>
            );
          })}
        </select>
      </label>
      {dbLevel && (
        <>
          <ChevronRight size={14} className="scope-crumb" aria-hidden="true" />
          <label className="scope-field">
            <span className="scope-label">Database</span>
            <select
              className="input"
              aria-label={`${label} database`}
              value={dbCatalog ?? ''}
              disabled={disabled || !cid}
              onChange={(e) => onChange({ connectionId: cid, database: e.target.value || null, schema: null })}
            >
              {!dbCatalog && <option value="">(connection default)</option>}
              {dbCatalog && !(databases ?? []).includes(dbCatalog) && <option value={dbCatalog}>{dbCatalog}</option>}
              {(databases ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        </>
      )}
      <ChevronRight size={14} className="scope-crumb" aria-hidden="true" />
      <label className="scope-field">
        <span className="scope-label">{level}</span>
        <select
          className="input"
          aria-label={`${label} ${levelLabel}`}
          value={value.schema ?? ''}
          disabled={disabled || !cid}
          onChange={(e) => onChange({ ...value, connectionId: cid, schema: e.target.value || null })}
        >
          <option value="">{defaultSchema ? `(default: ${defaultSchema})` : '(default)'}</option>
          {schemaNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
