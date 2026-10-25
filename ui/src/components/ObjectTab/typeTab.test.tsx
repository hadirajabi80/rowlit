// Object tab of a user-defined type: opens on the overview; kind, properties, columns/labels, items, "Used by", DDL.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { ObjectDetails, ObjectRef, TypeDetails } from '../../api/types';
import { initCommands } from '../../commands';
import { useConnections } from '../../store/connections';
import { useSettings } from '../../store/settings';
import { useTabs, type ObjectTab } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { ObjectTabView } from './ObjectTab';

// Monaco does not run in jsdom: the DDL editor is a plain element here.
vi.mock('../../editor/SqlEditor', () => ({
  SqlEditor: ({ value }: { value: string }) => <pre data-testid="ddl-editor">{value}</pre>,
}));

installMockEngine({ frameDelay: 0 });
const SLOW = { timeout: 8000 };

beforeAll(async () => {
  await initCommands();
});

beforeEach(async () => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  await useSettings.getState().load();
  await useConnections.getState().load();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ref = (name: string): ObjectRef => ({ database: null, schema: 'dbo', name, type: 'type' });
const tabOf = (cid: string, r: ObjectRef): ObjectTab => ({ kind: 'object', id: 'o1', title: r.name, connectionId: cid, database: null, ref: r });

function mockType(r: ObjectRef, typeInfo: TypeDetails | null, extra: Partial<ObjectDetails> = {}, ddl = 'CREATE TYPE …') {
  vi.spyOn(api, 'ddl').mockResolvedValue({ ddl, source: 'generated' });
  vi.spyOn(api, 'objectDetails').mockResolvedValue({
    ref: r, columns: [], indexes: [], foreignKeys: [], referencedBy: [], triggers: [], parameters: [], rowCountEstimate: null, created: null, modified: null,
    typeInfo, ...extra,
  });
}

const tabs = () => within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent);
const renderTab = (cid: string, r: ObjectRef) => render(<ObjectTabView tab={tabOf(cid, r)} theme="light" visible />);

describe('type object tab', () => {
  it('a table type: overview first, then its DDL, columns, indexes, check constraints and users', async () => {
    const r = ref('PhoneList');
    mockType(r, {
      kind: 'table',
      properties: [{ name: 'Columns', value: '2' }, { name: 'Primary key', value: 'Ordinal' }],
      itemsTitle: 'Check constraints', items: [{ name: 'CK__x', detail: '([Ordinal]>(0))' }],
      usedBy: [{ schema: 'dbo', name: 'SavePhones', type: 'proc', usage: 'parameter @Phones' }],
    }, {
      columns: [
        { name: 'Ordinal', type: 'int', nullable: false, default: null, isPk: true, isIdentity: false, isComputed: false, comment: null, ordinal: 1 },
        { name: 'Number', type: 'dbo.Phone', nullable: true, default: null, isPk: false, isIdentity: false, isComputed: false, comment: null, ordinal: 2 },
      ],
      indexes: [{ name: 'PK__x', unique: true, columns: ['Ordinal'], type: 'CLUSTERED', isPrimaryKey: true }],
    });
    renderTab('c_prod', r);
    await waitFor(() => expect(tabs()).toContain('Overview'), SLOW);
    expect(tabs()).toEqual(['Overview', 'DDL', 'Columns2', 'Indexes1', 'Check constraints1', 'Used by1', 'Dependencies']);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/^user-defined table type · /)).toBeInTheDocument(); // the header
    expect(within(screen.getByRole('table')).getByText('user-defined table type')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Primary key')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Ordinal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^Columns/ }));
    expect(screen.getByText('dbo.Phone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Check constraints/ }));
    expect(screen.getByText('([Ordinal]>(0))')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Used by/ }));
    const row = screen.getByText(/dbo.SavePhones/).closest('tr')!;
    expect(within(row).getByText('parameter @Phones')).toBeInTheDocument();
    expect(within(row).getByText('procedure')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'DDL' }));
    expect(screen.getByTestId('ddl-editor')).toHaveTextContent('CREATE TYPE …');
  });

  it('an enum lists its labels; a type nothing uses says so', async () => {
    const r = { ...ref('order_status'), schema: 'public' };
    mockType(r, { kind: 'enum', properties: [{ name: 'Labels', value: '2' }], itemsTitle: null, items: [], usedBy: [] }, {
      columns: ['new', 'paid'].map((l, i) => ({ name: l, type: 'enum label', nullable: false, default: null, isPk: false, isIdentity: false, isComputed: false, comment: null, ordinal: i + 1 })),
    });
    renderTab('c_pg', r);
    await waitFor(() => expect(tabs()).toContain('Labels2'), SLOW);
    expect(tabs()).not.toContain('Check constraints');
    fireEvent.click(screen.getByRole('tab', { name: /^Labels/ }));
    expect(screen.getByRole('columnheader', { name: 'Label' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Nullable' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Used by/ }));
    expect(screen.getByText('Nothing uses this type.')).toBeInTheDocument();
  });

  it('composite and object types call their columns attributes', async () => {
    const r = { ...ref('address'), schema: 'public' };
    mockType(r, { kind: 'composite', properties: [], itemsTitle: null, items: [], usedBy: [] }, {
      columns: [{ name: 'street', type: 'text', nullable: true, default: null, isPk: false, isIdentity: false, isComputed: false, comment: null, ordinal: 1 }],
    });
    renderTab('c_pg', r);
    await waitFor(() => expect(tabs()).toContain('Attributes1'), SLOW);
  });

  it('a type without details (a provider that reports none) opens on the DDL', async () => {
    const r = ref('dict');
    mockType(r, null);
    renderTab('c_prod', r);
    await waitFor(() => expect(screen.getByTestId('ddl-editor')).toBeInTheDocument(), SLOW);
    expect(tabs()).not.toContain('Overview');
    expect(screen.getByRole('tab', { name: 'DDL' })).toHaveAttribute('aria-selected', 'true');
  });
});
