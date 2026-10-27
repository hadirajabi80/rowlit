// In-memory index over CatalogSnapshot: schema/object/column maps, FK graph, synonym and dialect name resolution.
import type {
  CatalogObject, CatalogObjectType, CatalogPackageMember, CatalogParamTuple, CatalogSchema, CatalogSnapshot,
} from '../../api/types';
import type { DialectSpec, PackageDef } from '../dialect/spec';
import type { ColumnDef } from '../parse/statement-model';

export interface FkEdge {
  name: string;
  from: ObjectEntry;
  fromCols: string[];
  to: ObjectEntry | null;
  toSchema: string | null;
  toTable: string;
  toCols: string[];
}

/** Load state of another database's catalog. */
export type ForeignStatus = 'loading' | 'ready' | 'error';

/**
 * Catalog of ANOTHER database of the same server (T-SQL `Other.dbo.Orders`), loaded lazily by the host: the schema list
 * first (`status`), then the objects of the schemas that are used. `snapshot` carries the schemas loaded so far (and
 * `schemaNames`, every schema of that database); null until the host has the schema list.
 */
export interface ForeignCatalogInput {
  database: string;
  status: ForeignStatus;
  snapshot: CatalogSnapshot | null;
  /** Schemas whose load failed or came back empty: never shown as "Loading…". */
  failed?: readonly string[];
}

interface ForeignDb {
  name: string;
  index: CatalogIndex;
  status: ForeignStatus;
  snapshot: CatalogSnapshot | null;
}

/** A database named in SQL: the console's own, or another one with its (maybe not yet loaded) catalog. */
export interface DatabaseRef {
  /** The spelling the server lists. */
  name: string;
  home: boolean;
  /** The database's index once its schema list is loaded (the console's own index for `home`). */
  index: CatalogIndex | null;
  status: ForeignStatus;
}

export class ObjectEntry {
  readonly schema: string;
  readonly name: string;
  readonly type: CatalogObjectType;
  readonly obj: CatalogObject;
  /** Built-in object (Oracle DUAL, supplied packages): not from the snapshot. */
  readonly builtin: boolean;
  /** Database the object was loaded from; null for built-ins and for catalogs that name no database. */
  readonly database: string | null;
  readonly fksOut: FkEdge[] = [];
  readonly fksIn: FkEdge[] = [];
  private cols: ColumnDef[] | null = null;
  private colMap: Map<string, ColumnDef> | null = null;
  private readonly fold: (s: string) => string;

  /** ClickHouse dictionaries (catalog type `type`) are queryable like tables. */
  private readonly dictionaries: boolean;

  constructor(schema: string, obj: CatalogObject, fold: (s: string) => string, builtin = false, database: string | null = null, dictionaries = false) {
    this.dictionaries = dictionaries;
    this.database = database;
    this.schema = schema;
    this.name = obj.n;
    this.type = obj.t;
    this.obj = obj;
    this.fold = fold;
    this.builtin = builtin;
  }

  get qualifiedName(): string { return `${this.schema}.${this.name}`; }
  get isTabular(): boolean {
    return this.type === 'table' || this.type === 'view' || this.type === 'mview' || this.type === 'tablefunc' || (this.dictionaries && this.type === 'type');
  }

  columns(): ColumnDef[] {
    if (this.cols) return this.cols;
    const src = this.obj.c ?? [];
    const pk = new Set((this.obj.pk ?? []).map((p) => this.fold(p)));
    const out: ColumnDef[] = new Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const flags = c[4] ?? 0;
      out[i] = {
        name: c[0], type: c[1], nullable: c[2] === 1, isPk: c[3] === 1 || pk.has(this.fold(c[0])),
        identity: (flags & 1) !== 0, computed: (flags & 2) !== 0, hidden: (flags & 4) !== 0, comment: c[5],
        ordinal: i + 1, origin: { schema: this.schema, table: this.name },
      };
    }
    this.cols = out;
    return out;
  }

  /** Column by lookup key (see CatalogIndex.keyOf). */
  column(key: string): ColumnDef | undefined {
    if (!this.colMap) {
      this.colMap = new Map();
      for (const c of this.columns()) this.colMap.set(this.fold(c.name), c);
    }
    return this.colMap.get(key);
  }

  params(): CatalogParamTuple[] { return this.obj.p ?? []; }
  members(): CatalogPackageMember[] { return this.obj.members ?? []; }
}

