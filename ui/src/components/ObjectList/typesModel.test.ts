// Objects tab, Types group: kind labels and the catalog fallback list.
import { describe, expect, it } from 'vitest';
import type { CatalogSchema } from '../../api/types';
import type { ObjectListItem } from '../../api/types.objects';
import { countByGroup, filterObjects, fromCatalog, itemTypeLabel } from './model';

const item = (name: string, type: ObjectListItem['type'], kind?: string): ObjectListItem => ({
  type, schema: 'dbo', name, rowCount: null, sizeBytes: null, modified: null, created: null, comment: null, ...(kind ? { kind } : {}),
});

describe('Types group', () => {
  it('labels type objects by their kind and other objects by their type', () => {
    expect(itemTypeLabel(item('Phone', 'type', 'alias'))).toBe('user-defined data type');
    expect(itemTypeLabel(item('PhoneList', 'type', 'table'))).toBe('user-defined table type');
    expect(itemTypeLabel(item('order_status', 'type', 'enum'))).toBe('enum type');
    expect(itemTypeLabel(item('dict', 'type'))).toBe('type');
    expect(itemTypeLabel(item('Customers', 'table'))).toBe('table');
    expect(itemTypeLabel(item('fn', 'tablefunc'))).toBe('function');
  });

  it('counts and filters the types as one group; the filter finds them by name', () => {
    const items = [item('Phone', 'type', 'alias'), item('PhoneList', 'type', 'table'), item('NoteSchema', 'type', 'xmlschema'), item('Customers', 'table')];
    expect(countByGroup(items).type).toBe(3);
    expect(filterObjects(items, 'type', '').map((i) => i.name)).toEqual(['Phone', 'PhoneList', 'NoteSchema']);
    expect(filterObjects(items, 'all', 'phone').map((i) => i.name)).toEqual(['Phone', 'PhoneList']);
  });

  it('the fallback list (statistics unavailable) keeps the kind and shows the definition summary as the comment', () => {
    const schema: CatalogSchema = {
      name: 'dbo', version: 1,
      objects: [{ t: 'type', n: 'Phone', k: 'alias', bt: 'nvarchar(20) not null' }, { t: 'type', n: 'order_status', cm: 'a comment', k: 'enum' }, { t: 'table', n: 'Customers' }],
    };
    const list = fromCatalog([schema], null);
    expect(list.find((i) => i.name === 'Phone')).toMatchObject({ kind: 'alias', comment: 'nvarchar(20) not null' });
    expect(list.find((i) => i.name === 'order_status')).toMatchObject({ kind: 'enum', comment: 'a comment' });
    expect(list.find((i) => i.name === 'Customers')?.kind).toBeUndefined();
  });
});
