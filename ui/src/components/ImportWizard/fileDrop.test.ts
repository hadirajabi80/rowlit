import type { DragEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandTarget } from '../../commands/types';
import { setPlatform } from '../../platform';
import { createBrowserPlatform } from '../../platform/browser';
import { useConnections } from '../../store/connections';
import { useTabs, type ViewTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { dropContext, handleImportDrop, hasFiles, importDropHandlers, pathOfFile } from './fileDrop';
import { IMPORT_VIEW_ID, type ImportTabState } from './open';

const conn = (id: string, providerId: string, readOnly = false) => ({
  id, name: id, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

const table: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: { database: 'shop', schema: 'public', name: 'orders', type: 'table' } };
const schema: CommandTarget = { kind: 'container', connectionId: 'pg', database: 'shop', schema: 'public' };

const file = (name: string) => new File(['a,b'], name);
const dragEvent = (files: File[], types: string[] = ['Files']) => {
  const e = {
    dataTransfer: { types, files, dropEffect: 'none' },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as DragEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
};
const wizards = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === IMPORT_VIEW_ID);

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useUi.setState({ toasts: [] });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'postgresql'), conn('ro', 'postgresql', true), conn('rd', 'redis')] });
  setPlatform({ ...createBrowserPlatform(), getFilePath: (f: File) => (f.name === 'nopath.csv' ? null : `C:\\drop\\${f.name}`) });
});
afterEach(() => setPlatform(null));

describe('drop target', () => {
  it('accepts tables, schemas and connections of writable relational connections', () => {
    expect(dropContext(table)).toEqual({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders' });
    expect(dropContext(schema)).toEqual({ connectionId: 'pg', database: 'shop', schema: 'public', table: null });
    expect(dropContext({ kind: 'connection', connectionId: 'pg' })).toEqual({ connectionId: 'pg', database: null, schema: null, table: null });
  });
  it('refuses read-only, non-relational, views and queries', () => {
    expect(dropContext({ ...table, connectionId: 'ro' } as CommandTarget)).toBeNull();
    expect(dropContext({ ...schema, connectionId: 'rd' } as CommandTarget)).toBeNull();
    expect(dropContext({ kind: 'object', connectionId: 'pg', database: null, ref: { database: null, schema: 'public', name: 'v', type: 'view' } })).toBeNull();
    expect(dropContext({ ...schema, queries: true } as CommandTarget)).toBeNull();
    expect(dropContext(null)).toBeNull();
    expect(importDropHandlers({ kind: 'tab', tabId: 'x' })).toEqual({});
  });
});

describe('dropping files', () => {
  it('detects file drags only', () => {
    expect(hasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(hasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });

  it('accepts the drag over a valid node and ignores text drags', () => {
    const h = importDropHandlers(table);
    const over = dragEvent([]);
    h.onDragOver!(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('copy');
    const text = dragEvent([], ['text/plain']);
    h.onDragOver!(text);
    expect(text.preventDefault).not.toHaveBeenCalled();
    const dropText = dragEvent([], ['text/plain']);
    h.onDrop!(dropText);
    expect(wizards()).toHaveLength(0);
  });

  it('a file dropped on a table opens the wizard on that table with the path', () => {
    const e = dragEvent([file('people.csv')]);
    importDropHandlers(table).onDrop!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    const [w] = wizards();
    expect(w.connectionId).toBe('pg');
    expect(w.state as ImportTabState).toEqual({ path: 'C:\\drop\\people.csv', targetMode: 'existing', schema: 'public', table: 'orders' });
  });

  it('a file dropped on a schema opens the new-table mode', () => {
    importDropHandlers(schema).onDrop!(dragEvent([file('Sales.xlsx')]));
    expect(wizards()[0].state as ImportTabState).toEqual({ path: 'C:\\drop\\Sales.xlsx', targetMode: 'new', schema: 'public', table: null });
  });

  it('rejects other file types with a message', () => {
    expect(handleImportDrop([file('photo.png')], dropContext(schema)!)).toBe(false);
    expect(wizards()).toHaveLength(0);
    expect(useUi.getState().toasts[0].text).toContain('photo.png');
  });

  it('opens the wizard without a path when the location is unknown (browser)', () => {
    expect(handleImportDrop([file('nopath.csv')], dropContext(schema)!)).toBe(true);
    expect((wizards()[0].state as ImportTabState).path).toBeNull();
    expect(useUi.getState().toasts[0].text).toContain('Choose the file');
  });

  it('reads the path through the desktop bridge, else the legacy File.path', () => {
    expect(pathOfFile(file('a.csv'))).toBe('C:\\drop\\a.csv');
    setPlatform(createBrowserPlatform());
    expect(pathOfFile(file('a.csv'))).toBeNull();
    const legacy = Object.assign(file('b.csv'), { path: 'D:\\b.csv' });
    expect(pathOfFile(legacy)).toBe('D:\\b.csv');
  });
});