export interface SchemaEntry {
  name: string;
  version: number;
  objects: ObjectEntry[];
  byName: Map<string, ObjectEntry[]>;
}

export interface NameRef { text: string; quoted: boolean }

const DUAL: CatalogObject = { t: 'table', n: 'DUAL', cm: 'One-row dummy table (SYS.DUAL).', c: [['DUMMY', 'VARCHAR2(1)', 1, 0, 0, null]] };

function packageToObject(p: PackageDef): CatalogObject {
  const members: CatalogPackageMember[] = [];
  for (const m of p.members) {
    let ov = 0;
    for (const sig of m.signatures) {
      ov++;
      const params: CatalogParamTuple[] = sig.params.map((s) => {
        const opt = s.startsWith('[');
        const clean = s.replace(/^\[|\]$/g, '').trim();
        const mm = /^(\S+)\s+(IN\s+OUT|IN|OUT)?\s*(.*)$/i.exec(clean);
        const name = mm ? mm[1] : clean;
        const dir = mm && mm[2] ? (mm[2].toUpperCase().replace(/\s+/, ' ') === 'IN OUT' ? 'inout' : mm[2].toUpperCase() === 'OUT' ? 'out' : 'in') : 'in';
        return [name, mm ? mm[3] || '' : '', dir, opt ? 1 : 0] as CatalogParamTuple;
      });
      if (sig.returns) params.unshift(['', sig.returns, 'return', 0]);
      members.push({ n: m.name, k: m.kind, ov, p: params });
    }
  }
  return { t: 'package', n: p.name, cm: p.doc, members };
}

export class CatalogIndex {
  readonly spec: DialectSpec;
  snapshot: CatalogSnapshot | null = null;
  defaultSchema = '';
  database: string | null = null;
  private dbNames: string[] = [];
  /** Databases of the server: the console's list, shared by the catalogs of the other databases. */
  get databases(): string[] { return this.home === this ? this.dbNames : this.home.dbNames; }
  set databases(v: string[]) { this.dbNames = v; }
  /** The console's own index; the index of another database points to it (the console's own points to itself). */
  home: CatalogIndex = this;
  /** Other databases of the server (T-SQL) by folded name, loaded lazily by the host. Home index only. */
  private readonly foreign = new Map<string, ForeignDb>();
  /** Called when a database that is not loaded is needed: its schema list (no schema) or one of its schemas. */
  databaseRequester: ((database: string, schema?: string) => void) | null = null;
  private readonly requestedForeign = new Set<string>();
  /** Schemas whose load failed or came back empty (the catalog of another database). */
  private failedSchemas = new Set<string>();
  private foreignSelf: ForeignDb | null = null;
  readonly schemas = new Map<string, SchemaEntry>();
  /** Folded name → objects across all schemas. */
  private readonly all = new Map<string, ObjectEntry[]>();
  private colIndex: Map<string, ObjectEntry[]> | null = null;
  private readonly builtins = new Map<string, ObjectEntry>();
  /** Built-in schemas (DialectSpec.systemCatalog: PostgreSQL pg_catalog / information_schema views…), consulted after the loaded schemas. */
  private readonly builtinSchemas = new Map<string, SchemaEntry>();
  /**
   * PostgreSQL search_path (snapshot.searchPath, else [defaultSchema]): unqualified names resolve in this order and
   * these schemas count as "default" (no qualification needed). Other dialects: [defaultSchema].
   */
  searchPath: string[] = [];
  /** Bumped on every change (consumers cache by it). */
  version = 0;
  /** Oracle PUBLIC synonyms resolved lazily. */
  private readonly publicResolved = new Map<string, ObjectEntry | null>();
  private readonly publicPending = new Set<string>();
  publicResolver: ((name: string) => Promise<CatalogObject | null>) | null = null;
  onChange: (() => void) | null = null;
  /** Called when a schema qualifier is not loaded (user typed `schema.`). */
  schemaRequester: ((schema: string) => void) | null = null;
  private readonly requestedSchemas = new Set<string>();
  /** Every schema of the database (snapshot.schemaNames), loaded or not: offered as schema items, lazy-loaded on `schema.`. */
  knownSchemaNames: string[] = [];

