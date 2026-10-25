import { ChevronDown, FolderTree } from 'lucide-react';
import { resolveScopeColor, scopeColorName, useScopeColors } from '../../lib/scopeColors';
import { useConsoleSchema, type ConsoleSchemaState } from '../../store/consoleSchema';
import type { ConsoleTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { connColorCss } from '../../theme/connColors';

/** What the pill says on hover: where unqualified names resolve, and what clicking does on this provider. */
function schemaPillTitle(s: Pick<ConsoleSchemaState, 'mode' | 'schema' | 'serverSchema' | 'override' | 'searchPath'>, colourName?: string | null): string {
  const colour = colourName ? ` (${colourName})` : '';
  if (s.mode === 'readOnly') {
    if (s.override) {
      return `Editor schema ${s.schema}${colour}: used for completion and diagnostics only. The server still resolves unqualified names to ${s.serverSchema ?? 'the login’s default schema'} — click to change.`;
    }
    return `${s.schema ? `Unqualified names resolve to ${s.schema}${colour}` : 'Schema'} — SQL Server uses the login’s default schema. Click to choose an editor schema for completion.`;
  }
  const path = s.searchPath && s.searchPath.length > 1 ? ` (search_path: ${s.searchPath.join(', ')})` : '';
  return `${s.schema ? `Unqualified names resolve to ${s.schema}${colour}` : 'Default schema'}${path} — click to change.`;
}

/** The console toolbar's schema indicator / switcher (SQL Server, PostgreSQL, Snowflake). Its list is a lazy chunk. */
export function SchemaPill({ tab }: { tab: ConsoleTab }) {
  const s = useConsoleSchema(tab);
  const map = useScopeColors();
  if (!s.enabled) return null;
  const hex = resolveScopeColor(map, tab.connectionId, s.catalogDb, s.schema);
  const css = connColorCss(hex ?? undefined);
  const label = s.schema ?? 'schema';
  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    useUi.getState().openSwitcher({ tabId: tab.id, mode: 'schema', anchor: { left: r.left, top: r.top, bottom: r.bottom } });
  };
  return (
    <button
      className={`db-pill schema-pill${css ? ' has-scope-color' : ''}${s.mode === 'readOnly' ? ' read-only' : ''}${s.override ? ' override' : ''}`}
      onClick={(e) => open(e.currentTarget)}
      title={schemaPillTitle(s, hex ? scopeColorName(hex) : null)}
      aria-label={`${s.mode === 'readOnly' ? 'Editor schema' : 'Schema'} ${s.schema ?? 'unknown'}${hex ? `, colour ${scopeColorName(hex)}` : ''}, change`}
      aria-haspopup="dialog"
      data-testid="schema-pill"
      style={css ? ({ ['--scope-color' as string]: css }) : undefined}
    >
      {css ? <span className="scope-dot" aria-hidden="true" /> : null}
      <FolderTree size={14} strokeWidth={1.5} aria-hidden="true" />
      <span className={s.schema ? undefined : 'muted'}>{label}</span>
      {s.override && <span className="schema-pill-tag">editor</span>}
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );
}
