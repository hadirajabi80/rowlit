// Settings → Snippets: create, validate, save (persisted through onChange / Settings.snippets), customize a
// built-in, delete.
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Snippet } from '../../api/types';
import { SnippetsSettings } from './SnippetsSettings';

let saved: Snippet[] = [];
function Host({ initial }: { initial: Snippet[] }) {
  const [list, setList] = useState(initial);
  return <SnippetsSettings snippets={list} onChange={(n) => { saved = n; setList(n); }} />;
}

describe('SnippetsSettings', () => {
  it('creates, validates and saves a user snippet', () => {
    saved = [];
    render(<Host initial={[]} />);
    fireEvent.click(screen.getAllByRole('button', { name: /New snippet/ })[0]);
    const prefix = screen.getByLabelText('Prefix');
    fireEvent.change(prefix, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(screen.getByText(/Prefix: letters/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Top orders' } });
    fireEvent.change(prefix, { target: { value: 'topo' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'SELECT TOP (${1:10}) * FROM Orders$0' } });
    expect(screen.getByText('SELECT TOP (10) * FROM Orders')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Top orders', prefix: 'topo', body: 'SELECT TOP (${1:10}) * FROM Orders$0', dialects: null });
  });

  it('dialect filter checkboxes', () => {
    render(<Host initial={[{ id: 's_1', name: 'x', prefix: 'x', dialects: null, body: 'SELECT 1' }]} />);
    fireEvent.click(screen.getByLabelText('Oracle'));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(saved[0].dialects).toEqual(['tsql', 'sqlite', 'pgsql', 'mysql', 'clickhouse', 'snowflake', 'cql']);
  });

  // role queries over ~450 rows are slow in jsdom: plain DOM queries here
  const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="option"]'));
  const group = (c: HTMLElement, name: string) => c.querySelector(`[role="group"][aria-label="${name}"]`);

  it('customizing a built-in creates an overriding user snippet; delete removes it', async () => {
    const { container } = render(<Host initial={[]} />);
    await waitFor(() => expect(rows(container).some((o) => o.textContent?.startsWith('tryc'))).toBe(true), { timeout: 10000 });
    fireEvent.click(rows(container).find((o) => o.textContent?.startsWith('tryc'))!);
    expect(screen.getByText(/built-in, read-only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Customize/ }));
    expect(saved.at(-1)).toMatchObject({ prefix: 'tryc', dialects: ['tsql'] });
    expect(rows(container).find((o) => o.textContent?.startsWith('tryc') && o.className.includes('overridden'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(saved).toHaveLength(0);
  }, 30000);

  it('lists the built-ins grouped by category and filters by name, description and category', async () => {
    const { container } = render(<Host initial={[]} />);
    await waitFor(() => expect(group(container, 'Query')).not.toBeNull(), { timeout: 10000 });
    for (const c of ['DML', 'DDL', 'Programmability', 'DBA / admin']) expect(group(container, c), c).not.toBeNull();
    expect(rows(container).length).toBeGreaterThan(400);
    fireEvent.change(screen.getByLabelText('Filter snippets'), { target: { value: 'blocking chains' } });
    expect(rows(container).length).toBeLessThan(10);
    expect(rows(container).some((o) => o.textContent?.startsWith('block'))).toBe(true);
    fireEvent.change(screen.getByLabelText('Filter snippets'), { target: { value: 'dba / admin' } });
    expect(group(container, 'Query')).toBeNull();
    expect(group(container, 'DBA / admin')).not.toBeNull();
  }, 30000);
});
