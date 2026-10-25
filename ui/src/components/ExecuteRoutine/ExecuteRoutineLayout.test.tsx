// Execute routine dialog, the compact layout: one row per input parameter, a single "Outputs" line for OUT
// parameters, a collapsed call summary that expands into the SQL, inline validation, a sticky footer and the stacked
// layout on narrow windows.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireSocket } from '../../app/boot';
import { engineSocket } from '../../api/ws';
import { initCommands } from '../../commands';
import { displayShortcut } from '../../commands/keys';
import { FakeSocket } from '../../mocks/fakeSocket';
import { useConnections } from '../../store/connections';
import { useResults } from '../../store/results';
import { useSettings } from '../../store/settings';
import { useTabs } from '../../store/tabs';
import { installMockEngine, TEST_ENGINE_URL } from '../../test/mockServer';
import { ExecuteRoutineHost } from './ExecuteRoutineDialog';
import { useExecuteRoutine } from './store';

const mock = installMockEngine({ frameDelay: 0 });

beforeAll(async () => {
  await initCommands();
  wireSocket();
  engineSocket.setSocketFactory(() => new FakeSocket(mock.ctx.engine, 'test-token'));
  engineSocket.connect({ baseUrl: TEST_ENGINE_URL, token: 'test-token' });
  const t0 = Date.now();
  while (engineSocket.status !== 'open') {
    if (Date.now() - t0 > 5000) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
    useResults.getState().flush();
  }
}, 60_000);

const SESSION = {
  connectionId: 'c_prod', database: null, ref: { database: null, schema: 'dbo', name: 'GetActiveSessionByUniqueId', type: 'proc' as const },
};

beforeEach(async () => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useExecuteRoutine.setState({ request: null });
  mock.ctx.engine.settings = { ...mock.ctx.engine.settings, ui: { ...mock.ctx.engine.settings.ui, routineParams: {}, paramHistory: {} } };
  await useSettings.getState().load();
  await useConnections.getState().load();
});

