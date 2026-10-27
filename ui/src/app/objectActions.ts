// Explorer object management (design-08 / design-p4): Drop…, Truncate…, Generate SQL ▸ SELECT/INSERT/UPDATE/DELETE,
// Copy DDL. Drop and Truncate show the exact statement and need an explicit danger confirmation (Cancel focused);
// they run through POST /designer/apply, which refreshes the catalog afterwards.
import { api, errorMessage } from '../api/client';
import type { CatalogColumnTuple, CatalogObjectType, Dialect, ObjectRef } from '../api/types';
import { qualifiedName, quoteIdent } from '../lib/sql';
import { dropTypeSql, typeKindOf } from '../lib/typeKinds';
import { dbKey, useCatalog } from '../store/catalog';
import { dialectOf, getConnection } from '../store/connections';
import { getActiveConsole } from '../store/tabs';
import { toast, useUi } from '../store/ui';
import { catalogDatabase, copyText, insertIntoActiveEditor, newConsole } from './actions';

export type SqlTemplate = 'select' | 'insert' | 'update' | 'delete';

const DROP_KEYWORD: Partial<Record<CatalogObjectType, string>> = {
  table: 'TABLE', view: 'VIEW', mview: 'MATERIALIZED VIEW', proc: 'PROCEDURE', func: 'FUNCTION', tablefunc: 'FUNCTION',
  trigger: 'TRIGGER', package: 'PACKAGE', sequence: 'SEQUENCE', synonym: 'SYNONYM', type: 'TYPE',
};

/** Object types Drop… is offered for (per dialect: no procedures/packages on SQLite). */
export function canDrop(type: CatalogObjectType, dialect: Dialect): boolean {
  if (!DROP_KEYWORD[type]) return false;
  if (dialect === 'sqlite') return type === 'table' || type === 'view' || type === 'trigger';
  if (dialect === 'tsql') return type !== 'package' && type !== 'mview';
  return true;
}

/** The kind (lib/typeKinds.ts) of a type object of the loaded catalog; null when its schema is not loaded or the provider reports none. */
export function catalogTypeKind(connectionId: string, database: string | null, ref: Pick<ObjectRef, 'schema' | 'name' | 'type'>): string | null {
  if (ref.type !== 'type') return null;
  const d = useCatalog.getState().dbs[dbKey(connectionId, catalogDatabase(connectionId, database))];
  const schema = d?.loaded[ref.schema ?? d?.defaultSchema ?? ''];
  return typeKindOf(schema?.objects.find((x) => x.t === 'type' && x.n === ref.name));
}

/** The statement Drop… runs (`kind`: the kind of a type object: DROP TYPE / DROP DOMAIN / DROP XML SCHEMA COLLECTION). */
export function dropSql(ref: Pick<ObjectRef, 'schema' | 'name' | 'type'>, dialect: Dialect, kind?: string | null): string {
  if (dialect === 'clickhouse') {
    // ClickHouse: dictionaries are DROP DICTIONARY (never DROP TYPE), a materialized view drops as a VIEW (the parser has no
    // DROP MATERIALIZED VIEW), and SQL user-defined functions are global: DROP FUNCTION name, no database prefix.
    if (ref.type === 'type') return `DROP DICTIONARY ${qualifiedName(ref, dialect, { always: true })}`;
    if (ref.type === 'mview') return `DROP VIEW ${qualifiedName(ref, dialect, { always: true })}`;
    if (ref.type === 'func') return `DROP FUNCTION ${quoteIdent(ref.name, dialect)}`;
  }
  if (ref.type === 'type' && kind) return dropTypeSql(ref, kind, dialect);
  const kw = DROP_KEYWORD[ref.type] ?? ref.type.toUpperCase();
  const name = qualifiedName(ref, dialect, { always: dialect !== 'sqlite' });
  const tail = dialect === 'plsql' && ref.type === 'table' ? ' PURGE' : '';
  return `DROP ${kw} ${name}${tail}`;
}

/** The statement Truncate… runs (SQLite has no TRUNCATE: an unfiltered DELETE). */
export function truncateSql(ref: Pick<ObjectRef, 'schema' | 'name'>, dialect: Dialect): string {
  const name = qualifiedName(ref, dialect, { always: dialect !== 'sqlite' });
  return dialect === 'sqlite' ? `DELETE FROM ${name}` : `TRUNCATE TABLE ${name}`;
}

