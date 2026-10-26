// plan-links WP0: the duckdb dialect (linked databases) loads lazily like the Batch 3 ones and works on a link-shaped
// catalog (schemas = member aliases). WP-D owns the dialect itself and adds its own duckdb*.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { getSpec } from '../dialect';
import { ensureDialect, isDialectReady, isLazyDialect } from '../dialect/registry';
import { tokenize } from '../lexer/lexer';
import { rulesFor } from '../../format/layout';
import { intelFor } from './helpers';

describe('duckdb dialect (plan-links WP0)', () => {
  beforeAll(async () => {
    await ensureDialect('duckdb');
  });

  it('is lazy and loads its own spec', () => {
    expect(isLazyDialect('duckdb')).toBe(true);
    expect(isDialectReady('duckdb')).toBe(true);
    expect(getSpec('duckdb').id).toBe('duckdb');
    expect(rulesFor(getSpec('duckdb')).dialect).toBe('duckdb');
  });

  it('lexes $$ strings, $1 / ? parameters and the :: cast', () => {
    const kinds = tokenize("SELECT $$a;b$$, x::INTEGER, $1, ? FROM shop.orders", getSpec('duckdb')).filter((t) => t.kind !== 'eof').map((t) => t.kind);
    expect(kinds).toContain('string');
    expect(kinds.filter((k) => k === 'param')).toHaveLength(2);
  });

  it('splits at semicolons and completes the tables of a member alias', () => {
    const i = intelFor('duckdb');
    i.setDocument('links://1', 'SELECT 1;\n\nSELECT * FROM shop.');
    expect(i.statements('links://1').map((s) => s.text)).toEqual(['SELECT 1', 'SELECT * FROM shop.']);
    const doc = 'SELECT * FROM shop.';
    i.setDocument('links://2', doc);
    const labels = i.complete('links://2', doc.length).items.map((c) => c.label);
    expect(labels).toContain('customers');
  });
});
