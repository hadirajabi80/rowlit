// F12 / Ctrl+click in a console: a table, view or synonym opens its DATA, a routine its definition (the "Edit:" console
// with "Open procedures and functions in edit mode" on, else the object tab); "Open definition (DDL)" (Alt+F12) always
// opens the object tab; a name that was not there once its schema had loaded says so.
import { render, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogObjectType, ObjectRef } from '../../api/types';
import type { SqlEditorProps } from '../../editor/SqlEditor.types';
import { initCommands } from '../../commands';
import { peekEditSession } from '../../designer/editSession';
import { useDesignerUi } from '../../designer/store';
import { useConnections } from '../../store/connections';
import { DEFAULT_SETTINGS, OPEN_ROUTINES_IN_EDIT_KEY, useSettings } from '../../store/settings';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { installMockEngine } from '../../test/mockServer';
import { DATA_VIEW } from '../DataTab/open';
import { ConsoleView } from './ConsoleView';

let editorProps: SqlEditorProps | null = null;
vi.mock('../../editor/SqlEditor', () => ({
  SqlEditor: forwardRef(function SqlEditorStub(props: SqlEditorProps) {
    editorProps = props;
    return <div data-testid="sql-editor" />;
  }),
}));

installMockEngine({ frameDelay: 0 });
beforeAll(() => initCommands(), 60_000);

const tab: ConsoleTab = {
  kind: 'console', id: 't1', title: 'Console', connectionId: 'c_prod', database: 'Shop', text: 'SELECT * FROM Sales.Customers', savedText: '', filePath: null, txMode: 'auto', maxRows: null,
};
const ref = (name: string, type: CatalogObjectType, schema = 'Sales'): ObjectRef => ({ database: 'Shop', schema, name, type });
const others = () => useTabs.getState().tabs.filter((t) => t.id !== 't1');
const dataTabs = () => others().filter((t) => t.kind === 'view' && t.view === DATA_VIEW);
const objectTabs = () => others().filter((t) => t.kind === 'object');
const editConsoles = () => others().filter((t) => t.kind === 'console' && peekEditSession(t.id));

function setEditMode(on: boolean) {
  const s = useSettings.getState().settings;
  useSettings.setState({ settings: { ...s, ui: { ...s.ui, [OPEN_ROUTINES_IN_EDIT_KEY]: on } } });
}

beforeEach(async () => {
  editorProps = null;
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useUi.setState({ toasts: [] });
  useDesignerUi.setState({ edits: {} });
  useTabs.setState({ tabs: [tab], activeId: 't1', seq: 1, mru: [], closed: [] });
  await useConnections.getState().load();
  render(<ConsoleView tab={tab} theme="light" visible />);
});

describe('go to definition from a console', () => {
  it.each<[CatalogObjectType]>([['table'], ['view'], ['mview'], ['synonym']])('a %s opens its data, not the DDL', (type) => {
    editorProps!.onOpenObject!(ref('Customers', type));
    expect(dataTabs()).toHaveLength(1);
    expect(objectTabs()).toHaveLength(0);
  });

  it('a procedure opens its object tab, or its "Edit:" console with edit mode on', async () => {
    editorProps!.onOpenObject!(ref('CloseInvoice', 'proc'));
    expect(dataTabs()).toHaveLength(0);
    expect(objectTabs()).toHaveLength(1);

    useTabs.setState({ tabs: [tab], activeId: 't1' });
    setEditMode(true);
    editorProps!.onOpenObject!(ref('CloseInvoice', 'proc'));
    await waitFor(() => expect(editConsoles()).toHaveLength(1));
    expect(objectTabs()).toHaveLength(0);
  });

  it('a column of a table opens the structure on that column', () => {
    editorProps!.onOpenObject!(ref('Customers', 'table'), 'Email');
    expect(dataTabs()).toHaveLength(0);
    expect(objectTabs()).toHaveLength(1);
  });

  it('"Open definition (DDL)" opens the object tab of a table and of a procedure, edit mode or not', async () => {
    setEditMode(true);
    editorProps!.onOpenObjectDdl!(ref('Customers', 'table'));
    editorProps!.onOpenObjectDdl!(ref('CloseInvoice', 'proc', 'Sales'));
    expect(dataTabs()).toHaveLength(0);
    expect(editConsoles()).toHaveLength(0);
    expect(objectTabs()).toHaveLength(2);
  });

  it('a name its schema did not have says so; a timeout says the schema did not finish loading', () => {
    editorProps!.onDefinitionMissing!('Sales.Nope', false);
    editorProps!.onDefinitionMissing!('Sales.Slow', true);
    const t = useUi.getState().toasts;
    expect(t.map((x) => x.text)).toEqual(['Sales.Nope was not found', 'Sales.Slow was not found']);
    expect(t[0].kind).toBe('info');
    expect(t[1].kind).toBe('warning');
  });
});
