// Linked databases (plan-links): the links package's commands, auto-loaded by commands/index.ts as its own lazy chunk.
// Owned by WP-C (link editor + query builder), except the LINKS-WPD block (WP-D: materialize, native links, palette
// entries). Everything heavy (the editor dialog, the builder view, the links REST client) loads on first use.
//
// Ids (the shell and docs/wp-notes/links/wp0.md refer to them):
//   links.new {folder?, connectAfter?, members?, addTables?}   new link editor          (Welcome, connection dialog, Ctrl+P)
//   links.edit {connectionId, addTables?}            edit a link              (connection dialog host, explorer)
//   links.duplicate {connectionId}                   duplicate a link
//   links.builder {connectionId}                     open the query builder tab (view 'links.builder')
//   links.addTable                                   "Add to link…" (WP-D: explorer tables / views, Objects tab)
//   links.builderAddTable (ObjectTarget of a link table)                          put it on the builder canvas
//   links.removeTable (ObjectTarget of a link table)                              unmount it from the link
//   links.openView (SavedQueryTarget of a link)                                   a linked view in the builder
//   links.refreshSources {connectionId}              drop the cached source rows (next run fetches again)
//   links.plan                                       push-down plan of the builder's query
//   links.materialize / links.nativeLink             wizards (WP-D)
// In the builder (scope 'builder'): Mod+Z / Mod+Shift+Z (Mod+Y) undo / redo · Mod+Alt+Q switch between the builder and SQL (Advanced);
// the view itself handles Mod+Enter (run), Shift+F5 / Esc (cancel) and Mod+S (save as linked view), which the console's
// global commands own elsewhere. Menus: explorer.link,
// explorer.linkTable (commands/menuModel.ts LINK_MENU_IDS) and builder.canvas|table|column|join (api/links.ts).
import { errorMessage } from '../../api/client';
import type { LinkMember } from '../../api/links';
import { objectTargetOf, targetOf } from '../../commands/core';
import { extendContextMenu, registerContextMenu, type ContextEntry } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { isSavedQueryTarget, type ObjectTarget } from '../../commands/types';
import { getConnection } from '../../store/connections';
import { useUi, toast } from '../../store/ui';
import { registerTabView } from '../layout/tabViews';
import { builderOf, isBuilderArgs, type BuilderArgs, type BuilderController } from './builder/controller';
import { BuilderTab, disposeBuilderTab } from './builder/views';
import { openLinkEditor, type LinkEditorTable } from './editor/open';
import { isLink, LINK_BUILDER_VIEW, linkConnections, linkIdOf, openBuilder } from './open';
// LINKS-WPD begin (imports)
import { registerMaterializeCommands } from './materialize/commands';
import { registerNativeLinkCommands } from './native/commands';
// LINKS-WPD end

const BUILDER = 'Query builder';

const linkTableTarget = (args: unknown): ObjectTarget | null => {
  const t = objectTargetOf(args);
  return t && isLink(t.connectionId) && (t.ref.type === 'table' || t.ref.type === 'view') ? t : null;
};

function editorArgs(args: unknown): { folder: string | null; connectAfter: boolean; addTables: LinkEditorTable[]; members: LinkMember[] } {
  const a = (args && typeof args === 'object' ? args : {}) as { folder?: string | null; connectAfter?: boolean; addTables?: LinkEditorTable[]; members?: LinkMember[] };
  return {
    folder: a.folder ?? null, connectAfter: a.connectAfter ?? true, addTables: Array.isArray(a.addTables) ? a.addTables : [],
    members: Array.isArray(a.members) ? a.members : [],
  };
}

const fail = (what: string) => (e: unknown) => toast('error', what, errorMessage(e));

/** A builder command acting on the view of `args.tabId` (menus) or the active tab (shortcuts, palette). */
const b = (id: string, title: string, icon: string, run: (c: BuilderController, a: Partial<BuilderArgs>) => unknown,
  extra: Partial<Command<never>> & { enabled?: (c: BuilderController, a: Partial<BuilderArgs>) => boolean } = {}): Command<never> => {
  const { enabled, ...rest } = extra;
  const argsOf = (x: unknown) => (isBuilderArgs(x) ? x : {});
  return {
    id, title, category: BUILDER, icon, palette: false,
    when: (x?: unknown) => {
      const c = builderOf(x);
      return !!c && (!enabled || enabled(c, argsOf(x)));
    },
    run: (x?: unknown) => {
      const c = builderOf(x);
      if (c) return run(c, argsOf(x));
    },
    ...rest,
  };
};