afterEach(() => {
  act(() => useExecuteRoutine.getState().close());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openSession() {
  const view = render(<ExecuteRoutineHost />);
  act(() => useExecuteRoutine.getState().open(SESSION));
  await screen.findByLabelText('Value of uniqueId');
  return view;
}

describe('Execute routine dialog layout', () => {
  it('one compact row per input parameter; OUT parameters get no row, only the Outputs line', async () => {
    await openSession();
    const group = screen.getByRole('group', { name: 'Parameters' });
    // 6 input rows (INOUT included), each with its type badge next to the name
    expect(group.querySelectorAll('.er-row')).toHaveLength(6);
    for (const n of ['uniqueId', 'tenantId', 'since', 'note', 'retries']) expect(screen.getByLabelText(`Value of ${n}`)).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Value of includeExpired' })).toBeInTheDocument();
    expect(within(group).getByText('nvarchar(64)')).toBeInTheDocument();
    expect(within(group).getByText('bigint')).toBeInTheDocument();
    // INOUT keeps an input and carries an OUT badge
    expect(within(group.querySelector('[data-er-row="5"]') as HTMLElement).getByText('IN OUT')).toBeInTheDocument();
    // OUT-only: no input, no "Returned after the run" row
    expect(screen.queryByLabelText('Value of actionId')).toBeNull();
    expect(screen.queryByLabelText('Value of errorCode')).toBeNull();
    expect(group.textContent).not.toContain('Returned after the run');
    expect(screen.getByLabelText('Output parameters').textContent).toBe('Outputs:@actionId int,@errorCode int(returned after the run)');
    // typed editors: numbers narrow, dates as pickers, long text on one line with an expander
    expect(screen.getByLabelText('Value of tenantId')).toHaveAttribute('inputmode', 'numeric');
    expect((screen.getByLabelText('Value of since') as HTMLInputElement).type).toBe('datetime-local');
    expect(group.querySelector('[data-er-row="1"]')).toHaveClass('ed-number');
    // NULL on every row, Default only where the parameter has one
    expect(within(group).getAllByRole('button', { name: 'NULL' })).toHaveLength(6);
    expect(within(group).getAllByRole('button', { name: 'Default' })).toHaveLength(4);
    expect(group).toHaveClass('has-defaults');
  });

  it('the call is one summary line (values filled in); Show SQL expands it, Hide collapses it, Copy copies the SQL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openSession();
    expect(screen.queryByLabelText('Generated SQL')).toBeNull();
    expect(screen.queryByLabelText('Bind values')).toBeNull(); // the old chips row is gone
    fireEvent.change(screen.getByLabelText('Value of uniqueId'), { target: { value: 'abc-1' } });
    fireEvent.change(screen.getByLabelText('Value of tenantId'), { target: { value: '7' } });
    expect(screen.getByLabelText('Call summary').textContent).toBe(
      "EXEC [dbo].[GetActiveSessionByUniqueId] @uniqueId = 'abc-1', @tenantId = 7, @actionId OUT, @errorCode OUT",
    );
    const expander = screen.getByRole('button', { name: 'Show SQL' });
    expect(expander).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expander);
    const pre = screen.getByLabelText('Generated SQL');
    expect(pre.textContent).toContain('EXEC @return_value = [dbo].[GetActiveSessionByUniqueId]');
    expect(pre.className).toContain('er-preview'); // scrollable block (max-height in the stylesheet)
    expect(screen.getByRole('button', { name: 'Hide SQL' })).toHaveAttribute('aria-expanded', 'true');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy the call SQL' }));
    });
    expect(writeText).toHaveBeenCalledWith(pre.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Hide SQL' }));
    expect(screen.queryByLabelText('Generated SQL')).toBeNull();
  });

  it('validates inline: required values and number ranges, cleared by NULL; no run while invalid', async () => {
    await openSession();
    const tenant = screen.getByLabelText('Value of tenantId');
    expect(tenant).not.toHaveAttribute('aria-invalid');
    fireEvent.change(tenant, { target: { value: '99999999999999999999' } });
    expect(tenant).toHaveAttribute('aria-invalid', 'true');
    expect(tenant).toHaveClass('invalid');
    const err = document.getElementById(tenant.getAttribute('aria-describedby')!)!;
    expect(err).toHaveAttribute('role', 'alert');
    expect(err.textContent).not.toBe('');
    // a required value is only flagged once typing started or a run was tried (Ctrl+Enter from the Cancel button works too)
    fireEvent.change(tenant, { target: { value: '' } });
    expect(tenant).not.toHaveAttribute('aria-invalid');
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Enter', ctrlKey: true });
    });
    expect(tenant).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText('Enter a value, or choose NULL')).toBeInTheDocument();
    expect(useExecuteRoutine.getState().request).not.toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Parameters' }).querySelector('[data-er-row="1"]') as HTMLElement).getByRole('button', { name: 'NULL' }));
    expect(tenant).not.toHaveAttribute('aria-invalid');
    // the NULL toggle swaps a placeholder in, it does not resize the row
    expect((tenant as HTMLInputElement).placeholder).toBe('NULL');
  });

  it('Clear resets every parameter; Enter moves to the next field', async () => {
    await openSession();
    const unique = screen.getByLabelText('Value of uniqueId') as HTMLInputElement;
    fireEvent.change(unique, { target: { value: 'x' } });
    fireEvent.keyDown(unique, { key: 'Enter' });
    expect(screen.getByLabelText('Value of tenantId')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect(unique.value).toBe('');
  });

  it('long text takes one line and expands to a text area on demand, keeping its value', async () => {
    await openSession();
    const note = screen.getByLabelText('Value of note');
    expect(note.tagName).toBe('INPUT');
    fireEvent.change(note, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand note to a text area' }));
    const area = screen.getByLabelText('Value of note') as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe('hello');
    expect(area).toHaveFocus();
  });

  it('the footer is outside the scrolling body and holds Last values, Clear, Cancel, Run in console and Run (with its shortcut)', async () => {
    await openSession();
    const dialog = screen.getByRole('dialog');
    const footer = dialog.querySelector('.dialog-footer') as HTMLElement;
    expect(footer).toBeTruthy();
    expect(dialog.querySelector('.dialog-body')!.contains(footer)).toBe(false);
    for (const name of [/Last values/, /Clear/, 'Cancel', /^Run in console/, /^Run/]) expect(within(footer).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    // the Ctrl+Enter hint comes from the shortcut registry, not from literal text
    expect(within(footer).getByLabelText(displayShortcut('Mod+Enter'))).toBeInTheDocument();
    expect(dialog.querySelector('.er-params')).toBeTruthy(); // the rows are what scrolls
  });

  it('stacks the rows on narrow windows (matchMedia) and keeps the two-column row on wide ones', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('max-width: 639px'), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const narrow = await openSession();
      expect(screen.getByRole('dialog')).toHaveClass('er-narrow');
      expect(document.querySelector('.er-form')).toHaveClass('er-stacked');
      act(() => useExecuteRoutine.getState().close());
      narrow.unmount();
    } finally {
      window.matchMedia = original;
    }
    await openSession();
    expect(screen.getByRole('dialog')).not.toHaveClass('er-narrow');
    expect(document.querySelector('.er-form')).not.toHaveClass('er-stacked');
  });
});
