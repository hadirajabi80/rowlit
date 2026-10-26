// Window-wide file drop: the overlay (enter / leave counting, Escape, idle), the destination it names (the active table's
// tab, the explorer selection, the active connection, or nothing), and what a drop does per file type.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../../platform';
import { createBrowserPlatform } from '../../platform/browser';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useTabs, type Tab, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { useExplorer } from '../Explorer/explorerStore';
import { IMPORT_VIEW_ID, type ImportTabState } from '../ImportWizard/open';
import { DRAG_IDLE_MS, DropOverlay } from './DropOverlay';
import { classifyFiles, dropHeadline, resolveDropTarget } from './dropTarget';

const conn = (id: string, name: string, providerId: string, readOnly = false) =>
  ({ id, name, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

const file = (name: string, body = 'a,b') => new File([body], name);
const dt = (files: File[] = [], types: string[] = ['Files']) => ({ types, files, items: files.map(() => ({ kind: 'file' })), dropEffect: 'none' });

const dragEnter = (files: File[] = [file('a.csv')], target: Element | Window = window) => fireEvent.dragEnter(target, { dataTransfer: dt(files) });
const dragOver = (files: File[] = [file('a.csv')], target: Element | Window = window) => fireEvent.dragOver(target, { dataTransfer: dt(files) });
const dragLeave = (files: File[] = [file('a.csv')], target: Element | Window = window) => fireEvent.dragLeave(target, { dataTransfer: dt(files) });
const drop = (files: File[], target: Element | Window = window) => fireEvent.drop(target, { dataTransfer: dt(files) });

const overlay = () => screen.queryByTestId('drop-overlay');
const wizards = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === IMPORT_VIEW_ID);
const consoles = () => useTabs.getState().tabs.filter((t) => t.kind === 'console');
const wizardState = (t: ViewTab) => t.state as ImportTabState;

const dataTab = (cid: string, schema: string, name: string, type: 'table' | 'view' = 'table'): ViewTab => ({
  kind: 'view', id: 'data1', title: `${schema}.${name}`, view: 'data', connectionId: cid, database: 'shop', state: { schema, name, type }, key: 'k', dirty: false,
});
const consoleTab = (cid: string | null): Tab => ({
  kind: 'console', id: 'c1', title: 'Query 1', connectionId: cid, database: null, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null,
}) as Tab;

function setTabs(tabs: Tab[], activeId: string | null) {
  useTabs.setState({ tabs, activeId, seq: 0, mru: [], closed: [] });
}

beforeEach(() => {
  setTabs([], null);
  useUi.setState({ toasts: [] });
  useExplorer.setState({ selectedTarget: null });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('c1', 'Shop', 'sqlserver'), conn('c2', 'Warehouse', 'postgresql'), conn('ro', 'Archive', 'postgresql', true)] });
  useCatalog.setState({ loadDatabases: vi.fn(async () => null), ensureDefault: vi.fn(async () => {}) });
  setPlatform({ ...createBrowserPlatform(), getFilePath: (f: File) => (f.name === 'nopath.csv' ? null : `C:\\drop\\${f.name}`) });
});
afterEach(() => {
  vi.useRealTimers();
  setPlatform(null);
});

