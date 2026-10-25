// Kinds of user-defined type objects (catalog object type `type`), SSMS "Programmability › Types" style:
//   SQL Server: alias | table | clr | xmlschema      PostgreSQL: enum | domain | composite | range
//   Oracle:     object | varray | nested
// The engine reports the kind in `CatalogObject.k` (wire) and `ObjectListItem.kind`.
import type { CatalogObject, Dialect, ObjectRef } from '../api/types';
import { qualifiedName, quoteIdent } from './sql';

export interface TypeKindInfo {
  id: string;
  /** "User-Defined Table Types": explorer sub-folder and Objects-tab label. */
  plural: string;
  /** "user-defined table type": tooltips, the object tab header. */
  singular: string;
  /** Order of the sub-folders inside the Types folder. */
  order: number;
}

export const TYPE_KINDS: readonly TypeKindInfo[] = [
  { id: 'alias', plural: 'User-Defined Data Types', singular: 'user-defined data type', order: 1 },
  { id: 'table', plural: 'User-Defined Table Types', singular: 'user-defined table type', order: 2 },
  { id: 'clr', plural: 'CLR Types', singular: 'CLR type', order: 3 },
  { id: 'xmlschema', plural: 'XML Schema Collections', singular: 'XML schema collection', order: 4 },
  { id: 'enum', plural: 'Enums', singular: 'enum type', order: 1 },
  { id: 'domain', plural: 'Domains', singular: 'domain', order: 2 },
  { id: 'composite', plural: 'Composite Types', singular: 'composite type', order: 3 },
  { id: 'range', plural: 'Range Types', singular: 'range type', order: 4 },
  { id: 'object', plural: 'Object Types', singular: 'object type', order: 1 },
  { id: 'varray', plural: 'VARRAY Types', singular: 'VARRAY collection type', order: 2 },
  { id: 'nested', plural: 'Nested Table Types', singular: 'nested table collection type', order: 3 },
];

const BY_ID = new Map(TYPE_KINDS.map((k) => [k.id, k]));

export function typeKindInfo(kind: string | null | undefined): TypeKindInfo | null {
  return kind ? BY_ID.get(kind) ?? null : null;
}

/** The kind of a catalog `type` object (null for providers that do not report one, e.g. ClickHouse dictionaries). */
export function typeKindOf(o: Pick<CatalogObject, 'k'> | null | undefined): string | null {
  return o?.k && BY_ID.has(o.k) ? o.k : null;
}

/** "user-defined table type" (falls back to "type"). */
export function typeKindSingular(kind: string | null | undefined): string {
  return typeKindInfo(kind)?.singular ?? 'type';
}

/** Sub-folder order of two kinds (unknown kinds last). */
export function compareTypeKinds(a: string, b: string): number {
  return (BY_ID.get(a)?.order ?? 99) - (BY_ID.get(b)?.order ?? 99) || a.localeCompare(b);
}

/** The kind "New type…" creates when no sub-folder says otherwise. */
export function defaultTypeKind(dialect: Dialect): string | null {
  switch (dialect) {
    case 'tsql': return 'alias';
    case 'pgsql': return 'enum';
    case 'plsql': return 'object';
    default: return null;
  }
}

/** Whether the dialect has user-defined types a console template exists for. */
export function supportsTypes(dialect: Dialect): boolean {
  return defaultTypeKind(dialect) !== null;
}

/** The words after DROP for a type of this kind: `DROP TYPE`, `DROP DOMAIN`, `DROP XML SCHEMA COLLECTION`. */
export function dropKeywordOfType(kind: string | null | undefined, dialect: Dialect): string {
  if (kind === 'xmlschema') return 'XML SCHEMA COLLECTION';
  if (kind === 'domain' && dialect === 'pgsql') return 'DOMAIN';
  return 'TYPE';
}

/** The kinds a "New type…" template exists for in the dialect (the context menu offers them for the folder's kind). */
export function creatableKinds(dialect: Dialect): string[] {
  switch (dialect) {
    case 'tsql': return ['alias', 'table', 'clr', 'xmlschema'];
    case 'pgsql': return ['enum', 'domain', 'composite', 'range'];
    case 'plsql': return ['object', 'varray', 'nested'];
    default: return [];
  }
}