  constructor(spec: DialectSpec) {
    this.spec = spec;
    if (spec.id === 'plsql') {
      this.builtins.set('DUAL', new ObjectEntry('SYS', DUAL, (s) => s, true));
      for (const p of spec.packages) this.builtins.set(p.name.toUpperCase(), new ObjectEntry('SYS', packageToObject(p), (s) => s, true));
    }
    // PostgreSQL pg_catalog / information_schema; Batch 3 dialects declare theirs in their spec (D8).
    if (spec.systemCatalog) {
      for (const sc of spec.systemCatalog.schemas) {
        this.builtinSchemas.set(this.keyOfCatalog(sc.name), this.buildSchema({ ...sc, version: 0 }, true));
      }
    }
  }

  /** Lookup key of a catalog name (as stored). */
  keyOfCatalog(name: string): string {
    return this.spec.caseFolding === 'insensitive' ? name.toUpperCase() : name;
  }
  /** Lookup key of a name written in SQL (unquoted names fold: upper for Oracle, lower for PostgreSQL). */
  keyOf(name: string, quoted: boolean): string {
    return this.spec.fold(name, quoted);
  }
  foldColumn = (name: string): string => this.keyOfCatalog(name);

  /** Returns true when anything changed. */
  setSnapshot(snap: CatalogSnapshot | null): boolean {
    if (!snap && !this.snapshot) return false;
    if (snap === this.snapshot) return false;
    if (!snap) {
      this.snapshot = null;
      this.schemas.clear();
      this.foreign.clear();
      this.requestedForeign.clear();
      this.knownSchemaNames = [];
      this.all.clear();
      this.colIndex = null;
      this.version++;
      return true;
    }
    const sameConn = this.snapshot && this.snapshot.connectionId === snap.connectionId && this.snapshot.database === snap.database;
    this.snapshot = snap;
    this.defaultSchema = snap.defaultSchema;
    this.searchPath = this.spec.id === 'pgsql' && snap.searchPath?.length ? snap.searchPath.slice() : [snap.defaultSchema];
    this.database = snap.database;
    this.dbNames = snap.databases ?? [];
    if (!sameConn) { this.foreign.clear(); this.requestedForeign.clear(); }
    const names = snap.schemaNames ?? [];
    let changed = !sameConn;
    if (names.join('\u0001') !== this.knownSchemaNames.join('\u0001')) {
      // The schema list arrived (or changed): a schema requested before the list was known may now be loadable,
      // so it can be requested again (the console's requester loads only schemas it finds in the list).
      for (const n of names) if (!snap.schemas.some((s) => this.keyOfCatalog(s.name) === this.keyOfCatalog(n))) this.requestedSchemas.delete(n.toUpperCase());
      this.knownSchemaNames = names.slice();
      changed = true;
    }
    const keep = new Set<string>();
    if (!sameConn) this.schemas.clear();
    for (const sc of snap.schemas) {
      const key = this.keyOfCatalog(sc.name);
      keep.add(key);
      const prev = this.schemas.get(key);
      if (prev && prev.version === sc.version && prev.objects.length === sc.objects.length) continue;
      this.schemas.set(key, this.buildSchema(sc));
      changed = true;
    }
    for (const k of [...this.schemas.keys()]) if (!keep.has(k)) { this.schemas.delete(k); changed = true; }
    if (changed) this.rebuildGlobal();
    return changed;
  }

  /** Add or replace one schema (incremental per-schema load). */
  setSchema(sc: CatalogSchema): void {
    this.schemas.set(this.keyOfCatalog(sc.name), this.buildSchema(sc));
    this.rebuildGlobal();
  }