describe('what a drop is for', () => {
  it('classifies files by type', () => {
    const c = classifyFiles([file('a.csv'), file('b.TSV'), file('c.xlsx'), file('d.json'), file('e.ndjson'), file('f.sql'), file('g.png'), file('h.xls'), file('i.txt')]);
    expect(c.data.map((f) => f.name)).toEqual(['a.csv', 'b.TSV', 'c.xlsx', 'd.json', 'e.ndjson', 'i.txt']);
    expect(c.sql.map((f) => f.name)).toEqual(['f.sql']);
    expect(c.other.map((f) => f.name)).toEqual(['g.png', 'h.xls']);
  });

  it('is the table of the active data tab', () => {
    setTabs([dataTab('c1', 'dbo', 'orders')], 'data1');
    const t = resolveDropTarget();
    expect(t.kind).toBe('table');
    expect(t.ctx).toEqual({ connectionId: 'c1', database: 'shop', schema: 'dbo', table: 'orders' });
    expect(dropHeadline(t)).toBe('Drop to import into dbo.orders');
  });

  it('is the table of an active structure tab', () => {
    setTabs([{ kind: 'object', id: 'o1', title: 'orders', connectionId: 'c1', database: 'shop', ref: { database: 'shop', schema: 'dbo', name: 'orders', type: 'table' } }], 'o1');
    expect(resolveDropTarget().ctx).toMatchObject({ table: 'orders', schema: 'dbo' });
  });

  it('is a new table when the active tab is a view or a read-only connection', () => {
    setTabs([dataTab('c1', 'dbo', 'v_orders', 'view')], 'data1');
    expect(resolveDropTarget()).toMatchObject({ kind: 'connection', ctx: { connectionId: 'c1', table: null } });
    setTabs([{ ...dataTab('ro', 'public', 'x'), connectionId: 'ro' }], 'data1');
    expect(resolveDropTarget().kind).toBe('ask'); // a read-only connection is no destination; two writable ones remain
  });

  it('prefers the active table tab to the explorer selection', () => {
    setTabs([dataTab('c1', 'dbo', 'orders')], 'data1');
    useExplorer.setState({ selectedTarget: { kind: 'container', connectionId: 'c2', database: 'wh', schema: 'public' } });
    expect(resolveDropTarget()).toMatchObject({ kind: 'table', ctx: { connectionId: 'c1', table: 'orders' } });
  });

  it('is a new table in the schema selected in the explorer, ahead of the active console', () => {
    setTabs([consoleTab('c1')], 'c1');
    useExplorer.setState({ selectedTarget: { kind: 'container', connectionId: 'c2', database: 'wh', schema: 'public' } });
    const t = resolveDropTarget();
    expect(t.kind).toBe('schema');
    expect(t.ctx).toEqual({ connectionId: 'c2', database: 'wh', schema: 'public', table: null });
    expect(dropHeadline(t)).toBe('Drop to import into a new table in Warehouse › public');
  });

  it('is a new table in the schema of a table selected in the explorer', () => {
    useExplorer.setState({ selectedTarget: { kind: 'object', connectionId: 'c1', database: 'shop', ref: { database: 'shop', schema: 'sales', name: 'leads', type: 'table' } } });
    expect(resolveDropTarget().ctx).toEqual({ connectionId: 'c1', database: 'shop', schema: 'sales', table: null });
  });

  it('is the connection of the selected connection node or the active console', () => {
    useExplorer.setState({ selectedTarget: { kind: 'connection', connectionId: 'c2' } });
    expect(resolveDropTarget()).toMatchObject({ kind: 'connection', label: 'Warehouse', ctx: { connectionId: 'c2', schema: null, table: null } });
    useExplorer.setState({ selectedTarget: null });
    setTabs([consoleTab('c1')], 'c1');
    expect(resolveDropTarget()).toMatchObject({ kind: 'connection', label: 'Shop', ctx: { connectionId: 'c1' } });
  });

  it('keeps the schema of an active import wizard', () => {
    const state: ImportTabState = { path: null, targetMode: 'new', schema: 'sales', table: null };
    setTabs([{ kind: 'view', id: 'w1', title: 'Import', view: IMPORT_VIEW_ID, connectionId: 'c1', database: 'shop', state, key: 'i', dirty: false }], 'w1');
    expect(resolveDropTarget().ctx).toMatchObject({ connectionId: 'c1', schema: 'sales', table: null });
  });

  it('asks for the connection when nothing says and several could take it, uses the only one otherwise', () => {
    const t = resolveDropTarget();
    expect(t.kind).toBe('ask');
    expect(t.ctx.connectionId).toBeNull();
    expect(dropHeadline(t)).toBe('Drop to import into a database');
    useConnections.setState({ connections: [conn('c1', 'Shop', 'sqlserver'), conn('rd', 'Cache', 'redis')] });
    expect(resolveDropTarget()).toMatchObject({ kind: 'connection', label: 'Shop', ctx: { connectionId: 'c1' } });
  });
});

