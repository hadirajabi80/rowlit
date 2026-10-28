// Schema compare commands (auto-loaded by commands/index.ts). Kept tiny: the view itself is a lazy chunk (./views.tsx).
//   schemaCompare.open  "Compare schema…"  explorer database / schema / connection (source pre-filled), the active tab's
//                                          connection, or the palette / Database menu with empty pickers
import { extendContextMenu } from '../../commands/menuModel';
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { compareSourceOf, openSchemaCompare, SCHEMA_COMPARE_VIEW_ID } from './open';
import { SchemaCompareTab } from './views';

const KEYWORDS = 'schema compare diff structure synchronization sync migration script ddl datagrip navicat';

export const SCHEMA_COMPARE_COMMANDS: Command<never>[] = [
  {
    id: 'schemaCompare.open', title: 'Compare schema…', category: 'Database', icon: 'GitCompare', keywords: KEYWORDS,
    // From an explorer node: only relational ones (a Redis key or a Kafka topic has no schema). Elsewhere: always.
    when: (args?: unknown) => !(args && typeof args === 'object' && 'kind' in args) || !!compareSourceOf(args),
    run: (args?: unknown) => {
      openSchemaCompare(compareSourceOf(args));
    },
  },
];

let registered = false;

export function registerSchemaCompareCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(SCHEMA_COMPARE_VIEW_ID, { component: SchemaCompareTab, icon: 'GitCompare' });
  registerCommands(SCHEMA_COMPARE_COMMANDS);
  const entry = { command: 'schemaCompare.open', optional: true, hideDisabled: true };
  extendContextMenu('explorer.container', [entry]);
  extendContextMenu('explorer.connection', [entry]);
}
