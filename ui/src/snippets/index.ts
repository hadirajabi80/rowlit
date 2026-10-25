// Snippets and live templates (PLAN-M1.5 A4): built-ins per dialect plus user snippets from Settings.snippets.
// Surfaced through the completer (statement start, kind `snippet`, ranked below exact keyword matches), through
// Ctrl+J "Insert snippet…" (snippets only, anywhere, grouped by category) and as postfix templates (`Customers.sel`,
// intel/complete/postfix). Pure TypeScript: no React, Monaco or DOM.
//
// The built-in library is large and lives in ./data/<dialect>.ts, loaded on demand per dialect (ensureBuiltins); the
// completer source starts that load as soon as it is created.
import type { Dialect, Snippet } from '../api/types';
import type { CompletionItem, CursorContext, CompleteEnv, ExtraCompletionSource } from '../intel';
import { matchScore, sortTextFor } from '../intel';
import {
  CATEGORY_LABELS, SNIPPET_CATEGORIES, builtinsReady, ensureBuiltins, loadAllBuiltins, loadedBuiltins,
  type SnippetCategory, type SnippetDef,
} from './builtins';

export { CATEGORY_LABELS, SNIPPET_CATEGORIES, builtinsReady, ensureBuiltins, loadAllBuiltins, loadedBuiltins, type SnippetCategory, type SnippetDef };

/**
 * Built-ins for a dialect overlaid with the user's snippets (a user snippet replaces a built-in with its prefix). The
 * built-ins load on demand (ensureBuiltins); until then only the user's snippets (and the dialect spec's own) are offered.
 */
export function snippetsFor(dialect: Dialect, user: readonly Snippet[] | null | undefined): SnippetDef[] {
  const applies = (s: { dialects: Dialect[] | null }) => !s.dialects || s.dialects.length === 0 || s.dialects.includes(dialect);
  const mine = (user ?? []).filter((s) => applies(s) && isValidSnippet(s)).map((s): SnippetDef => ({ ...s, builtin: false }));
  const taken = new Set(mine.map((s) => s.prefix.toLowerCase()));
  return [...mine, ...loadedBuiltins(dialect).filter((s) => applies(s) && !taken.has(s.prefix.toLowerCase()))];
}

export interface SnippetProblem { field: 'name' | 'prefix' | 'body'; message: string }

/** True when the backslash at `i` escapes the next character (Monaco: only `$`, `}` and `\`). */
function escapes(body: string, i: number): boolean {
  return body[i] === '\\' && i + 1 < body.length && '$}\\'.includes(body[i + 1]);
}

/** Number of `${…}` placeholders still open at the end of the body (0 = balanced). */
export function unclosedPlaceholders(body: string): number {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (escapes(body, i)) { i++; continue; }
    const ch = body[i];
    if (ch === '$' && body[i + 1] === '{') { depth++; i++; } else if (ch === '}' && depth > 0) depth--;
  }
  return depth;
}

/** Validation used by the settings editor (and to ignore broken persisted entries). */
export function validateSnippet(s: Pick<Snippet, 'name' | 'prefix' | 'body'>, others: readonly Pick<Snippet, 'prefix' | 'dialects'>[] = []): SnippetProblem[] {
  const out: SnippetProblem[] = [];
  if (!s.name.trim()) out.push({ field: 'name', message: 'Give the snippet a name.' });
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s.prefix)) out.push({ field: 'prefix', message: 'Prefix: letters, digits, _ . - (no spaces), starting with a letter.' });
  else if (others.some((o) => o.prefix.toLowerCase() === s.prefix.toLowerCase())) out.push({ field: 'prefix', message: `Another snippet already uses "${s.prefix}".` });
  if (!s.body.trim()) out.push({ field: 'body', message: 'The body is empty.' });
  else if (unclosedPlaceholders(s.body) > 0) out.push({ field: 'body', message: 'A ${…} placeholder is not closed.' });
  return out;
}

export function isValidSnippet(s: Pick<Snippet, 'name' | 'prefix' | 'body'>): boolean {
  return validateSnippet(s).length === 0;
}

/**
 * Plain-text preview of a snippet body (what Monaco inserts): placeholders replaced by their defaults, tab stops removed.
 * A backslash only escapes `$`, `}` and `\`; a `}` outside a placeholder is plain text.
 */