  private buildSchema(sc: CatalogSchema, builtin = false): SchemaEntry {
    const byName = new Map<string, ObjectEntry[]>();
    const objects: ObjectEntry[] = new Array(sc.objects.length);
    for (let i = 0; i < sc.objects.length; i++) {
      const e = new ObjectEntry(sc.name, sc.objects[i], this.foldColumn, builtin, builtin ? null : this.database, this.spec.id === 'clickhouse');
      objects[i] = e;
      const k = this.keyOfCatalog(e.name);
      const arr = byName.get(k);
      if (arr) arr.push(e); else byName.set(k, [e]);
    }
    return { name: sc.name, version: sc.version, objects, byName };
  }

  private rebuildGlobal(): void {
    this.all.clear();
    this.colIndex = null;
    for (const sc of this.schemas.values()) {
      for (const [k, arr] of sc.byName) {
        const g = this.all.get(k);
        if (g) g.push(...arr); else this.all.set(k, arr.slice());
      }
    }
    // FK graph (both directions)
    for (const sc of this.schemas.values()) {
      for (const e of sc.objects) { e.fksOut.length = 0; e.fksIn.length = 0; }
    }
    for (const sc of this.schemas.values()) {
      for (const e of sc.objects) {
        const fks = e.obj.fk;
        if (!fks || fks.length === 0) continue;
        for (const fk of fks) {
          const toSchema = fk.rs ?? e.schema;
          const to = this.findIn(toSchema, fk.rt, (x) => x.isTabular) ?? null;
          const edge: FkEdge = { name: fk.n, from: e, fromCols: fk.cols, to, toSchema, toTable: fk.rt, toCols: fk.rcols };
          e.fksOut.push(edge);
          if (to) to.fksIn.push(edge);
        }
      }
    }
    this.version++;
    this.onChange?.();
  }

  schema(name: string, quoted = false): SchemaEntry | undefined {
    const k = this.keyOf(name, quoted);
    return this.schemas.get(k) ?? this.builtinSchemas.get(k);
  }
  defaultSchemaEntry(): SchemaEntry | undefined {
    return this.schemas.get(this.keyOfCatalog(this.defaultSchema));
  }
  /**
   * Schemas whose objects need no qualification, in resolution order: the loaded search_path schemas (PostgreSQL),
   * else the default schema.
   */
  defaultEntries(): SchemaEntry[] {
    if (this.spec.id !== 'pgsql') {
      const d = this.defaultSchemaEntry();
      return d ? [d] : [];
    }
    const out: SchemaEntry[] = [];
    for (const n of this.searchPath) {
      const sc = this.schemas.get(this.keyOfCatalog(n));
      if (sc && !out.includes(sc)) out.push(sc);
    }
    const d = this.defaultSchemaEntry();
    if (d && !out.includes(d)) out.push(d);
    return out;
  }
  /** Objects of the default schema(s) (PostgreSQL: every loaded search_path schema, first schema first). */
  defaultObjects(): ObjectEntry[] {
    const es = this.defaultEntries();
    return es.length === 1 ? es[0].objects : es.flatMap((e) => e.objects);
  }
  isDefaultSchema(name: string): boolean {
    if (this.spec.id === 'pgsql' && this.searchPathIndex(name) > 0) return true;
    return this.keyOfCatalog(name) === this.keyOfCatalog(this.defaultSchema);
  }
  /** 1-based position on the PostgreSQL search_path, or 0. */
  searchPathIndex(name: string): number {
    if (this.spec.id !== 'pgsql') return 0;
    return this.searchPath.findIndex((n) => this.keyOfCatalog(n) === this.keyOfCatalog(name)) + 1;
  }
  /** Search-path schemas that are not loaded yet (PostgreSQL; the built-in pg_catalog never counts). */
  unloadedSearchPath(): string[] {
    if (this.spec.id !== 'pgsql') return [];
    return this.searchPath.filter((n) => !this.schemas.has(this.keyOfCatalog(n)) && !this.builtinSchemas.has(this.keyOfCatalog(n)));
  }
  /** Built-in schema by catalog name (PostgreSQL pg_catalog / information_schema). */
  builtinSchema(name: string): SchemaEntry | undefined {
    return this.builtinSchemas.get(this.keyOfCatalog(name));
  }
  builtinSchemaList(): SchemaEntry[] {
    return [...this.builtinSchemas.values()];
  }