/** Bind placeholder for a column: @name (T-SQL), :name (Oracle, SQLite). */
function param(col: string, dialect: Dialect): string {
  const n = col.replace(/\W+/g, '_').replace(/^(\d)/, '_$1');
  return dialect === 'tsql' ? `@${n}` : `:${n}`;
}

interface ColumnInfoLite { name: string; pk: boolean; generated: boolean }

/** Columns of an object from the loaded catalog (empty when its schema is not loaded). */
export function catalogColumns(connectionId: string, database: string | null, ref: ObjectRef): { columns: ColumnInfoLite[]; defaultSchema: string | null } {
  const d = useCatalog.getState().dbs[dbKey(connectionId, catalogDatabase(connectionId, database))];
  const schema = d?.loaded[ref.schema ?? d?.defaultSchema ?? ''];
  const o = schema?.objects.find((x) => x.n === ref.name && (x.t === ref.type || (x.t === 'mview' && ref.type === 'view')));
  const cols = (o?.c ?? []) as CatalogColumnTuple[];
  const pk = new Set(o?.pk ?? cols.filter((c) => c[3]).map((c) => c[0]));
  return {
    columns: cols.filter((c) => !(c[4] & 4)).map((c) => ({ name: c[0], pk: pk.has(c[0]), generated: (c[4] & 3) !== 0 })),
    defaultSchema: d?.defaultSchema ?? null,
  };
}

/** SELECT / INSERT / UPDATE / DELETE template for a table or view (bind placeholders for values and keys). */
export function sqlTemplate(kind: SqlTemplate, ref: ObjectRef, columns: readonly ColumnInfoLite[], dialect: Dialect, defaultSchema: string | null): string {
  const name = qualifiedName(ref, dialect, { defaultSchema, always: dialect === 'tsql' });
  const q = (c: string) => quoteIdent(c, dialect);
  const keys = columns.filter((c) => c.pk);
  const where = (keys.length ? keys : columns.slice(0, 1)).map((c) => `${q(c.name)} = ${param(c.name, dialect)}`).join('\n  AND ');
  const list = columns.length ? columns : [{ name: '*', pk: false, generated: false }];
  switch (kind) {
    case 'select':
      return `SELECT ${list.map((c) => (c.name === '*' ? '*' : q(c.name))).join(',\n       ')}\nFROM ${name};`;
    case 'insert': {
      const ins = columns.filter((c) => !c.generated);
      if (!ins.length) return `INSERT INTO ${name}\nVALUES ();`;
      return `INSERT INTO ${name} (${ins.map((c) => q(c.name)).join(', ')})\nVALUES (${ins.map((c) => param(c.name, dialect)).join(', ')});`;
    }
    case 'update': {
      const set = columns.filter((c) => !c.pk && !c.generated);
      // ClickHouse has no UPDATE statement: a mutation (the sorting-key columns cannot be changed, hence no pk columns in SET).
      if (dialect === 'clickhouse') {
        return `ALTER TABLE ${name}\nUPDATE ${(set.length ? set : columns).map((c) => `${q(c.name)} = ${param(c.name, dialect)}`).join(',\n       ')}\nWHERE ${where || '1 = 0'};`;
      }
      return `UPDATE ${name}\nSET ${(set.length ? set : columns).map((c) => `${q(c.name)} = ${param(c.name, dialect)}`).join(',\n    ')}\nWHERE ${where || '1 = 0'};`;
    }
    case 'delete':
      return `DELETE FROM ${name}\nWHERE ${where || '1 = 0'};`;
  }
}

/** Generate SQL ▸ …: inserted at the caret of the active console on the same connection, else in a new console. */
export function generateSqlInto(kind: SqlTemplate, connectionId: string, database: string | null, ref: ObjectRef): void {
  const dialect = dialectOf(connectionId);
  const { columns, defaultSchema } = catalogColumns(connectionId, database, ref);
  const sql = sqlTemplate(kind, ref, columns, dialect, defaultSchema);
  const active = getActiveConsole();
  if (active && active.connectionId === connectionId) {
    insertIntoActiveEditor(active.text.trim() ? `\n${sql}\n` : `${sql}\n`);
    return;
  }
  newConsole(connectionId, database, `${sql}\n`);
}