const tableArg = (a: Partial<BuilderArgs>) => a.tableId ?? '';
const colArg = (a: Partial<BuilderArgs>) => a.column ?? '';

/** Focus is in a text field or an editor: Mod+Z belongs to it, not to the builder's history. */
function typingTarget(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable || !!el.closest?.('.monaco-editor'));
}

export const LINK_COMMANDS: Command<never>[] = [
  {
    id: 'links.new', title: 'New linked database…', category: 'File', icon: 'Link',
    keywords: 'link federated join across connections cross database query builder',
    run: (args?: unknown) => {
      const a = editorArgs(args);
      void openLinkEditor({ mode: 'new', folder: a.folder, connectAfter: a.connectAfter, addTables: a.addTables, members: a.members }).catch(fail('Could not open the link editor'));
    },
  },
  {
    id: 'links.edit', title: 'Edit linked database…', category: 'Database', icon: 'Pencil',
    when: (args?: unknown) => !!linkIdOf(args),
    run: (args?: unknown) => {
      const id = linkIdOf(args);
      if (id) void openLinkEditor({ mode: 'edit', connectionId: id, addTables: editorArgs(args).addTables }).catch(fail('Could not open the link editor'));
    },
  },
  {
    id: 'links.duplicate', title: 'Duplicate linked database', category: 'Database', icon: 'Copy', palette: false,
    when: (args?: unknown) => !!linkIdOf(args),
    run: (args?: unknown) => {
      const id = linkIdOf(args);
      if (id) void openLinkEditor({ mode: 'duplicate', connectionId: id }).catch(fail('Could not open the link editor'));
    },
  },
  {
    id: 'links.builder', title: 'Open query builder', category: 'Database', icon: 'Workflow',
    keywords: 'visual query designer join tables linked database no sql drag',
    when: (args?: unknown) => !!linkIdOf(args, { fallbackToOnly: true }),
    run: (args?: unknown) => {
      const id = linkIdOf(args, { fallbackToOnly: true });
      if (id) openBuilder(id);
    },
  },
  {
    id: 'links.builderAddTable', title: 'Add to query builder', category: BUILDER, icon: 'Plus', palette: false,
    when: (args?: unknown) => !!linkTableTarget(args),
    run: (args?: unknown) => {
      const t = linkTableTarget(args);
      if (!t) return;
      const refs = t.refs?.length ? t.refs : [t.ref];
      openBuilder(t.connectionId, { addTables: refs.filter((r) => r.schema).map((r) => ({ alias: r.schema!, table: r.name })) });
    },
  },
  {
    id: 'links.removeTable', title: 'Remove from linked database…', category: 'Database', icon: 'Trash2', palette: false,
    when: (args?: unknown) => !!linkTableTarget(args),
    run: async (args?: unknown) => {
      const t = linkTableTarget(args);
      if (!t || !t.ref.schema) return;
      const ok = await useUi.getState().askConfirm({
        title: 'Remove table from the link?',
        message: `${t.ref.schema}.${t.ref.name} is no longer part of “${getConnection(t.connectionId)?.name ?? 'the link'}”. The source table itself is not changed.`,
        confirmLabel: 'Remove',
      });
      if (!ok) return;
      const { unmountTable } = await import('./editor/save');
      await unmountTable(t.connectionId, t.ref.schema, t.ref.name).catch(fail('Could not update the link'));
    },
  },
  {
    id: 'links.openView', title: 'Open in query builder', category: BUILDER, icon: 'Workflow', palette: false,
    when: (args?: unknown) => {
      const t = targetOf(args);
      return isSavedQueryTarget(t) && isLink(t.connectionId);
    },
    run: async (args?: unknown) => {
      const t = targetOf(args);
      if (!isSavedQueryTarget(t)) return;
      const { useLinks } = await import('../../store/links');
      const views = await useLinks.getState().loadViews(t.connectionId, true);
      const v = views.find((x) => x.id === t.id) ?? views.find((x) => x.name === t.name);
      if (!v) {
        toast('warning', `“${t.name}” is not a linked view`, 'It opens in a console instead.');
        return;
      }
      openBuilder(t.connectionId, { view: { id: v.id, name: v.name, sql: v.sql, builder: v.builder } });
    },
  },
  {
    id: 'links.refreshSources', title: 'Refresh sources', category: 'Database', icon: 'RefreshCw',
    keywords: 'linked database cache fetch again stale',
    when: (args?: unknown) => !!linkIdOf(args),
    run: async (args?: unknown) => {
      const id = linkIdOf(args);
      if (!id) return;
      const c = builderOf(args);
      if (c && c.linkId === id) return c.refreshSources();
      const { refreshSources } = await import('./builder/actions');
      await refreshSources(id, null);
    },
  },
  {
    id: 'links.plan', title: 'Show push-down plan', category: BUILDER, icon: 'Network', keywords: 'linked database fetch sources plan explain',
    when: () => !!builderOf(),
    run: () => builderOf()?.plan(),
  },

  // ---- builder tab (scope 'builder': the view root carries data-command-scope="builder")
  b('links.run', 'Run query', 'Play', (c) => c.run(), { enabled: (c) => !c.running() }),
  b('links.cancel', 'Cancel query', 'CircleStop', (c) => c.cancel(), { enabled: (c) => c.running() }),
  b('links.undo', 'Undo', 'Undo2', (c) => c.undo(), { shortcut: 'Mod+Z', scope: 'builder', enabled: (c) => c.canUndo() && !typingTarget() }),
  b('links.redo', 'Redo', 'Redo2', (c) => c.redo(), { shortcut: 'Mod+Shift+Z', altShortcuts: ['Mod+Y'], scope: 'builder', enabled: (c) => c.canRedo() && !typingTarget() }),
  b('links.saveView', 'Save as linked view…', 'Save', (c) => c.saveView()),
  b('links.toggleSql', 'Switch between builder and SQL', 'Code', (c) => c.toggleMode(), { shortcut: 'Mod+Alt+Q', scope: 'builder' }),
  b('links.openInConsole', 'Open SQL in a console', 'SquareTerminal', (c) => c.openInConsole()),

  // ---- builder menus (args: BuilderArgs)
  b('builder.addTable', 'Add tables…', 'Plus', (c) => c.addTables()),
  b('builder.autoLayout', 'Auto layout', 'Network', (c) => c.autoLayout()),
  b('builder.fit', 'Fit to view', 'Maximize2', (c) => c.fit()),
  b('builder.selectAll', 'Select all columns', 'ListChecks', (c, a) => c.selectAllColumns(tableArg(a), true), { enabled: (_c, a) => !!a.tableId }),
  b('builder.selectNone', 'Clear column selection', 'Eraser', (c, a) => c.selectAllColumns(tableArg(a), false), { enabled: (_c, a) => !!a.tableId }),
  b('builder.collapse', 'Collapse / expand', 'ChevronsDownUp', (c, a) => c.toggleCollapse(tableArg(a)), { enabled: (_c, a) => !!a.tableId }),
  b('builder.makeFrom', 'Use as FROM table', 'ArrowRightLeft', (c, a) => c.makeFrom(tableArg(a)), { enabled: (c, a) => !!a.tableId && !c.isFrom(tableArg(a)) }),
  b('builder.removeTable', 'Remove from query', 'Trash2', (c, a) => c.removeTable(tableArg(a)), { enabled: (_c, a) => !!a.tableId }),
  b('builder.addToOutput', 'Show in results', 'Columns3', (c, a) => c.toggleOutput(tableArg(a), colArg(a)), { enabled: (c, a) => !!a.column && !c.isOutput(tableArg(a), colArg(a)) }),
  b('builder.removeFromOutput', 'Hide from results', 'Eye', (c, a) => c.toggleOutput(tableArg(a), colArg(a)), { enabled: (c, a) => !!a.column && c.isOutput(tableArg(a), colArg(a)) }),
  b('builder.filterOn', 'Filter on this column…', 'Funnel', (c, a) => c.filterOn(tableArg(a), colArg(a)), { enabled: (_c, a) => !!a.column }),
  b('builder.sortBy', 'Sort by this column', 'ArrowRightLeft', (c, a) => c.sortBy(tableArg(a), colArg(a)), { enabled: (_c, a) => !!a.column }),
  b('builder.joinFrom', 'Join to another table…', 'Link', (c, a) => c.joinFrom(tableArg(a), colArg(a)), { enabled: (_c, a) => !!a.tableId }),
  b('builder.joinInner', 'Inner join', 'Link', (c, a) => c.setJoinType(a.joinId ?? '', 'inner'), { enabled: (c, a) => !!a.joinId && c.joinType(a.joinId) !== 'inner' }),
  b('builder.joinLeft', 'Left outer join', 'Link', (c, a) => c.setJoinType(a.joinId ?? '', 'left'), { enabled: (c, a) => !!a.joinId && c.joinType(a.joinId) !== 'left' }),
  b('builder.joinRight', 'Right outer join', 'Link', (c, a) => c.setJoinType(a.joinId ?? '', 'right'), { enabled: (c, a) => !!a.joinId && c.joinType(a.joinId) !== 'right' }),
  b('builder.joinFull', 'Full outer join', 'Link', (c, a) => c.setJoinType(a.joinId ?? '', 'full'), { enabled: (c, a) => !!a.joinId && c.joinType(a.joinId) !== 'full' }),
  b('builder.joinCross', 'Cross join', 'Link', (c, a) => c.setJoinType(a.joinId ?? '', 'cross'), { enabled: (c, a) => !!a.joinId && c.joinType(a.joinId) !== 'cross' }),
  b('builder.editJoin', 'Edit join conditions…', 'Pencil', (c, a) => c.editJoin(a.joinId ?? ''), { enabled: (_c, a) => !!a.joinId }),
  b('builder.removeJoin', 'Remove join', 'Trash2', (c, a) => c.removeJoin(a.joinId ?? ''), { enabled: (_c, a) => !!a.joinId }),
];

