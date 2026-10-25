// Go-to-definition on a name whose schema / database is still on its way (the catalog loads lazily).
import type { Token } from '../types';
import type { PendingDefinition } from '../types';
import type { CatalogIndex } from '../catalog/index';
import type { NamePart } from '../parse/statement-model';
import { namePart } from '../parse/partial-parser';

const isName = (t: Token | undefined) => !!t && (t.kind === 'ident' || t.kind === 'keyword' || t.kind === 'quotedIdent' || t.kind === 'param');
const isDot = (t: Token | undefined) => !!t && t.kind === 'punct' && t.text === '.';

/** The dotted name around the token at `offset` (`Other.dbo.Orders`), and the index of the token's own part. */
export function nameChainAt(toks: readonly Token[], offset: number): { parts: NamePart[]; hi: number } | null {
  let k = toks.findIndex((t) => t.start <= offset && offset < t.end);
  if (k < 0) k = toks.findIndex((t) => t.end === offset);
  if (k < 0 || !isName(toks[k])) return null;
  let a = k, b = k;
  while (a >= 2 && isDot(toks[a - 1]) && isName(toks[a - 2])) a -= 2;
  while (b + 2 < toks.length && isDot(toks[b + 1]) && isName(toks[b + 2])) b += 2;
  const parts: NamePart[] = [];
  for (let i = a; i <= b; i += 2) parts.push(namePart(toks[i]));
  return { parts, hi: (k - a) / 2 };
}

/**
 * What the name at the cursor waits for, if anything: another database's catalog, a schema that is listed but not
 * loaded, or the search path's schemas. Each missing piece is requested from the host here (once; the index
 * deduplicates), so calling this again after the catalog changed is how the caller polls.
 */
export function pendingDefinitionFor(chain: { parts: NamePart[]; hi: number }, index: CatalogIndex): PendingDefinition | null {
  const names = chain.parts.slice(0, chain.hi + 1);
  if (!names.length) return null;
  const target = chain.parts.map((p) => p.text).join('.');
  const wait = (loading: string): PendingDefinition => ({ loading, target });
  const dialect = index.spec.id;

  if (names.length === 1) {
    if (dialect === 'pgsql') {
      const missing = index.unloadedSearchPath();
      for (const m of missing) index.requestSchema(m);
      return missing.length ? wait(missing[0]) : null;
    }
    if (dialect === 'plsql') return index.isPublicPending(names[0].text) ? wait('PUBLIC') : null;
    if (index.defaultSchema && index.isSchemaPending(index.defaultSchema, true)) {
      index.requestSchema(index.defaultSchema);
      return wait(index.defaultSchema);
    }
    return null;
  }

  // `Other.dbo.Orders` / `Other..Orders`: the first part may be another database of the server (T-SQL)
  if (dialect === 'tsql' && names.length >= 3) {
    const db = index.resolveDatabase(names[0].text, names[0].quoted); // requests the database's schema list on first use
    if (db && !db.home) {
      if (!db.index) return db.status === 'loading' ? wait(db.name) : null;
      const sch = names[1].text === '' ? { text: db.index.defaultSchema, quoted: true } : names[1];
      if (db.index.isUnloadedSchema(sch.text, sch.quoted)) {
        db.index.requestSchema(sch.text);
        return wait(`${db.name}.${sch.text}`);
      }
      return null;
    }
  }
  // `db.schema.object` of this PostgreSQL database
  const ownDb = dialect === 'pgsql' && names.length >= 3 && !!index.database && index.keyOf(names[0].text, names[0].quoted) === index.keyOfCatalog(index.database);
  const schemaPart = ownDb ? names[1] : names[0];
  if (index.isSchemaPending(schemaPart.text, schemaPart.quoted)) {
    index.requestSchema(schemaPart.text);
    return wait(schemaPart.text);
  }
  return null;
}