describe('the overlay', () => {
  it('appears while files are dragged over the window and names the destination', () => {
    setTabs([dataTab('c1', 'dbo', 'orders')], 'data1');
    render(<DropOverlay />);
    expect(overlay()).toBeNull();
    act(() => void dragEnter());
    expect(overlay()).toBeInTheDocument();
    expect(screen.getByText('Drop to import into dbo.orders')).toBeInTheDocument();
    expect(screen.getByLabelText('Files you can drop')).toHaveTextContent('CSV');
    expect(screen.getByLabelText('Files you can drop')).toHaveTextContent('SQL opens in a console');
    expect(overlay()).toHaveAttribute('role', 'status');
  });

  it('ignores drags that carry no files (text, tabs)', () => {
    render(<DropOverlay />);
    fireEvent.dragEnter(window, { dataTransfer: dt([], ['text/plain']) });
    fireEvent.dragOver(window, { dataTransfer: dt([], ['application/x-dbstudio-tab']) });
    expect(overlay()).toBeNull();
  });

  it('does not flicker: entering and leaving child elements keeps it, leaving the window hides it', () => {
    render(<DropOverlay />);
    act(() => void dragEnter()); // window
    act(() => void dragEnter()); // a child
    act(() => void dragLeave()); // left the first one
    expect(overlay()).toBeInTheDocument();
    act(() => void dragLeave()); // left the window
    expect(overlay()).toBeNull();
    // and a new drag starts afresh
    act(() => void dragEnter());
    expect(overlay()).toBeInTheDocument();
  });

  it('hides on Escape for the rest of the drag, and a drop afterwards imports nothing', () => {
    render(<DropOverlay />);
    act(() => void dragEnter());
    expect(overlay()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(overlay()).toBeNull();
    act(() => void dragOver());
    expect(overlay()).toBeNull(); // not brought back by the next dragover
    drop([file('a.csv')]);
    expect(wizards()).toHaveLength(0);
    // next drag works again
    act(() => void dragLeave());
    act(() => void dragEnter());
    expect(overlay()).toBeInTheDocument();
  });

  it('hides itself when the drag ends without an event (idle timer)', () => {
    vi.useFakeTimers();
    render(<DropOverlay />);
    act(() => void dragEnter());
    expect(overlay()).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(DRAG_IDLE_MS - 100));
    act(() => void dragOver()); // still dragging: the timer restarts
    act(() => void vi.advanceTimersByTime(DRAG_IDLE_MS - 100));
    expect(overlay()).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(overlay()).toBeNull();
  });

  it('hides when the window loses focus or the drag is cancelled', () => {
    render(<DropOverlay />);
    act(() => void dragEnter());
    fireEvent(window, new Event('blur'));
    expect(overlay()).toBeNull();
    act(() => void dragEnter());
    fireEvent(window, new Event('dragend'));
    expect(overlay()).toBeNull();
  });

  it('steps back over an item that takes the drop itself', () => {
    render(
      <div>
        <div data-testid="node" onDragOver={(e) => e.preventDefault()} />
        <DropOverlay />
      </div>,
    );
    act(() => void dragEnter());
    act(() => void dragOver([file('a.csv')], screen.getByTestId('node')));
    expect(overlay()).toHaveClass('node');
    expect(screen.getByText('Release to import into this item')).toBeInTheDocument();
    act(() => void dragOver());
    expect(overlay()).not.toHaveClass('node');
  });

  it('accepts the drag (copy) and never lets the browser open the file', () => {
    render(<DropOverlay />);
    expect(dragEnter()).toBe(true);
    const over = fireEvent.dragOver(window, { dataTransfer: dt([file('a.csv')]) });
    expect(over).toBe(false); // preventDefault: a drop is allowed here
    const dropped = drop([file('a.csv')]);
    expect(dropped).toBe(false);
  });
});

