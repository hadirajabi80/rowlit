// The MySQL / MariaDB table options row of the table designer (TableOptions.extra) and its registration.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TableModel } from '../../api/types';
import { designerOptionsPanel } from '../../designer/table/optionsPanels';
import { registerMySqlCommands } from './commands';
import MySqlTableOptions from './TableOptions';

const table = (extra?: Record<string, string>): TableModel => ({
  schema: 'shop', name: 'orders', comment: null, options: { withoutRowid: false, strict: false, tablespace: null, extra },
  columns: [], primaryKey: null, uniques: [], indexes: [], foreignKeys: [], checks: [],
});

const select = () => document.querySelector('select') as HTMLSelectElement;

describe('MySQL table options panel', () => {
  it('shows what the server reports for an existing table', () => {
    render(<MySqlTableOptions table={table({ engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci', rowFormat: 'Dynamic', autoIncrement: '1001' })} existing disabled={false} onChange={() => {}} />);
    expect(screen.getByDisplayValue('InnoDB')).toBeEnabled();
    expect(screen.getByDisplayValue('utf8mb4')).toBeEnabled();
    expect(screen.getByDisplayValue('utf8mb4_0900_ai_ci')).toBeEnabled();
    expect(screen.getByDisplayValue('1001')).toBeEnabled();
    expect(select().value).toBe('DYNAMIC');
  });

  it('edits write the keys the scripter reads; clearing a field drops its key', () => {
    const onChange = vi.fn();
    render(<MySqlTableOptions table={table({ engine: 'InnoDB' })} existing={false} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('InnoDB'), { target: { value: 'MyISAM' } });
    expect(onChange).toHaveBeenLastCalledWith({ engine: 'MyISAM' });
    fireEvent.change(screen.getByPlaceholderText('1'), { target: { value: '500' } });
    expect(onChange).toHaveBeenLastCalledWith({ engine: 'InnoDB', autoIncrement: '500' });
    fireEvent.change(select(), { target: { value: 'COMPRESSED' } });
    expect(onChange).toHaveBeenLastCalledWith({ engine: 'InnoDB', rowFormat: 'COMPRESSED' });
    fireEvent.change(screen.getByDisplayValue('InnoDB'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('changing the character set drops the old collation (the new set\'s default applies)', () => {
    const onChange = vi.fn();
    render(<MySqlTableOptions table={table({ charset: 'latin1', collation: 'latin1_swedish_ci' })} existing disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('latin1'), { target: { value: 'utf8mb4' } });
    expect(onChange).toHaveBeenLastCalledWith({ charset: 'utf8mb4' });
    fireEvent.change(screen.getByDisplayValue('latin1_swedish_ci'), { target: { value: 'latin1_bin' } });
    expect(onChange).toHaveBeenLastCalledWith({ charset: 'latin1', collation: 'latin1_bin' });
  });

  it('is read-only while a script is applied', () => {
    render(<MySqlTableOptions table={table({ engine: 'InnoDB' })} existing disabled onChange={() => {}} />);
    expect(screen.getByDisplayValue('InnoDB')).toBeDisabled();
    expect(select()).toBeDisabled();
  });

  it('is registered for MySQL and MariaDB only', () => {
    registerMySqlCommands();
    expect(designerOptionsPanel('mysql')).toBeDefined();
    expect(designerOptionsPanel('mariadb')).toBe(designerOptionsPanel('mysql'));
    expect(designerOptionsPanel('postgresql')).toBeUndefined();
  });
});
