// Schema / database colours (auto-loaded by commands/index.ts):
//   scope.setColor  "Set colour…" on a schema or database node (explorer menu, palette): the connection palette + "No colour"
// Target: a schema / database container from a menu, else the explorer selection (an object → its schema), else the
// active console's schema.
import { targetOf } from '../../commands/core';
import { registerCommands, type Command } from '../../commands/registry';
import { isContainerTarget, isObjectTarget } from '../../commands/types';
import type { ScopeRef } from '../../lib/scopeColors';
import { tabScopeRef } from '../../lib/tabScope';
import { getActiveConsole } from '../../store/tabs';
import { getConnection, providerKind } from '../../store/connections';
import { useScopeColorDialog } from './dialogStore';

function isRelational(connectionId: string | null | undefined): connectionId is string {
  const c = connectionId ? getConnection(connectionId) : undefined;
  return !!c && providerKind(c.providerId) === 'relational';
}

/** The database / schema a "Set colour…" acts on, null when there is none (a type folder, a non-SQL connection). */
export function scopeTargetOf(args: unknown): ScopeRef | null {
  const hasArgs = !!args && typeof args === 'object' && 'kind' in args;
  const t = targetOf(args);
  if (t && isContainerTarget(t)) {
    if (t.objectType || t.queries) return null; // a type folder / Queries folder: colour its schema's node instead
    if (!isRelational(t.connectionId)) return null;
    return { connectionId: t.connectionId, database: t.database, schema: t.schema };
  }
  if (t && isObjectTarget(t) && t.ref.schema && isRelational(t.connectionId)) return { connectionId: t.connectionId, database: t.database, schema: t.ref.schema };
  if (hasArgs) return null; // a menu of some other node
  const tab = getActiveConsole();
  const ref = tab ? tabScopeRef(tab) : null;
  return ref && isRelational(ref.connectionId) && (ref.schema || ref.database) ? ref : null;
}

export const SCOPE_COLOR_COMMANDS: Command<never>[] = [
  {
    id: 'scope.setColor', title: 'Set colour of schema or database…', category: 'Database', icon: 'Palette',
    keywords: 'color colour tag schema database mark highlight',
    when: (a?: unknown) => !!scopeTargetOf(a),
    run: (a?: unknown) => {
      const ref = scopeTargetOf(a);
      if (ref) useScopeColorDialog.getState().open(ref);
    },
  },
];

export function registerScopeColorCommands(): void {
  registerCommands(SCOPE_COLOR_COMMANDS);
}