const c = (command: string, extra: Partial<Extract<ContextEntry, { command: string }>> = {}): ContextEntry => ({ command, ...extra });
const h = (command: string): ContextEntry => ({ command, hideDisabled: true });
const o = (command: string): ContextEntry => ({ command, optional: true, hideDisabled: true });

/** A link's connection row. WP-D appends its entries (Create native link…) with extendContextMenu. */
export const LINK_MENU: ContextEntry[] = [
  c('links.builder'), c('connections.openConsole'), 'separator',
  c('links.edit'), c('links.duplicate'), 'separator',
  c('links.refreshSources'), c('connections.refreshCatalog'), h('connections.disconnect'), c('explorer.copyName'), 'separator',
  c('connections.delete'),
];

/** A mounted table / view of a link (and its columns). */
export const LINK_TABLE_MENU: ContextEntry[] = [
  c('links.builderAddTable'), c('explorer.selectTop'), o('data.open'), 'separator',
  c('explorer.copyName'), c('explorer.copyQualifiedName'), o('codegen.open'), 'separator',
  c('links.refreshSources'), c('connections.openConsole'), 'separator',
  h('links.removeTable'),
];

export const BUILDER_CANVAS_MENU: ContextEntry[] = [c('builder.addTable'), 'separator', c('builder.autoLayout'), c('builder.fit'), 'separator', c('links.toggleSql'), c('links.openInConsole')];
export const BUILDER_TABLE_MENU: ContextEntry[] = [
  c('builder.selectAll'), c('builder.selectNone'), c('builder.joinFrom'), 'separator', h('builder.makeFrom'), c('builder.collapse'), 'separator', c('builder.removeTable'),
];
export const BUILDER_COLUMN_MENU: ContextEntry[] = [
  h('builder.addToOutput'), h('builder.removeFromOutput'), c('builder.filterOn'), c('builder.sortBy'), c('builder.joinFrom'),
];
export const BUILDER_JOIN_MENU: ContextEntry[] = [
  h('builder.joinInner'), h('builder.joinLeft'), h('builder.joinRight'), h('builder.joinFull'), h('builder.joinCross'), 'separator', c('builder.editJoin'), c('builder.removeJoin'),
];

let registered = false;

export function registerLinksCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(LINK_BUILDER_VIEW, { component: BuilderTab, icon: 'Workflow', detachable: false, onClosed: disposeBuilderTab });
  registerCommands(LINK_COMMANDS);
  registerContextMenu('explorer.link', LINK_MENU);
  registerContextMenu('explorer.linkTable', LINK_TABLE_MENU);
  registerContextMenu('builder.canvas', BUILDER_CANVAS_MENU);
  registerContextMenu('builder.table', BUILDER_TABLE_MENU);
  registerContextMenu('builder.column', BUILDER_COLUMN_MENU);
  registerContextMenu('builder.join', BUILDER_JOIN_MENU);
  extendContextMenu('explorer.savedQuery', [o('links.openView')]);
  // LINKS-WPD begin
  registerMaterializeCommands();
  registerNativeLinkCommands();
  // LINKS-WPD end
}

/** Links currently defined (tests, palette). */
export const linksCount = () => linkConnections().length;
