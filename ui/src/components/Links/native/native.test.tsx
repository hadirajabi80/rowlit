// The native link wizard and the "Add to link…" dialog against the MSW mock engine.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeScriptResult } from '../../../api/links';
import { isEnabled, registerCommand } from '../../../commands/registry';
import { linkedConnections } from '../../../mocks/packs/linked';
import { useConnections } from '../../../store/connections';
import { useTabs } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import { installMockEngine, TEST_ENGINE_URL } from '../../../test/mockServer';
import { AddToLinkDialog } from '../materialize/AddToLinkDialog';
import { NativeLinkDialog, SCRIPT_DEBOUNCE_MS } from './NativeLinkDialog';
import { nativeRequestOf, registerNativeLinkCommands } from './commands';

const mock = installMockEngine();
const LINK = 'c_link';
const P = `${TEST_ENGINE_URL}/api/v1`;

const script: NativeScriptResult = {
  dialect: 'pgsql', kind: 'fdw', availableKinds: ['fdw', 'federated'],
  script: "CREATE EXTENSION IF NOT EXISTS postgres_fdw;\nCREATE SERVER shop_srv FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'db', dbname 'shop');\nCREATE USER MAPPING FOR CURRENT_USER SERVER shop_srv OPTIONS (user 'shop', password '<password>');",
  placeholders: ['<password>'], notes: ['Install the postgres_fdw extension first.'],
};
let scripts: Record<string, unknown>[] = [];

beforeAll(() => registerNativeLinkCommands());
beforeEach(async () => {
  mock.reset();
  scripts = [];
  useTabs.setState({ tabs: [], activeId: null, seq: 0 });
  useUi.setState({ toasts: [] } as never);
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  await useConnections.getState().load();
  // The linked pack may already be active in the mock engine: add only the links that are not loaded yet.
  const have = new Set(useConnections.getState().connections.map((c) => c.id));
  useConnections.setState({ connections: [...useConnections.getState().connections, ...linkedConnections.filter((c) => !have.has(c.id))] });
  mock.server.use(
    http.post(`${P}/links/${LINK}/native-script`, async ({ request }) => {
      scripts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(script);
    }),
  );
});

describe('NativeLinkDialog', () => {
  it('asks the engine for the script of the member and the target and marks the placeholders', async () => {
    render(<NativeLinkDialog request={{ linkId: LINK, memberAlias: 'shop', targetConnectionId: 'c_pg' }} onClose={() => {}} />);
    const pre = await screen.findByLabelText('Native link script');
    expect(pre).toHaveTextContent('CREATE EXTENSION IF NOT EXISTS postgres_fdw;');
    expect(pre.querySelector('mark')?.textContent).toBe('<password>');
    expect(screen.getByLabelText('Placeholders to replace')).toHaveTextContent('<password>');
    expect(screen.getByText('Install the postgres_fdw extension first.')).toBeInTheDocument();
    expect(scripts.at(-1)).toEqual({ targetConnectionId: 'c_pg', memberAlias: 'shop' });
  });

  it('never offers the member\'s own server, and sends the kind and name that were chosen', async () => {
    render(<NativeLinkDialog request={{ linkId: LINK, memberAlias: 'crm', targetConnectionId: 'c_pg' }} onClose={() => {}} />);
    await screen.findByLabelText('Native link script');
    const targets = Array.from((screen.getByLabelText('Target connection') as HTMLSelectElement).options).map((o) => o.value);
    expect(targets).not.toContain('c_pg'); // crm lives on c_pg
    expect(targets).toContain('c_prod');
    fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'c_prod' } });
    await waitFor(() => expect(scripts.at(-1)?.targetConnectionId).toBe('c_prod'));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'federated' } });
    await waitFor(() => expect(scripts.at(-1)?.kind).toBe('federated'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'crm_link' } });
    await waitFor(() => expect(scripts.at(-1)).toMatchObject({ kind: 'federated', name: 'crm_link', memberAlias: 'crm' }), { timeout: SCRIPT_DEBOUNCE_MS + 3000 });
  });

  it('opens the script in a console on the target connection', async () => {
    const onClose = vi.fn();
    render(<NativeLinkDialog request={{ linkId: LINK, memberAlias: 'shop', targetConnectionId: 'c_pg' }} onClose={onClose} />);
    await screen.findByLabelText('Native link script');
    fireEvent.click(screen.getByRole('button', { name: /Open in console/ }));
    const tab = useTabs.getState().tabs.find((t) => t.kind === 'console');
    expect(tab).toMatchObject({ connectionId: 'c_pg', title: 'Native link: shop' });
    expect(tab && 'text' in tab ? tab.text : '').toBe(script.script);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the engine error for a pair it cannot script', async () => {
    mock.server.use(http.post(`${P}/links/${LINK}/native-script`, () => HttpResponse.json({ error: { code: 'NOT_SUPPORTED', message: 'SQLite cannot host a native link.' } }, { status: 501 })));
    render(<NativeLinkDialog request={{ linkId: LINK, memberAlias: 'shop', targetConnectionId: 'c_pg' }} onClose={() => {}} />);
    expect(await screen.findByText('SQLite cannot host a native link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in console/ })).toBeDisabled();
  });

  it('explains when there is no link yet', async () => {
    useConnections.setState({ connections: useConnections.getState().connections.filter((c) => c.providerId !== 'linked') });
    render(<NativeLinkDialog request={{}} onClose={() => {}} />);
    expect(await screen.findByText(/There is no linked database yet/)).toBeInTheDocument();
    expect(scripts).toHaveLength(0);
  });
});