describe('dropping', () => {
  it('a data file opens the wizard with its path, on the active table (existing table mode)', () => {
    setTabs([dataTab('c1', 'dbo', 'orders')], 'data1');
    render(<DropOverlay />);
    act(() => void dragEnter());
    drop([file('people.csv')]);
    expect(overlay()).toBeNull();
    expect(wizards()).toHaveLength(1);
    expect(wizards()[0].connectionId).toBe('c1');
    expect(wizardState(wizards()[0])).toEqual({ path: 'C:\\drop\\people.csv', targetMode: 'existing', schema: 'dbo', table: 'orders' });
  });

  it('a data file opens a new-table wizard in the selected schema', () => {
    useExplorer.setState({ selectedTarget: { kind: 'container', connectionId: 'c2', database: 'wh', schema: 'public' } });
    render(<DropOverlay />);
    act(() => void dragEnter());
    drop([file('Sales 2024.xlsx')]);
    expect(wizardState(wizards()[0])).toEqual({ path: 'C:\\drop\\Sales 2024.xlsx', targetMode: 'new', schema: 'public', table: null });
    expect(wizards()[0].connectionId).toBe('c2');
  });

  it('opens the wizard without a connection when it cannot tell which one', () => {
    render(<DropOverlay />);
    drop([file('people.csv')]);
    expect(wizards()[0].connectionId).toBeNull();
    expect(wizardState(wizards()[0])).toMatchObject({ path: 'C:\\drop\\people.csv', targetMode: 'new', table: null });
  });

  it('opens one wizard per file, five at most, and says so', () => {
    setTabs([consoleTab('c1')], 'c1');
    render(<DropOverlay />);
    drop(Array.from({ length: 7 }, (_, i) => file(`f${i}.csv`)));
    expect(wizards()).toHaveLength(5);
    expect(wizards().map((w) => wizardState(w).path)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'].map((n) => `C:\\drop\\${n}.csv`));
    expect(useUi.getState().toasts.map((t) => t.text)).toContain('Opened 5 of 7 files');
  });

  it('three files open three wizards on the same destination', () => {
    setTabs([consoleTab('c1')], 'c1');
    render(<DropOverlay />);
    drop([file('a.csv'), file('b.json'), file('c.ndjson')]);
    expect(wizards()).toHaveLength(3);
    expect(new Set(wizards().map((w) => w.connectionId))).toEqual(new Set(['c1']));
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it('refuses other file types with a toast and opens nothing', () => {
    render(<DropOverlay />);
    drop([file('photo.png')]);
    expect(wizards()).toHaveLength(0);
    expect(consoles()).toHaveLength(0);
    const t = useUi.getState().toasts[0];
    expect(t.text).toBe('Unsupported file type: "photo.png"');
  });

  it('explains why an .xls workbook cannot be imported', () => {
    render(<DropOverlay />);
    drop([file('old.xls')]);
    const t = useUi.getState().toasts[0];
    expect(t.text).toContain('old.xls');
    expect(t.detail).toContain('.xlsx');
  });

  it('imports what it can and reports the rest in one toast', () => {
    setTabs([consoleTab('c1')], 'c1');
    render(<DropOverlay />);
    drop([file('a.csv'), file('b.png'), file('c.zip')]);
    expect(wizards()).toHaveLength(1);
    expect(useUi.getState().toasts).toHaveLength(1);
    expect(useUi.getState().toasts[0].text).toContain('Unsupported file types');
    expect(useUi.getState().toasts[0].detail).toContain('b.png, c.zip');
  });

  it('opens a .sql file in a new console, remembering its path', async () => {
    setTabs([consoleTab('c1')], 'c1');
    render(<DropOverlay />);
    drop([file('report.sql', 'select 42')]);
    await waitFor(() => expect(consoles()).toHaveLength(2));
    expect(wizards()).toHaveLength(0);
    const opened = consoles().find((t) => t.id !== 'c1');
    expect(opened).toMatchObject({ kind: 'console', text: 'select 42', filePath: 'C:\\drop\\report.sql', title: 'report.sql', connectionId: 'c1' });
  });

  it('opens a .sql file without a path (browser) under its name', async () => {
    render(<DropOverlay />);
    drop([file('nopath.sql', 'select 1')]);
    await waitFor(() => expect(consoles()).toHaveLength(1));
    expect(consoles()[0]).toMatchObject({ text: 'select 1', title: 'nopath.sql' });
  });

  it('handles .sql and data files dropped together', async () => {
    setTabs([consoleTab('c1')], 'c1');
    render(<DropOverlay />);
    drop([file('a.csv'), file('q.sql', 'select 2')]);
    expect(wizards()).toHaveLength(1);
    await waitFor(() => expect(consoles()).toHaveLength(2));
  });

  it('leaves a drop alone that an explorer node or the wizard drop zone took', () => {
    render(
      <div>
        <div data-testid="node" onDrop={(e) => e.preventDefault()} />
        <DropOverlay />
      </div>,
    );
    act(() => void dragEnter());
    drop([file('a.csv')], screen.getByTestId('node'));
    expect(wizards()).toHaveLength(0);
    expect(overlay()).toBeNull();
  });

  it('takes file drops over a code editor, which would swallow them', () => {
    const editorDrop = vi.fn();
    render(
      <div>
        <div className="monaco-editor" onDrop={editorDrop}><span data-testid="in-editor" /></div>
        <DropOverlay />
      </div>,
    );
    setTabs([consoleTab('c1')], 'c1');
    act(() => void dragEnter());
    expect(dragOver([file('a.csv')], screen.getByTestId('in-editor'))).toBe(false);
    drop([file('a.csv')], screen.getByTestId('in-editor'));
    expect(editorDrop).not.toHaveBeenCalled();
    expect(wizards()).toHaveLength(1);
  });

  it('ignores drops without files', () => {
    render(<DropOverlay />);
    fireEvent.drop(window, { dataTransfer: dt([], ['text/plain']) });
    expect(wizards()).toHaveLength(0);
    expect(useUi.getState().toasts).toHaveLength(0);
  });
});
