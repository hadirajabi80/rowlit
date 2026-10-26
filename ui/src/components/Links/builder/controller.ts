// Registry of mounted query builder views (light: imported by commands.ts). The builder.* context menu commands and the
// builder-scoped shortcuts resolve the view they act on through it (args carry the tab id; else the active tab).
import type { BuilderJoinType } from '../../../api/links';
import { useTabs } from '../../../store/tabs';

export interface BuilderController {
  tabId: string;
  linkId: string;
  // canvas
  addTables(): void;
  autoLayout(): void;
  fit(): void;
  // tables
  selectAllColumns(tableId: string, on: boolean): void;
  removeTable(tableId: string): void;
  toggleCollapse(tableId: string): void;
  makeFrom(tableId: string): void;
  isFrom(tableId: string): boolean;
  isCollapsed(tableId: string): boolean;
  // columns
  toggleOutput(tableId: string, column: string): void;
  isOutput(tableId: string, column: string): boolean;
  filterOn(tableId: string, column: string): void;
  sortBy(tableId: string, column: string): void;
  joinFrom(tableId: string, column: string): void;
  // joins
  setJoinType(joinId: string, type: BuilderJoinType): void;
  joinType(joinId: string): BuilderJoinType | null;
  editJoin(joinId: string): void;
  removeJoin(joinId: string): void;
  // tab
  run(): void;
  cancel(): void;
  running(): boolean;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  saveView(): void;
  plan(): void;
  refreshSources(): void;
  toggleMode(): void;
  mode(): 'builder' | 'sql';
  openInConsole(): void;
}

const controllers = new Map<string, BuilderController>();

export function registerBuilder(c: BuilderController): () => void {
  controllers.set(c.tabId, c);
  return () => {
    if (controllers.get(c.tabId) === c) controllers.delete(c.tabId);
  };
}

/** Arguments of the builder.* menu commands. */
export interface BuilderArgs {
  tabId: string;
  tableId?: string;
  column?: string;
  joinId?: string;
}

export function isBuilderArgs(a: unknown): a is BuilderArgs {
  return !!a && typeof a === 'object' && typeof (a as BuilderArgs).tabId === 'string';
}

/** The controller of `args.tabId`, else of the active tab. */
export function builderOf(args?: unknown): BuilderController | null {
  if (isBuilderArgs(args)) return controllers.get(args.tabId) ?? null;
  const id = useTabs.getState().activeId;
  return id ? controllers.get(id) ?? null : null;
}
