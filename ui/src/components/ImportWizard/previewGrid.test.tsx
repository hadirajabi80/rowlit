import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewGrid } from './PreviewGrid';
import type { PreviewResult } from './types';

const preview = (offset: number, rows: number, hasNextPage: boolean): PreviewResult => ({
  path: 'x.csv', fileName: 'x.csv', fileSize: 10,
  options: {} as PreviewResult['options'],
  columns: [{ index: 0, name: 'id', inferred: { kind: 'int', nullable: false } as PreviewResult['columns'][number]['inferred'] }],
  rows: Array.from({ length: rows }, (_, i) => [String(offset + i + 1)]),
  sampledRows: 2000, moreRows: true, warnings: [], offset, hasNextPage,
});

describe('PreviewGrid pagination', () => {
  it('numbers rows from the page offset and pages forward and back', () => {
    const onPage = vi.fn();
    const { rerender } = render(<PreviewGrid preview={preview(0, 50, true)} page={0} onPage={onPage} />);
    expect(screen.getByText('Rows 1–50', { exact: false })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPage).toHaveBeenLastCalledWith(1);

    rerender(<PreviewGrid preview={preview(50, 7, false)} page={1} onPage={onPage} />);
    expect(screen.getByText('Rows 51–57', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('51')).toHaveLength(2); // row number cell and the value of that row
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPage).toHaveBeenLastCalledWith(0);
  });

  it('hides the pager for a single page', () => {
    render(<PreviewGrid preview={preview(0, 3, false)} page={0} onPage={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});
