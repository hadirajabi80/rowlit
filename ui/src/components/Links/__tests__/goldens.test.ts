// plan-links WP0: the builder goldens shared with the engine (engine/tests/DbStudio.Federation.Tests/Goldens/Builder/)
// load here and have the agreed shape. WP-C extends this file to check compileBuilder(model, catalog) === golden.sql
// and params for every golden (b-* written by WP-B, c-* by WP-C).
import { describe, expect, it } from 'vitest';
import type { BuilderModel } from '../../../api/links';

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

const goldens = nodeFs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(nodeFs.readFileSync(`${DIR}/${f}`, 'utf8')) as Golden] as const);

describe('builder goldens (shared with the engine)', () => {
  it('exist', () => expect(goldens.length).toBeGreaterThan(0));

  it.each(goldens)('%s has a model, a catalog for every table and the canonical SQL', (_f, g) => {
    expect(g.model.version).toBe(1);
    for (const t of g.model.tables) expect(g.catalog[`${t.alias}.${t.table}`], `${t.alias}.${t.table}`).toBeDefined();
    expect(g.sql.startsWith('SELECT ')).toBe(true);
    expect(g.sql.endsWith(';')).toBe(false);
    for (const p of g.params) expect(g.sql).toContain(`$${p.name}`);
  });
});