export function snippetPreview(body: string): string {
  // a mirror (`$2`, `${2}`) shows the default of the placeholder with that number, as Monaco does on insert
  const defaults = new Map<string, string>();
  for (const m of body.matchAll(/\$\{(\d+):((?:[^}\\]|\\.)*)\}/g)) {
    if (m[1] !== '0' && !defaults.has(m[1])) defaults.set(m[1], m[2].replace(/\\([$}\\])/g, '$1'));
  }
  let out = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (escapes(body, i)) { out += body[++i]; continue; }
    const ch = body[i];
    if (ch === '$') {
      const rest = body.slice(i);
      const m = /^\$(\d+)/.exec(rest) ?? /^\$\{(\d+)\}/.exec(rest);
      if (m) { out += defaults.get(m[1]) ?? ''; i += m[0].length - 1; continue; }
      const p = /^\$\{\d+:/.exec(rest);
      if (p) { depth++; i += p[0].length - 1; continue; }
      const choice = /^\$\{\d+\|([^,|}]*)[^}]*\|\}/.exec(rest);
      if (choice) { out += choice[1]; i += choice[0].length - 1; continue; }
    }
    if (ch === '}' && depth > 0) { depth--; continue; }
    out += ch;
  }
  return out;
}

function categoryLabel(s: SnippetDef): string | undefined {
  return s.category ? CATEGORY_LABELS[s.category] : undefined;
}

function toItem(s: SnippetDef, score: number, range?: [number, number]): CompletionItem {
  const cat = categoryLabel(s);
  const item: CompletionItem = {
    label: s.prefix, kind: 'snippet', detail: s.name + (s.builtin ? '' : ' · user snippet'),
    documentation: (cat ? `*${cat}*\n\n` : '') + (s.description ? s.description + '\n\n' : '') + '```sql\n' + snippetPreview(s.body) + '\n```',
    insertText: s.body, isSnippet: true, sortText: sortTextFor(score), filterText: s.prefix, score, usageKey: 'snip:' + s.prefix,
  };
  if (cat) item.description = cat;
  if (range) item.range = range;
  return item;
}

/** Best score of a typed word against a snippet: prefix first, then the name's words, the category and the description. */
function scoreOf(word: string, s: SnippetDef, strict: boolean): number {
  const prefixMs = matchScore(word, s.prefix);
  const nameMs = matchScore(word, s.name);
  // at a statement start only whole-word hits in the name count (typing "pagination" finds the paging snippets)
  const byName = nameMs >= (strict ? 62 : 0) ? nameMs - 30 : -1;
  if (strict) return Math.max(prefixMs, byName);
  const catMs = s.category ? matchScore(word, CATEGORY_LABELS[s.category]) : -1;
  const descMs = s.description ? matchScore(word, s.description) : -1;
  return Math.max(prefixMs, nameMs - 10, catMs >= 0 ? catMs - 40 : -1, descMs >= 50 ? descMs - 40 : -1);
}

/** Completer source: snippets at statement start, below exact keyword matches (keywords are group 9 in the completer). */
export function snippetSource(dialect: Dialect, user: () => readonly Snippet[] | null | undefined): ExtraCompletionSource {
  void ensureBuiltins(dialect);
  return (c: CursorContext, _env: CompleteEnv) => {
    void _env;
    if (!c.atStatementStart || c.qualifier) return null;
    const out: CompletionItem[] = [];
    for (const s of snippetsFor(dialect, user())) {
      const ms = scoreOf(c.prefixText, s, true);
      if (c.prefixText && ms < 0) continue;
      out.push(toItem(s, 8000 + ms + (s.builtin ? 0 : 5)));
    }
    return out;
  };
}

/**
 * Ctrl+J: every snippet of the dialect. With nothing typed they are grouped by category (Query, DML, DDL, …); with a word
 * before the cursor they are matched against prefix, name, category and description and ranked by match quality.
 */
export function snippetPickerItems(dialect: Dialect, user: readonly Snippet[] | null | undefined, word: string, range: [number, number]): CompletionItem[] {
  const out: CompletionItem[] = [];
  for (const s of snippetsFor(dialect, user)) {
    const ms = scoreOf(word, s, false);
    if (word && ms < 0) continue;
    const item = toItem(s, 1000 + ms, range);
    const cat = categoryLabel(s);
    item.filterText = [s.prefix, s.name, cat, s.description].filter(Boolean).join(' ');
    item.description = cat ? `${cat} · ${s.name}` : s.name;
    if (!word) {
      // user snippets first, then the built-ins by category and prefix
      const group = s.builtin ? 1 + Math.max(0, SNIPPET_CATEGORIES.indexOf(s.category ?? 'Query')) : 0;
      item.sortText = `${group}~${s.prefix.toLowerCase()}`;
    }
    out.push(item);
  }
  return out.sort((a, b) => (word ? b.score - a.score || a.label.localeCompare(b.label) : (a.sortText ?? '').localeCompare(b.sortText ?? '')));
}

/** A fresh user snippet id. */
export function newSnippetId(existing: readonly { id: string }[]): string {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `s_${n}`)) n++;
  return `s_${n}`;
}
