// Data tab: a table that cannot be opened is never a silent nothing. SESSION_LIMIT is relieved by releasing an idle Data
// tab's session; any other failure of the first read is shown in the tab AND as a toast; opening the table again after a
// failure loads it again.
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/client';
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

vi.mock('../Grid/DataGrid', async () => {
  const React = await import('react');
  return {
    DataGrid: (p: { rows: { length: number } }) => React.createElement('div', { 'data-testid': 'grid', 'data-rows': String(p.rows.length) }),
    rowValue: () => null,
  };
});

installGridMockEngine();

const col = (name: string, ordinal: number, isKey = false): ColumnInfo => ({
  name, ordinal, dbType: 'int', kind: 'int', nullable: true, size: null, precision: null, scale: null, table: 't', schema: 'main', isKey,
});
let failing: string | null = null;
const outcome = (rows: CellValue[][]): QueryOutcome => ({
  executionId: 'x', status: 'ok', resultSets: [{ columns: [col('id', 0, true)], rows, truncated: false }], affected: 0, affectedReported: false, error: null, messages: [], outParams: [], elapsedMs: 1, txOpen: false,
});
const failed = (message: string): QueryOutcome => ({ ...outcome([]), status: 'error', resultSets: [], error: { message, code: 'X', line: null } });

beforeAll(async () => {
  registerGridCommands();
  await useConnections.getState().load();
  setSqlRunner(async (_sid, sql) => {
    if (failing && sql.includes(failing)) return failed('permission denied for table');
    if (sql.startsWith('SELECT COUNT(*)')) return outcome([[3]]);
    return outcome([[1], [2], [3]]);
  });
});
afterAll(() => setSqlRunner(null));
beforeEach(() => {
  cleanup();
  useTabs.setState({ tabs: [], activeId: null, mru: [], closed: [], focusRequest: null });
  useSessions.setState({ sessions: {}, byTab: {} });
  useUi.setState({ toasts: [] });
  failing = null;
});
afterEach(() => vi.restoreAllMocks());

const dataTab = (id: string): ViewTab => useTabs.getState().tabs.find((t) => t.id === id) as ViewTab;
const Host = ({ id }: { id: string }) => {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <DataTabView tab={tab} theme="light" visible /> : null;
};
const open = (name: string) => openDataTab({ connectionId: 'c_shop', database: null, schema: 'main', name, type: 'table' });
const toasts = () => useUi.getState().toasts;

describe('session limit', () => {
  it('opening one more table at the limit releases an idle data tab session instead of failing', async () => {
    const LIMIT = 1;
    const create = api.createSession.bind(api);
    vi.spyOn(api, 'createSession').mockImplementation(async (req) => {
      if (Object.keys(useSessions.getState().sessions).length >= LIMIT) throw new ApiError('SESSION_LIMIT', 'limit reached', 429);
      return create(req);
    });
    const a = open('first');
    render(<Host id={a} />);
    await until(() => !!useSessions.getState().byTab[a] && screen.queryAllByTestId('grid').length === 1);
    const b = open('second');
    render(<Host id={b} />);
    await until(() => !!useSessions.getState().byTab[b], 5000);
    expect(useSessions.getState().byTab[a]).toBeUndefined(); // the idle tab gave its session up
    await until(() => screen.queryAllByTestId('grid').length === 2);
    expect(toasts().some((t) => /Session limit/.test(t.text))).toBe(false);
    expect(dataTab(b)).toBeTruthy();
  });
});

describe('a table that cannot be read', () => {
  it('shows the error in the tab and in a toast; opening it again after the cause is gone loads it', async () => {
    failing = 'broken';
    const id = open('broken');
    render(<Host id={id} />);
    await until(() => toasts().length > 0);
    expect(toasts()[0]).toMatchObject({ kind: 'error' });
    expect(toasts()[0].text).toMatch(/Could not open (main\.)?broken/);
    expect(toasts()[0].detail).toMatch(/permission denied/);
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();

    failing = null;
    expect(open('broken')).toBe(id); // same tab, loads again
    await until(() => screen.queryAllByTestId('grid').length === 1);
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  it('a tab in the background (restored workspace) stays quiet', async () => {
    failing = 'broken';
    const id = open('broken');
    const other = open('other');
    expect(useTabs.getState().activeId).toBe(other);
    render(<Host id={id} />);
    await screen.findByText(/permission denied/);
    expect(toasts()).toHaveLength(0);
  });
});