  /** Object by exact catalog key inside a schema. */
  findIn(schema: string, name: string, pred?: (e: ObjectEntry) => boolean, quotedName = true, quotedSchema = true): ObjectEntry | undefined {
    const sc = this.schemas.get(quotedSchema ? this.keyOfCatalog(schema) : this.keyOf(schema, false));
    if (!sc) return undefined;
    const arr = sc.byName.get(quotedName ? this.keyOfCatalog(name) : this.keyOf(name, false));
    if (!arr) return undefined;
    return pred ? arr.find(pred) : arr[0];
  }

  lookupIn(schema: string, name: NameRef, schemaQuoted: boolean): ObjectEntry[] {
    const sc = this.schema(schema, schemaQuoted);
    return sc?.byName.get(this.keyOf(name.text, name.quoted)) ?? [];
  }

  lookupAll(name: NameRef): ObjectEntry[] {
    return this.all.get(this.keyOf(name.text, name.quoted)) ?? [];
  }

  builtin(name: NameRef): ObjectEntry | undefined {
    return this.builtins.get(this.keyOf(name.text, name.quoted));
  }
  builtinPackages(): ObjectEntry[] {
    return [...this.builtins.values()].filter((b) => b.type === 'package');
  }
  builtinObjects(): ObjectEntry[] {
    return [...this.builtins.values()];
  }

  /**
   * Resolve a 1–3 part object name (no CTE/alias/temp handling: that is the binder's job).
   * Follows synonyms when `followSynonyms`.
   */
  resolve(parts: NameRef[], pred: (e: ObjectEntry) => boolean = () => true, followSynonyms = true): ObjectEntry | null {
    const e = this.resolveRaw(parts, (x) => x.type === 'synonym' || pred(x));
    if (!e) return null;
    if (e.type === 'synonym' && followSynonyms) {
      const target = this.followSynonym(e);
      if (target && pred(target)) return target;
      return pred(e) ? e : null;
    }
    return pred(e) ? e : null;
  }

  resolveRaw(parts: NameRef[], pred: (e: ObjectEntry) => boolean): ObjectEntry | null {
    if (parts.length === 0) return null;
    const pick = (arr: ObjectEntry[]) => arr.find(pred) ?? null;
    if (parts.length === 1 && this.spec.id === 'pgsql') {
      // search_path order, then pg_catalog, then any loaded schema (lenient: unqualified names of other schemas)
      const key = this.keyOf(parts[0].text, parts[0].quoted);
      for (const sc of this.defaultEntries()) {
        const arr = sc.byName.get(key);
        const a = arr ? pick(arr) : null;
        if (a) return a;
      }
      const sys = this.builtinSchemas.get('pg_catalog')?.byName.get(key);
      const b = sys ? pick(sys) : null;
      if (b) return b;
      const anywhere = this.lookupAll(parts[0]).filter(pred);
      if (anywhere.length >= 1) return anywhere[0];
      for (const n of this.unloadedSearchPath()) this.requestSchema(n);
      return null;
    }
    if (parts.length === 1) {
      const name = parts[0];
      const def = this.defaultSchemaEntry();
      const inDef = def?.byName.get(this.keyOf(name.text, name.quoted));
      const a = inDef ? pick(inDef) : null;
      if (a) return a;
      if (this.spec.id === 'plsql') {
        const pub = this.schemas.get('PUBLIC')?.byName.get(this.keyOf(name.text, name.quoted));
        const b = pub ? pick(pub) : null;
        if (b) return b;
        const lazy = this.publicResolved.get(this.keyOf(name.text, name.quoted));
        if (lazy && pred(lazy)) return lazy;
      }
      const anywhere = this.lookupAll(name).filter(pred);
      if (anywhere.length >= 1) return anywhere[0];
      const bi = this.builtin(name);
      if (bi && pred(bi)) return bi;
      return null;
    }
    if (parts.length === 2) {
      const [sch, name] = parts;
      const arr = this.lookupIn(sch.text, name, sch.quoted);
      const a = pick(arr);
      if (a) return a;
      // `Sales.Customers` with Sales not loaded yet: ask the host for it (hover, go-to-definition and the next diagnostics pass then succeed)
      if (!arr.length && this.isUnloadedSchema(sch.text, sch.quoted)) this.requestSchema(sch.text);
      if (this.spec.id === 'tsql' && this.database && this.keyOf(sch.text, sch.quoted) === this.keyOfCatalog(this.database)) {
        // db.obj is invalid T-SQL; tolerate db..obj handled by 3 parts
        return null;
      }
      return null;
    }
    if (parts.length === 3) {
      const [db, sch, name] = parts;
      if (this.spec.id === 'pgsql') {
        if (this.database && this.keyOf(db.text, db.quoted) !== this.keyOfCatalog(this.database)) return null;
        return pick(this.lookupIn(sch.text, name, sch.quoted));
      }
      if (this.spec.id === 'tsql' || this.spec.id === 'snowflake') {
        // `db.schema.object` / `db..object`: this database, or another one of the server (its catalog loads on demand)
        const ix = this.indexOfDatabase(db.text, db.quoted);
        if (!ix) return null;
        const schemaName = sch.text === '' ? { text: ix.defaultSchema, quoted: true } : sch;
        if (ix !== this && ix.isUnloadedSchema(schemaName.text, schemaName.quoted)) ix.requestSchema(schemaName.text);
        return pick(ix.lookupIn(schemaName.text, name, schemaName.quoted));
      }
      return null;
    }
    return null;
  }

