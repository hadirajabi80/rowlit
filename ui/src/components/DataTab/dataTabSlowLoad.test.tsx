// Data tab on a server that does not answer: after the slow-load delay the tab says "Still loading…" with Cancel / Retry.
// Cancel stops waiting (and frees the queue behind the load), Retry loads again; both end in a usable tab.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo } from '../../api/types';
import { installGridMockEngine, until } from '../../mocks/m15/testServer';
import { useConnections } from '../../store/connections';
import { useSessions } from '../../store/sessions';
import { useTabs, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { registerGridCommands } from './commands';
import { DataTabView } from './DataTabView';
import { openDataTab } from './open';
import { setSqlRunner, type QueryOutcome } from './runner';

vi.mock('../../store/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../store/catalog')>()), SLOW_LOAD_MS: 60 }));
vi.mock('../Grid/DataGrid', async () => {
  const React = await import('react');
  return {
    DataGrid: (p: { rows: { length: number } }) => React.createElement('div', { 'data-testid': 'grid', 'data-rows': String(p.rows.length) }),
    rowValue: () => null,
  };
});

installGridMockEngine();

const col = (name: string): ColumnInfo => ({
  name, ordinal: 0, dbType: 'int', kind: 'int', nullable: true, size: null, precision: null, scale: null, table: 't', schema: 'main', isKey: true,
});
const outcome = (rows: CellValue[][]): QueryOutcome => ({
  executionId: 'x', status: 'ok', resultSets: [{ columns: [col('id')], rows, truncated: false }], affected: 0, affectedReported: false, error: null, messages: [], outParams: [], elapsedMs: 1, txOpen: false,
});

/** While `hanging`, every statement never returns (a dead server); otherwise the table has three rows. */
let hanging = true;
let calls = 0;

beforeAll(async () => {
  registerGridCommands();
  await useConnections.getState().load();
  setSqlRunner(async (_sid, sql) => {
    calls++;
    if (hanging) return new Promise<QueryOutcome>(() => undefined);
    return sql.startsWith('SELECT COUNT(*)') ? outcome([[3]]) : outcome([[1], [2], [3]]);
  });
});
afterAll(() => setSqlRunner(null));
beforeEach(() => {
  cleanup();
  useTabs.setState({ tabs: [], activeId: null, mru: [], closed: [], focusRequest: null });
  useSessions.setState({ sessions: {}, byTab: {} });
  useUi.setState({ toasts: [] });
  hanging = true;
  calls = 0;
});

const Host = ({ id }: { id: string }) => {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <DataTabView tab={tab} theme="light" visible /> : null;
};
const open = (name: string) => openDataTab({ connectionId: 'c_shop', database: null, schema: 'main', name, type: 'table' });

describe('a load that gets no answer', () => {
  it('is quiet at first, then offers Cancel; Cancel ends the wait with a clear message and Retry loads again', async () => {
    const id = open('orders');
    render(<Host id={id} />);
    expect(screen.queryByText(/Still loading/)).toBeNull();
    await screen.findByText(/Still loading… the server/, undefined, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Loading was cancelled.')).toBeInTheDocument();
    expect(screen.queryByText(/Still loading… the server/)).toBeNull();

    hanging = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await until(() => screen.queryAllByTestId('grid').length === 1);
    expect(screen.queryByText('Loading was cancelled.')).toBeNull();
  });

  it('Retry from the "Still loading" notice cancels the stuck load and loads again', async () => {
    const id = open('orders');
    render(<Host id={id} />);
    await screen.findByText(/Still loading… the server/, undefined, { timeout: 3000 });
    const before = calls;

    hanging = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await until(() => screen.queryAllByTestId('grid').length === 1);
    expect(calls).toBeGreaterThan(before);
    expect(screen.queryByText(/Still loading/)).toBeNull();
  });
});
