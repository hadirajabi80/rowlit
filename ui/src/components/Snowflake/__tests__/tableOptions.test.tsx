// The Snowflake options row of the table designer (TableOptions.extra): TRANSIENT, Time Travel retention, CHANGE_TRACKING.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TableModel } from '../../../api/types';
import TableOptions from '../TableOptions';

const table = (extra?: Record<string, string>): TableModel => ({
  schema: 'PUBLIC', name: 'EVENTS', comment: null, options: { withoutRowid: false, strict: false, tablespace: null, extra },
  columns: [], primaryKey: null, uniques: [], indexes: [], foreignKeys: [], checks: [],
});

describe('Snowflake table options panel', () => {
  it('retention is 0..90 days, 0..1 for a transient table, and making a table transient lowers a longer retention', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TableOptions table={table({ retentionDays: '30' })} existing={false} disabled={false} onChange={onChange} />);
    const days = screen.getByRole('spinbutton');
    expect(days).toHaveAttribute('max', '90');
    fireEvent.change(days, { target: { value: '400' } });
    expect(onChange).toHaveBeenLastCalledWith({ retentionDays: '90' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'TRANSIENT' }));
    expect(onChange).toHaveBeenLastCalledWith({ retentionDays: '1', kind: 'transient' });

    rerender(<TableOptions table={table({ kind: 'transient', retentionDays: '1' })} existing={false} disabled={false} onChange={onChange} />);
    expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '1');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'transient', retentionDays: '1' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'TRANSIENT' }));
    expect(onChange).toHaveBeenLastCalledWith({ retentionDays: '1' });
  });

  it('TRANSIENT is fixed once the table exists; clearing retention drops the key', () => {
    const onChange = vi.fn();
    render(<TableOptions table={table({ kind: 'transient', retentionDays: '1', changeTracking: 'true' })} existing disabled={false} onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'TRANSIENT' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'transient', changeTracking: 'true' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'CHANGE_TRACKING' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'transient', retentionDays: '1' });
  });
});
