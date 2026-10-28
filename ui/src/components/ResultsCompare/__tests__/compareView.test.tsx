import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, ColumnKind } from '../../../api/types';
import { ChunkedList } from '../../../lib/chunked';
import { useTabs, type ViewTab } from '../../../store/tabs';
import type { DataGridProps } from '../../Grid/DataGrid';
import { MenuHost } from '../../common/Menu';
import { diffResults } from '../diff';
import { COMPARE_VIEW } from '../open';
import { noticesOf } from '../notices';
import { ResultsCompareView } from '../ResultsCompareView';
import { clearComparisons, registerComparison, type CompareSet } from '../sources';

// The merged grid as plain DOM: one line per row, the tint of every cell as an attribute.
vi.mock('../../Grid/LazyDataGrid', () => ({
  DataGrid: (p: DataGridProps) => (
    <div data-testid="grid" data-rows={p.rows.length}>
      {Array.from({ length: p.rows.length }, (_, r) => (
        <div key={r} data-testid="line">
          {p.columns.map((c, ci) => (
            <span key={c.name} data-col={c.name} data-tint={p.cellTint?.(r, ci) ?? ''}>
              {String(p.rows.get(r)?.[ci] ?? '')}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

const col = (name: string, kind: ColumnKind = 'string', isKey = false): ColumnInfo => ({
  name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'people', schema: 'main', isKey,
});
const setOf = (title: string, rows: CellValue[][], extra: Partial<CompareSet> = {}): CompareSet => ({
  title, detail: `SELECT * FROM ${title}`, connectionId: null, columns: [col('id', 'int', true), col('name'), col('city')],
  rows: ChunkedList.from(rows), rowCount: rows.length, complete: true, ...extra,
});
const A = () => setOf('Result 1', [[1, 'ada', 'london'], [2, 'bob', 'paris'], [3, 'cy', 'rome']]);
const B = () => setOf('Pinned', [[1, 'ada', 'london'], [2, 'bobby', 'paris'], [4, 'dee', 'oslo']]);

function open(left: CompareSet, right: CompareSet) {
  const compareId = registerComparison({ left, right });
  const tab: ViewTab = { kind: 'view', id: 'v1', title: 'Compare', view: COMPARE_VIEW, connectionId: null, database: null, state: { compareId }, key: compareId };
  return render(<><ResultsCompareView tab={tab} theme="light" visible /><MenuHost /></>);
}
const lines = () => screen.queryAllByTestId('line').map((l) => Array.from(l.querySelectorAll('span')).map((s) => s.textContent));
const tints = (line: number) => Array.from(screen.getAllByTestId('line')[line].querySelectorAll('span')).map((s) => s.getAttribute('data-tint'));

beforeEach(() => {
  clearComparisons();
  act(() => useTabs.setState({ tabs: [], activeId: null }));
});

describe('ResultsCompareView', () => {
  it('shows the differences as one grid, the summary, and tints added / removed / changed cells', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    const summary = screen.getByRole('status', { name: 'Summary' });
    expect(summary).toHaveTextContent('+1');
    expect(summary).toHaveTextContent('−1');
    expect(summary).toHaveTextContent('~1');
    expect(summary).toHaveTextContent('=1');
    expect(lines()).toEqual([
      ['Changed (before)', '2', 'bob', 'paris'],
      ['Changed (after)', '2', 'bobby', 'paris'],
      ['Removed', '3', 'cy', 'rome'],
      ['Added', '4', 'dee', 'oslo'],
    ]);
    expect(tints(0)).toEqual(['changed', '', 'removed', '']);
    expect(tints(1)).toEqual(['changed', '', 'added', '']);
    expect(tints(2)).toEqual(['removed', 'removed', 'removed', 'removed']);
    expect(tints(3)).toEqual(['added', 'added', 'added', 'added']);
  });

  it('starts on the primary key and says what it matched on', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    expect(screen.getByText(/matched on id/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Key:/ })).toHaveTextContent('id');
  });

  it('"Differences only" off brings the identical rows back', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    fireEvent.click(screen.getByLabelText('Differences only'));
    await waitFor(() => expect(lines()).toHaveLength(5));
    expect(lines()[0]).toEqual(['Same', '1', 'ada', 'london']);
    expect(tints(0)).toEqual(['', '', '', '']);
  });

  it('whole-row comparison (no key) turns a changed row into a removed and an added row', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    fireEvent.click(screen.getByRole('button', { name: /Key:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Key columns' })).getByRole('button', { name: 'Whole row' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('~0'));
    expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('+2');
    expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('−2');
    expect(screen.getByText(/No key columns: whole rows are compared/)).toBeInTheDocument();
  });

  it('picking another key column recomputes', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    fireEvent.click(screen.getByRole('button', { name: /Key:/ }));
    const dlg = screen.getByRole('dialog', { name: 'Key columns' });
    fireEvent.click(within(dlg).getByLabelText('id')); // off
    fireEvent.click(within(dlg).getByLabelText('city')); // on: Paris/London/Rome vs ... rows match by city
    await waitFor(() => expect(screen.getByRole('button', { name: /Key:/ })).toHaveTextContent('city'));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Summary' })).toHaveTextContent('~1'));
  });

  it('swapping A and B turns the added rows into removed rows', async () => {
    open(A(), B());
    await screen.findByTestId('grid');
    fireEvent.click(screen.getByRole('button', { name: 'Swap A and B' }));
    await waitFor(() => expect(lines()[2]).toEqual(['Removed', '4', 'dee', 'oslo']));
    expect(lines()[3]).toEqual(['Added', '3', 'cy', 'rome']);
  });

  it('says so when the results are identical', async () => {
    open(A(), A());
    expect(await screen.findByText(/The two results are identical/)).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).toBeNull();
  });

  it('warns about an incomplete side', async () => {
    open(A(), setOf('Pinned', [[1, 'ada', 'london']], { complete: false, rowCount: 5000 }));
    await screen.findByTestId('grid');
    expect(screen.getByText(/B \(Pinned\) holds 1 of 5,000 rows/)).toBeInTheDocument();
  });

  it('results without a common column cannot be compared', async () => {
    const other = setOf('Other', [[1]], { columns: [col('x', 'int')] });
    open(A(), other);
    expect(await screen.findByText(/share no column name/)).toBeInTheDocument();
  });

  it('a comparison that is gone (restart) says so and closes on request', () => {
    const tab: ViewTab = { kind: 'view', id: 'v9', title: 'Compare', view: COMPARE_VIEW, connectionId: null, database: null, state: { compareId: 'cmp-missing' } };
    act(() => useTabs.setState({ tabs: [tab], activeId: 'v9' }));
    render(<ResultsCompareView tab={tab} theme="light" visible />);
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close this tab/ }));
    expect(useTabs.getState().tabs.find((t) => t.id === 'v9')).toBeUndefined();
  });
});

describe('noticesOf', () => {
  it('lists duplicates, dropped keys, one-sided columns and kind mismatches', () => {
    const left = setOf('L', [[1, 'a', 'x'], [1, 'b', 'y']], { columns: [col('id', 'int'), col('name'), col('only_a')] });
    const right = setOf('R', [[1, 'a', 'x']], { columns: [col('id', 'string'), col('name'), col('only_b')] });
    const d = diffResults(left, right, { keys: ['id', 'gone'] });
    const n = noticesOf(d, left, right, ['id', 'gone']).join('\n');
    expect(n).toMatch(/share a key/);
    expect(n).toMatch(/gone is missing/);
    expect(n).toMatch(/Only in A, not compared: only_a/);
    expect(n).toMatch(/Only in B, not compared: only_b/);
    expect(n).toMatch(/Different types in A and B .*: id/);
  });
});