/** CREATE template for a new type, opened in a console ("New type…"). `kind` null = the dialect's default kind. */
export function newTypeTemplate(dialect: Dialect, schema: string | null, kind: string | null): string {
  const k = kind && creatableKinds(dialect).includes(kind) ? kind : defaultTypeKind(dialect);
  const name = (n: string) => qualifiedName({ schema, name: n }, dialect, { always: true });
  switch (`${dialect}:${k}`) {
    case 'tsql:alias':
      return `CREATE TYPE ${name('NewType')} FROM nvarchar(50) NOT NULL;\n`;
    case 'tsql:table':
      return `CREATE TYPE ${name('NewTableType')} AS TABLE (\n    ${quoteIdent('Id', dialect, true)} int NOT NULL,\n    ${quoteIdent('Name', dialect, true)} nvarchar(100) NULL,\n    PRIMARY KEY CLUSTERED (${quoteIdent('Id', dialect, true)})\n);\n`;
    case 'tsql:clr':
      return `CREATE TYPE ${name('NewClrType')}\nEXTERNAL NAME [AssemblyName].[Namespace.ClassName];\n`;
    case 'tsql:xmlschema':
      return `CREATE XML SCHEMA COLLECTION ${name('NewSchemaCollection')} AS N'<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:element name="root" type="xs:string"/>\n</xs:schema>';\n`;
    case 'pgsql:enum':
      return `CREATE TYPE ${name('new_enum')} AS ENUM ('first', 'second');\n`;
    case 'pgsql:domain':
      return `CREATE DOMAIN ${name('new_domain')} AS text\n    CHECK (VALUE <> '');\n`;
    case 'pgsql:composite':
      return `CREATE TYPE ${name('new_composite')} AS (\n    id integer,\n    name text\n);\n`;
    case 'pgsql:range':
      return `CREATE TYPE ${name('new_range')} AS RANGE (SUBTYPE = integer);\n`;
    case 'plsql:object':
      return `CREATE OR REPLACE TYPE ${name('NEW_OBJECT_T')} AS OBJECT (\n    ID NUMBER,\n    NAME VARCHAR2(100)\n);\n/\n`;
    case 'plsql:varray':
      return `CREATE OR REPLACE TYPE ${name('NEW_VARRAY_T')} AS VARRAY(10) OF VARCHAR2(100);\n/\n`;
    case 'plsql:nested':
      return `CREATE OR REPLACE TYPE ${name('NEW_TABLE_T')} AS TABLE OF VARCHAR2(100);\n/\n`;
    default:
      return '';
  }
}

/** `DROP TYPE [dbo].[Phone]` / `DROP DOMAIN public.positive_int` / `DROP XML SCHEMA COLLECTION …` (Oracle: FORCE is never added). */
export function dropTypeSql(ref: Pick<ObjectRef, 'schema' | 'name'>, kind: string | null | undefined, dialect: Dialect): string {
  return `DROP ${dropKeywordOfType(kind, dialect)} ${qualifiedName(ref, dialect, { always: true })}`;
}

// ---------------------------------------------------------------- SQL Server system data types

/** Explorer order of the SQL Server system type groups (SSMS: Exact Numerics, Approximate Numerics, …). */
export const SYSTEM_TYPE_CATEGORIES = [
  'Exact numerics', 'Approximate numerics', 'Date and time', 'Character strings', 'Unicode character strings', 'Binary strings',
  'Other data types', 'Spatial geometry types', 'Spatial geography types', 'CLR data types',
] as const;

export function compareSystemCategories(a: string, b: string): number {
  const ia = (SYSTEM_TYPE_CATEGORIES as readonly string[]).indexOf(a);
  const ib = (SYSTEM_TYPE_CATEGORIES as readonly string[]).indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** "max 8000 chars", "precision 18, scale 0", "4 bytes": the one-line size of a built-in type. */
export function systemTypeDetail(t: { name: string; maxLength: number | null; precision: number | null; scale: number | null }): string {
  const name = t.name.toLowerCase();
  const len = t.maxLength;
  switch (name) {
    case 'char': case 'varchar': return len === -1 ? 'max' : `up to ${len} bytes`;
    case 'nchar': case 'nvarchar': return len === -1 ? 'max' : `up to ${Math.floor((len ?? 0) / 2)} chars`;
    case 'binary': case 'varbinary': return len === -1 ? 'max' : `up to ${len} bytes`;
    case 'decimal': case 'numeric': return `precision up to ${t.precision}`;
    case 'float': case 'real': return `${len} bytes, precision ${t.precision}`;
    case 'sysname': return 'nvarchar(128)';
    default: break;
  }
  if (len === -1) return 'max';
  if (len && len > 0 && len <= 16) return `${len} byte${len === 1 ? '' : 's'}`;
  return '';
}