  followSynonym(e: ObjectEntry, depth = 0): ObjectEntry | null {
    if (e.type !== 'synonym') return e;
    if (depth > 8) return null;
    const tg = e.obj.target;
    if (!tg) return null;
    const schema = tg.s ?? e.schema;
    const sc = this.schemas.get(this.keyOfCatalog(schema));
    let next: ObjectEntry | undefined;
    if (sc) next = sc.byName.get(this.keyOfCatalog(tg.n))?.find((x) => !tg.t || x.type === tg.t || x.type === 'synonym');
    if (!next && this.spec.id === 'plsql') next = this.builtins.get(tg.n.toUpperCase());
    if (!next) return null;
    return next.type === 'synonym' ? this.followSynonym(next, depth + 1) : next;
  }

  /** Tables/views having a column with this name (backward inference: `SELECT Name FROM |`). */
  tablesWithColumn(col: NameRef): ObjectEntry[] {
    if (!this.colIndex) {
      const idx = new Map<string, ObjectEntry[]>();
      for (const sc of this.schemas.values()) {
        for (const e of sc.objects) {
          const cs = e.obj.c;
          if (!cs) continue;
          for (let i = 0; i < cs.length; i++) {
            const k = this.keyOfCatalog(cs[i][0]);
            const arr = idx.get(k);
            if (arr) arr.push(e); else idx.set(k, [e]);
          }
        }
      }
      this.colIndex = idx;
    }
    return this.colIndex.get(this.keyOf(col.text, col.quoted)) ?? [];
  }

  /** FK edges between two catalog objects, either direction. */
  fkBetween(a: ObjectEntry, b: ObjectEntry): { edge: FkEdge; aIsFrom: boolean }[] {
    const out: { edge: FkEdge; aIsFrom: boolean }[] = [];
    for (const e of a.fksOut) if (e.to === b) out.push({ edge: e, aIsFrom: true });
    for (const e of a.fksIn) if (e.from === b && !(e.to === a && e.from === a && out.some((x) => x.edge === e))) out.push({ edge: e, aIsFrom: false });
    return out;
  }

  // ---------------- Oracle PUBLIC synonyms (lazy)

