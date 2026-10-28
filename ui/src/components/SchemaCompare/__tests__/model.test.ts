import { describe, expect, it } from 'vitest';
import type { CompareItem } from '../../../api/types.schemaCompare';
import {
  changedOptions, countStatuses, dataLossWarnings, DEFAULT_FILTER, DEFAULT_OPTIONS, defaultSelection, groupItems, groupState,
  nameOfId, selectedIds, toggle, toggleMany, validateSides, withDefaults, worstSeverity,
} from '../model';

const item = (id: string, status: CompareItem['status'], extra: Partial<CompareItem> = {}): CompareItem => {
  const [kind, name] = id.split(':') as [CompareItem['kind'], string];
  return { id, kind, name, status, changes: [], warnings: [], ...extra };
};

const ITEMS: CompareItem[] = [
  item('view:v_orders', 'alter', { changes: ['View query differs'] }),
  item('table:orders', 'alter', { changes: ['Column total: type numeric(10,2) → numeric(12,2)'] }),
  item('table:customers', 'identical'),
  item('table:audit', 'drop', { warnings: [{ severity: 'dataLoss', message: 'Dropping table audit deletes all of its rows.' }] }),
  item('trigger:trg_check', 'create', { detail: 'orders' }),
  item('sequence:seq_no', 'alter'),
  item('func:fn_tax(amount numeric)', 'create'),
];

describe('schema compare model', () => {
  it('groups differing items by kind in script order and sorts names', () => {
    const groups = groupItems(ITEMS, DEFAULT_FILTER);
    expect(groups.map((g) => g.kind)).toEqual(['sequence', 'table', 'view', 'func', 'trigger']);
    expect(groups.find((g) => g.kind === 'table')!.items.map((i) => i.name)).toEqual(['audit', 'orders']);
  });

  it('filters by status chips and search (name, trigger table, changes)', () => {
    const all = { statuses: new Set(['create', 'alter', 'drop', 'identical'] as const), search: '' };
    expect(groupItems(ITEMS, all).flatMap((g) => g.items)).toHaveLength(ITEMS.length);
    expect(groupItems(ITEMS, { ...all, statuses: new Set(['drop'] as const) }).flatMap((g) => g.items.map((i) => i.id))).toEqual(['table:audit']);
    expect(groupItems(ITEMS, { ...all, search: 'ORDERS' }).flatMap((g) => g.items.map((i) => i.id)).sort())
      .toEqual(['table:orders', 'trigger:trg_check', 'view:v_orders']);
    expect(groupItems(ITEMS, { ...all, search: 'numeric(12' }).flatMap((g) => g.items.map((i) => i.id))).toContain('table:orders');
  });

  it('counts statuses', () => {
    expect(countStatuses(ITEMS)).toEqual({ create: 2, drop: 1, alter: 3, identical: 1 });
  });

  it('selects every differing item by default; identical items never join a selection', () => {
    const sel = defaultSelection(ITEMS);
    expect(sel.has('table:customers')).toBe(false);
    expect(sel.size).toBe(6);
    const tables = ITEMS.filter((i) => i.kind === 'table');
    expect(groupState(sel, tables)).toBe('all');
    const less = toggle(sel, 'table:orders');
    expect(groupState(less, tables)).toBe('some');
    expect(groupState(toggleMany(less, tables, false), tables)).toBe('none');
    expect(toggleMany(new Set(), tables, true).has('table:customers')).toBe(false);
    expect(selectedIds(ITEMS, less)).toEqual(['view:v_orders', 'table:audit', 'trigger:trg_check', 'sequence:seq_no', 'func:fn_tax(amount numeric)']);
  });

  it('options: defaults, and only changed ones are sent', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_OPTIONS);
    const o = withDefaults({ views: false, ignoreConstraintNames: true });
    expect(changedOptions(o)).toEqual({ views: false, ignoreConstraintNames: true });
    expect(changedOptions(DEFAULT_OPTIONS)).toEqual({});
  });

  it('warnings: worst severity and distinct data-loss messages', () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([{ severity: 'info' }, { severity: 'dataLoss' }])).toBe('dataLoss');
    expect(worstSeverity([{ severity: 'info' }, { severity: 'warning' }])).toBe('warning');
    const losses = dataLossWarnings({
      warnings: [
        { itemId: 'table:a', severity: 'dataLoss', message: 'x' },
        { itemId: 'table:a', severity: 'dataLoss', message: 'x' },
        { itemId: 'table:b', severity: 'warning', message: 'y' },
        { itemId: 'table:c', severity: 'dataLoss', message: 'z' },
      ],
    });
    expect(losses.map((w) => w.message)).toEqual(['x', 'z']);
    expect(nameOfId('func:fn_tax(amount numeric)')).toBe('fn_tax(amount numeric)');
  });

  it('validates the two sides', () => {
    const provider = (id: string) => ({ a: 'postgresql', b: 'postgresql', m: 'mysql', r: 'redis' })[id];
    const reason = (id: string) => (id === 'r' ? 'Not relational' : null);
    const side = (connectionId: string | null, schema: string | null = null, database: string | null = null) => ({ connectionId, database, schema });
    expect(validateSides(side(null), side('b'), provider, reason)).toMatch(/source connection/);
    expect(validateSides(side('a'), side(null), provider, reason)).toMatch(/target connection/);
    expect(validateSides(side('a'), side('r'), provider, reason)).toBe('Not relational');
    expect(validateSides(side('a'), side('m'), provider, reason)).toMatch(/same kind/);
    expect(validateSides(side('a', 'public'), side('a', 'PUBLIC'), provider, reason)).toMatch(/same schema/);
    expect(validateSides(side('a', 'public'), side('a', 'staging'), provider, reason)).toBeNull();
    expect(validateSides(side('a', 'public'), side('b', 'public'), provider, reason)).toBeNull();
  });
});
