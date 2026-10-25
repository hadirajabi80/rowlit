// Schema / database colours: a colour tag per schema (and per database of two-level providers), kept next to the
// connection colour. Stored in the free-form `settings.ui.scopeColors` map (engine-side, so every window and restart
// sees it): "<connectionId>\u0001<database>\u0001<schema>" → a palette hex (theme/connColors.ts). A database colour has an
// empty schema part. A schema inherits its database's colour when it has none of its own.
import { useSettings } from '../store/settings';
import { connColorCss, connColorName } from '../theme/connColors';

export const SCOPE_COLORS_KEY = 'scopeColors';

export type ScopeColors = Readonly<Record<string, string>>;

const EMPTY: ScopeColors = Object.freeze({});

/** Where a colour lives: a database (`schema` null) or a schema. */
export interface ScopeRef {
  connectionId: string;
  database: string | null;
  schema: string | null;
}

export function scopeColorKey(connectionId: string, database: string | null | undefined, schema: string | null | undefined): string {
  return `${connectionId}\u0001${database ?? ''}\u0001${schema ?? ''}`;
}

/** The stored map of a settings `ui` bag (anything that is not a string → string map is ignored). */
export function readScopeColors(ui: Record<string, unknown> | undefined): ScopeColors {
  const raw = ui?.[SCOPE_COLORS_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ScopeColors) : EMPTY;
}

/** The colour of a schema, else of its database; null when neither has one. */
export function resolveScopeColor(map: ScopeColors, connectionId: string | null | undefined, database: string | null | undefined, schema: string | null | undefined): string | null {
  if (!connectionId) return null;
  if (schema) {
    const own = map[scopeColorKey(connectionId, database, schema)];
    if (own) return own;
  }
  return map[scopeColorKey(connectionId, database, null)] ?? null;
}

/** The colour set on exactly this node (no inheritance). */
export function ownScopeColor(map: ScopeColors, ref: ScopeRef): string | null {
  return map[scopeColorKey(ref.connectionId, ref.database, ref.schema)] ?? null;
}

/** Reactive map of all scope colours. */
export function useScopeColors(): ScopeColors {
  return useSettings((s) => readScopeColors(s.settings.ui));
}

/** Reactive colour of a schema / database (inherited from the database when the schema has none). */
export function useScopeColor(connectionId: string | null | undefined, database: string | null | undefined, schema: string | null | undefined): string | null {
  return useSettings((s) => resolveScopeColor(readScopeColors(s.settings.ui), connectionId, database, schema));
}

/** Sets (or, with null, clears) the colour of a database / schema. */
export function setScopeColor(ref: ScopeRef, color: string | null): void {
  const all = readScopeColors(useSettings.getState().settings.ui);
  const key = scopeColorKey(ref.connectionId, ref.database, ref.schema);
  const next: Record<string, string> = { ...all };
  if (color) next[key] = color;
  else delete next[key];
  useSettings.getState().update({ ui: { [SCOPE_COLORS_KEY]: next } });
}

/** CSS value of a scope colour (a theme token for palette colours), undefined without one. */
export const scopeColorCss = connColorCss;

/** "Green" for tooltips and screen readers (colour is never the only cue). */
export function scopeColorName(color: string | null | undefined): string | null {
  return connColorName(color);
}

/** "Schema colour: Green" / "Database colour: Green" for titles and aria-labels. */
export function scopeColorLabel(color: string | null | undefined, level: 'schema' | 'database'): string | null {
  const name = scopeColorName(color);
  return name ? `${level === 'schema' ? 'Schema' : 'Database'} colour: ${name}` : null;
}