  /** Ask the host to resolve a PUBLIC synonym once; returns the cached result if known. */
  requestPublicSynonym(name: string): ObjectEntry | null | undefined {
    if (this.spec.id !== 'plsql') return undefined;
    const key = name.toUpperCase();
    if (this.publicResolved.has(key)) return this.publicResolved.get(key);
    if (this.publicPending.has(key) || !this.publicResolver) return undefined;
    this.publicPending.add(key);
    this.publicResolver(key).then(
      (obj) => {
        this.publicPending.delete(key);
        this.publicResolved.set(key, obj ? new ObjectEntry('PUBLIC', { ...obj, n: obj.n || key }, this.foldColumn) : null);
        this.version++;
        this.onChange?.();
      },
      () => { this.publicPending.delete(key); this.publicResolved.set(key, null); },
    );
    return undefined;
  }
  publicSynonyms(): ObjectEntry[] {
    const out: ObjectEntry[] = [];
    for (const v of this.publicResolved.values()) if (v) out.push(v);
    return out;
  }
  wasPublicRequested(name: string): boolean {
    const k = name.toUpperCase();
    return this.publicPending.has(k) || this.publicResolved.has(k);
  }

  requestSchema(name: string): void {
    if (this.builtinSchemas.has(this.keyOfCatalog(name))) return;
    if (this.home !== this) {
      // another database: its schemas load through the host's database requester
      if (this.database) this.home.requestDatabase(this.database, name);
      return;
    }
    const k = name.toUpperCase();
    if (this.requestedSchemas.has(k)) return;
    this.requestedSchemas.add(k);
    this.schemaRequester?.(name);
  }

  /** All schema names (loaded) for completion. */
  schemaNames(): string[] {
    return [...this.schemas.values()].map((s) => s.name);
  }

  /** Schemas the database has (snapshot.schemaNames) whose objects are not loaded yet. */
  unloadedSchemaNames(): string[] {
    return this.knownSchemaNames.filter((n) => !this.schemas.has(this.keyOfCatalog(n)));
  }

  /** A schema of this database that exists but is not loaded yet (`name.` then shows "Loading name…"). */
  isUnloadedSchema(name: string, quoted = false): boolean {
    const k = this.keyOf(name, quoted);
    if (this.schemas.has(k) || this.builtinSchemas.has(k) || this.failedSchemas.has(k)) return false;
    return this.knownSchemaNames.some((n) => this.keyOfCatalog(n) === k);
  }

  /**
   * The schema may still arrive: it is listed but not loaded, or the schema list itself is not here yet and the host
   * can load schemas. False for a schema the server does not have, or one whose load failed.
   */
  isSchemaPending(name: string, quoted = false): boolean {
    if (this.isUnloadedSchema(name, quoted)) return true;
    const k = this.keyOf(name, quoted);
    return !!this.snapshot && this.knownSchemaNames.length === 0 && !!this.schemaRequester && !this.schemas.has(k) && !this.builtinSchemas.has(k) && !this.failedSchemas.has(k);
  }

  /** An Oracle PUBLIC synonym lookup for this name is in flight. */
  isPublicPending(name: string): boolean {
    return this.publicPending.has(name.toUpperCase());
  }

  // ---------------- other databases of the server (T-SQL `Other.dbo.Orders`)

  /** The spelling the server lists for a database name typed in SQL (case-insensitive), or null if the server has none. */
  listedDatabase(text: string, quoted: boolean): string | null {
    const home = this.home;
    const k = home.keyOf(text, quoted);
    if (home.database && home.keyOfCatalog(home.database) === k) return home.database;
    return home.databases.find((d) => home.keyOfCatalog(d) === k) ?? null;
  }

  /**
   * What `name` refers to as a database: this console's own, another database of the server (T-SQL; its catalog loads
   * on demand: the first lookup asks the host for it), or null when the server lists no such database. Works from any
   * index of the same server.
   */
  resolveDatabase(text: string, quoted: boolean): DatabaseRef | null {
    const home = this.home;
    if (home.spec.id !== 'tsql' && home.spec.id !== 'snowflake') return null;
    const name = this.listedDatabase(text, quoted);
    if (!name) return null;
    const k = home.keyOfCatalog(name);
    if (!home.database) return { name, home: false, index: null, status: 'error' }; // own database unknown: cannot tell
    if (home.keyOfCatalog(home.database) === k) return { name: home.database, home: true, index: home, status: 'ready' };
    let f = home.foreign.get(k);
    if (!f) f = home.makeForeign(name);
    if (f.status === 'loading') {
      if (home.databaseRequester) home.requestDatabase(name);
      else f.status = 'error'; // nobody loads other databases here
    }
    return { name: f.name, home: false, index: f.status === 'ready' && f.index.snapshot ? f.index : null, status: f.status };
  }

