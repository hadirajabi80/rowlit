// plan-links: the builder goldens shared with the engine (engine/tests/DbStudio.Federation.Tests/Goldens/Builder/): every
// golden (b-* written by WP-B, c-* by WP-C) has the agreed shape, and compileBuilder(model, catalog) reproduces its SQL,
// params and warning codes exactly (the engine's BuilderCompiler must too).
import { describe, expect, it } from 'vitest';
import type { BuilderModel } from '../../../api/links';
import type { ColumnKind } from '../../../api/types';
import { compileBuilder, type BuilderCatalog } from '../builder/compile';

const nodeFs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: 'utf8'): string;
};
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const DIR = `${cwd}/../engine/tests/DbStudio.Federation.Tests/Goldens/Builder`;

interface Golden {
  name: string;
  catalog: Record<string, { name: string; kind: string; type: string }[]>;
  model: BuilderModel;
  sql: string;
  params: { name: string; kind: string; value: unknown }[];
  warnings: string[];
}

const goldens = nodeFs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => [f, JSON.parse(nodeFs.readFileSync(`${DIR}/${f}`, 'utf8')) as Golden] as const);

const catalogOf = (g: Golden): BuilderCatalog =>
  Object.fromEntries(Object.entries(g.catalog).map(([k, cols]) => [k, cols.map((c) => ({ name: c.name, kind: c.kind as ColumnKind, dbType: c.type }))]));

describe('builder goldens (shared with the engine)', () => {
  it('exist, with WP-C goldens among them', () => {
    expect(goldens.length).toBeGreaterThan(0);
    expect(goldens.some(([f]) => f.startsWith('c-'))).toBe(true);
  });

  it.each(goldens)('%s has a model, a catalog for every table and the canonical SQL', (_f, g) => {
    expect(g.model.version).toBe(1);
    for (const t of g.model.tables) expect(g.catalog[`${t.alias}.${t.table}`], `${t.alias}.${t.table}`).toBeDefined();
    expect(g.sql.startsWith('SELECT ')).toBe(true);
    expect(g.sql.endsWith(';')).toBe(false);
    for (const p of g.params) expect(g.sql).toContain(`$${p.name}`);
  });

  it.each(goldens)('%s compiles to the golden SQL, params and warnings', (_f, g) => {
    const r = compileBuilder(g.model, catalogOf(g));
    expect(r.sql).toBe(g.sql);
    expect(r.params.map((p) => ({ name: p.name, kind: p.kind, value: p.value }))).toEqual(g.params);
    // compared as a sorted list, like the engine's BuilderGoldenTests
    expect(r.warnings.map((w) => w.code).sort()).toEqual([...g.warnings].sort());
  });
});