function refusedReadOnly(connectionId: string, what: string): boolean {
  const c = getConnection(connectionId);
  if (!c?.readOnly) return false;
  toast('warning', `“${c.name}” is read-only`, `${what} is not available on read-only connections. Edit the connection to allow changes.`);
  return true;
}

async function applyStatement(connectionId: string, database: string | null, ref: ObjectRef, sql: string, done: string): Promise<void> {
  const dialect = dialectOf(connectionId);
  try {
    await api.applyDdl(connectionId, { database: catalogDatabase(connectionId, database), statements: [sql], transactional: dialect !== 'plsql', schema: ref.schema });
    toast('success', done);
    void useCatalog.getState().refresh(connectionId);
  } catch (e) {
    toast('error', `Could not run ${sql.split(/\s+/).slice(0, 2).join(' ')}`, errorMessage(e));
  }
}

/** Drop…: shows the statement; Cancel is focused (danger confirmation). */
export async function dropObject(connectionId: string, database: string | null, ref: ObjectRef): Promise<void> {
  if (refusedReadOnly(connectionId, 'Drop')) return;
  const dialect = dialectOf(connectionId);
  const sql = dropSql(ref, dialect, catalogTypeKind(connectionId, database, ref));
  const conn = getConnection(connectionId);
  const users = ref.type === 'type' ? await typeUsers(connectionId, database, ref) : '';
  const ok = await useUi.getState().askConfirm({
    title: `Drop ${ref.name}?`,
    message: `This permanently removes the ${ref.type === 'mview' ? 'materialized view' : ref.type} from “${conn?.name ?? 'the connection'}”. It cannot be undone.${users} The statement:`,
    items: [sql],
    confirmLabel: 'Drop',
    danger: true,
  });
  if (ok) await applyStatement(connectionId, database, ref, sql, `Dropped ${ref.name}`);
}

/**
 * " It is used by 3 objects (dbo.Customers, dbo.SavePhones, …): the drop fails while they use it." for a type that is still
 * in use (from the object details); empty when it is unused or the usage cannot be read.
 */
async function typeUsers(connectionId: string, database: string | null, ref: ObjectRef): Promise<string> {
  try {
    const d = await api.objectDetails(connectionId, catalogDatabase(connectionId, database), ref);
    const used = d.typeInfo?.usedBy ?? [];
    if (!used.length) return '';
    const names = used.slice(0, 5).map((u) => (u.schema ? `${u.schema}.${u.name}` : u.name));
    const more = used.length > names.length ? `, and ${used.length - names.length} more` : '';
    return ` ⚠ It is still used by ${used.length} object${used.length === 1 ? '' : 's'} (${names.join(', ')}${more}): the drop fails until they stop using it.`;
  } catch {
    return '';
  }
}

/** Script as CREATE: the type's (or any object's) generated or stored definition in a new console. */
export async function scriptCreate(connectionId: string, database: string | null, ref: ObjectRef): Promise<void> {
  try {
    const r = await api.ddl(connectionId, catalogDatabase(connectionId, database), ref);
    newConsole(connectionId, database, r.ddl);
  } catch (e) {
    toast('error', `Could not load the definition of ${ref.name}`, errorMessage(e));
  }
}

/** Truncate…: removes every row of a table after an explicit confirmation. */
export async function truncateTable(connectionId: string, database: string | null, ref: ObjectRef): Promise<void> {
  if (refusedReadOnly(connectionId, 'Truncate')) return;
  const sql = truncateSql(ref, dialectOf(connectionId));
  const conn = getConnection(connectionId);
  const ok = await useUi.getState().askConfirm({
    title: `Delete all rows of ${ref.name}?`,
    message: `Every row of the table on “${conn?.name ?? 'the connection'}” is removed. The statement:`,
    items: [sql],
    confirmLabel: 'Delete all rows',
    danger: true,
  });
  if (ok) await applyStatement(connectionId, database, ref, sql, `Emptied ${ref.name}`);
}

/** Copy DDL: the stored definition (or the engine-generated CREATE) to the clipboard. */
export async function copyDdl(connectionId: string, database: string | null, ref: ObjectRef): Promise<void> {
  try {
    const r = await api.ddl(connectionId, catalogDatabase(connectionId, database), ref);
    await copyText(r.ddl, `Copied the DDL of ${ref.name}`);
  } catch (e) {
    toast('error', `Could not load the definition of ${ref.name}`, errorMessage(e));
  }
}