  /** Index of a database for name resolution: this console's own or another database whose schema list is loaded. */
  indexOfDatabase(text: string, quoted: boolean): CatalogIndex | null {
    const home = this.home;
    // a catalog that names no database cannot tell its own from another: every name is its own
    if (!home.database && home.spec.id === 'tsql') return home;
    return this.resolveDatabase(text, quoted)?.index ?? null;
  }

  /**
   * The index statements run against after `USE name`: the database's catalog (empty until it has loaded; it is
   * requested here). The console's own index when `name` is its database, or not a database of the server.
   */
  indexForUse(text: string, quoted: boolean): CatalogIndex {
    const home = this.home;
    const r = home.resolveDatabase(text, quoted);
    if (!r || r.home) return home;
    const f = home.foreign.get(home.keyOfCatalog(r.name));
    if (!f) return home;
    // the default schema's objects are the first thing a script after `USE` needs
    const ix = f.index;
    if (f.status === 'ready' && ix.snapshot && ix.defaultSchema && ix.isUnloadedSchema(ix.defaultSchema, true)) ix.requestSchema(ix.defaultSchema);
    return ix;
  }

  /** This is the catalog of another database whose schema list or default schema is still loading. */
  get isLoadingDatabase(): boolean {
    const f = this.foreignSelf;
    if (!f) return false;
    if (f.status === 'loading') return !!this.home.databaseRequester;
    return f.status === 'ready' && !!this.snapshot && !!this.defaultSchema && this.isUnloadedSchema(this.defaultSchema, true);
  }

  private makeForeign(name: string): ForeignDb {
    const ix = new CatalogIndex(this.spec);
    ix.home = this;
    ix.database = name;
    const f: ForeignDb = { name, index: ix, status: 'loading', snapshot: null };
    ix.foreignSelf = f;
    ix.onChange = () => this.onChange?.();
    this.foreign.set(this.keyOfCatalog(name), f);
    return f;
  }

  /** Ask the host for a database's schema list (no schema) or for one of its schemas, once. */
  requestDatabase(database: string, schema?: string): void {
    const home = this.home;
    if (!home.databaseRequester) return;
    const k = home.keyOfCatalog(database) + (schema ? '\u0000' + home.keyOfCatalog(schema) : '');
    if (home.requestedForeign.has(k)) return;
    home.requestedForeign.add(k);
    home.databaseRequester(database, schema);
  }

  /**
   * The catalogs of the server's other databases as the host has them so far. Returns true when anything changed.
   * Databases the host does not list yet stay as they are (a `USE` or a three-part name may be waiting for them).
   */
  setForeignCatalogs(inputs: readonly ForeignCatalogInput[]): boolean {
    const home = this.home;
    let changed = false;
    for (const input of inputs) {
      const k = home.keyOfCatalog(input.database);
      if (home.database && k === home.keyOfCatalog(home.database)) continue;
      let f = home.foreign.get(k);
      if (!f) { f = home.makeForeign(input.database); changed = true; }
      if (f.status !== input.status) { f.status = input.status; changed = true; }
      const failed = new Set((input.failed ?? []).map((n) => f!.index.keyOfCatalog(n)));
      if ([...failed].join('\u0001') !== [...f.index.failedSchemas].join('\u0001')) { f.index.failedSchemas = failed; changed = true; }
      if (input.snapshot && input.snapshot !== f.snapshot) {
        f.snapshot = input.snapshot;
        const notify = f.index.onChange;
        f.index.onChange = null; // one notification for the whole batch
        try { f.index.setSnapshot(input.snapshot); } finally { f.index.onChange = notify; }
        changed = true;
      }
    }
    if (changed) { this.version++; this.onChange?.(); }
    return changed;
  }
}
