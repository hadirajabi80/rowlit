// QA (feature coverage round): Ctrl+P lists an overloaded routine (PostgreSQL / Oracle index it once per overload) as
// one row, like the Objects tab, with unique React keys. Duplicate keys left stale rows behind when the list changed, so "q:" kept
// showing functions after typing a filter.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogObject, CatalogObjectType } from '../../api/types';
import { initCommands } from '../../commands';
import { dbKey, useCatalog, type DbCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useUi } from '../../store/ui';
import { CommandPalette } from './CommandPalette';

const obj = (n: string, t: CatalogObjectType): CatalogObject => ({ n, t });

beforeEach(() => {
  initCommands();
  const objects = [obj('orders', 'table'), obj('price_range', 'func'), obj('price_range', 'func'), obj('fn_tax', 'func'), obj('fn_tax', 'func'), obj('fn_tax', 'func')];
  useConnections.setState({ connections: [{ id: 'c1', name: 'PG', providerId: 'postgresql' } as never] });
  useCatalog.setState({
    conns: {},
    dbs: { [dbKey('c1', 'shop')]: { connectionId: 'c1', database: 'shop', loaded: { public: { name: 'public', version: 1, objects } }, defaultSchema: 'public' } as unknown as DbCatalog },
  });
  useUi.setState({ paletteOpen: true, paletteMode: 'objects', paletteQuery: '' });
});

afterEach(() => {
  cleanup();
  useUi.setState({ paletteOpen: false });
  useCatalog.setState({ conns: {}, dbs: {} });
  useConnections.setState({ connections: [] });
  vi.restoreAllMocks();
});

describe('Ctrl+P with overloaded routines', () => {
  it('lists an overloaded routine once, without duplicate React keys', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CommandPalette />);
    expect(screen.getAllByText('fn_tax')).toHaveLength(1);
    expect(screen.getAllByText('price_range')).toHaveLength(1);
    const dup = err.mock.calls.filter((c) => String(c[0]).includes('same key'));
    expect(dup).toEqual([]);
  });
});