describe('links.nativeLink command', () => {
  it('applies to a link\'s row, the active linked console, or the palette when a link exists', () => {
    expect(nativeRequestOf({ kind: 'connection', connectionId: LINK })).toEqual({ linkId: LINK });
    expect(nativeRequestOf({ kind: 'connection', connectionId: 'c_pg' })).toBeNull();
    expect(nativeRequestOf({ connectionId: LINK, memberAlias: 'crm', targetConnectionId: 'c_prod' })).toEqual({ linkId: LINK, memberAlias: 'crm', targetConnectionId: 'c_prod' });
    expect(nativeRequestOf()).toEqual({ linkId: null });
    expect(isEnabled('links.nativeLink', { kind: 'connection', connectionId: LINK })).toBe(true);
    expect(isEnabled('links.nativeLink', { kind: 'connection', connectionId: 'c_pg' })).toBe(false);
    useConnections.setState({ connections: useConnections.getState().connections.filter((c) => c.providerId !== 'linked') });
    expect(isEnabled('links.nativeLink')).toBe(false);
  });
});

describe('AddToLinkDialog', () => {
  const source = { connectionId: 'c_pg', database: 'shop', schema: 'public', name: 'invoices', type: 'table' };
  let saved: Record<string, unknown>[] = [];

  beforeEach(() => {
    saved = [];
    mock.server.use(
      http.put(`${P}/connections/${LINK}`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        saved.push(body);
        return HttpResponse.json({ ...linkedConnections[0], props: body.props });
      }),
    );
  });

  it('adds the table to the member of its schema and saves the link through /connections', async () => {
    const onClose = vi.fn();
    render(<AddToLinkDialog source={source} onClose={onClose} />);
    expect(screen.getByRole('radio', { name: /Sales \(linked\)/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const members = (saved[0].props as { members: { alias: string; tables: { name: string }[] }[] }).members;
    // The member keeps the tables it already had (from the mock pack) and gains the new one at the end.
    const before = (linkedConnections[0]!.props.members as { alias: string; tables: { name: string }[] }[]).find((m) => m.alias === 'crm')?.tables.map((t) => t.name) ?? [];
    expect(members.find((m) => m.alias === 'crm')?.tables.map((t) => t.name)).toEqual([...before, 'invoices']);
    expect(saved[0]).toMatchObject({ providerId: 'linked', readOnly: true, password: null });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useUi.getState().toasts.some((t) => t.text.includes('Added public.invoices to Sales (linked)'))).toBe(true);
  });

  it('says so, and saves nothing, when the table is already in the link', async () => {
    const onClose = vi.fn();
    render(<AddToLinkDialog source={{ ...source, name: 'customers' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved).toHaveLength(0);
    expect(useUi.getState().toasts.some((t) => t.text.includes('is already in'))).toBe(true);
  });

  it('shows a save error and keeps the dialog open', async () => {
    mock.server.use(http.put(`${P}/connections/${LINK}`, () => HttpResponse.json({ error: { code: 'VALIDATION', message: 'Alias "crm" is taken.' } }, { status: 400 })));
    const onClose = vi.fn();
    render(<AddToLinkDialog source={source} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Alias "crm" is taken.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"New link…" hands the table to the link editor as its first member', async () => {
    const run = vi.fn();
    registerCommand({ id: 'links.new', title: 'New linked database…', category: 'File', run });
    const onClose = vi.fn();
    render(<AddToLinkDialog source={source} onClose={onClose} />);
    fireEvent.click(screen.getByRole('radio', { name: /New link/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onClose).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ members: [expect.objectContaining({ connectionId: 'c_pg', schema: 'public', tables: [{ name: 'invoices', type: 'table' }] })] }));
  });
});
