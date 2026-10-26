// The built-in snippet library (all dialects): Monaco syntax, unique prefixes, categories, dialect hygiene, and a syntax
// sanity pass of every snippet through the project's own tokenizer, statement splitter and soft diagnostics.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Dialect } from '../api/types';
import { createIntel } from '../intel';
import { ensureDialect } from '../intel/dialect/registry';
import {
  CATEGORY_LABELS, SNIPPET_CATEGORIES, ensureBuiltins, loadAllBuiltins, snippetPickerItems, snippetPreview, snippetsFor, unclosedPlaceholders,
  validateSnippet, type SnippetDef,
} from './index';
import { SNIPPET_DIALECTS } from './builtins';

const DIALECTS: Dialect[] = ['tsql', 'plsql', 'pgsql', 'sqlite', 'mysql', 'clickhouse', 'snowflake', 'cql'];
const lists = new Map<Dialect, readonly SnippetDef[]>();

beforeAll(async () => {
  for (const d of DIALECTS) {
    await ensureDialect(d);
    lists.set(d, await ensureBuiltins(d));
  }
});

/** Minimum number of built-ins per dialect (the shared ones included). */
const MIN: Record<Dialect, number> = {
  tsql: 80, plsql: 70, pgsql: 80, mysql: 70, clickhouse: 70, snowflake: 70, sqlite: 45, cql: 40,
  // LINKS-WPD begin (WP-D adds 'duckdb' to DIALECTS once data/duckdb.ts has its library)
  duckdb: 0,
  // LINKS-WPD end
};
/** LINKS-WP0: dialects whose library is still a stub (not held to the shape rules below yet). */
const PENDING: Dialect[] = ['duckdb'];

describe('library shape', () => {
  it('every dialect is covered and big enough', () => {
    expect(SNIPPET_DIALECTS.filter((d) => !PENDING.includes(d)).sort()).toEqual(DIALECTS.slice().sort());
    for (const d of DIALECTS) expect(lists.get(d)!.length, d).toBeGreaterThanOrEqual(MIN[d]);
  });

  it('prefixes and ids are unique per dialect, prefixes are valid, every entry is documented', () => {
    const short: string[] = [];
    for (const d of DIALECTS) {
      const list = lists.get(d)!;
      expect(new Set(list.map((s) => s.prefix)).size, `${d} prefixes`).toBe(list.length);
      expect(new Set(list.map((s) => s.id)).size, `${d} ids`).toBe(list.length);
      for (const s of list) {
        expect(validateSnippet(s), `${d}:${s.prefix}`).toEqual([]);
        expect(s.prefix.length, `${d}:${s.prefix}`).toBeLessThanOrEqual(12);
        expect(s.name.length, `${d}:${s.prefix} name`).toBeGreaterThan(3);
        if ((s.description ?? '').length < 14) short.push(`${d}:${s.prefix}`);
        expect(SNIPPET_CATEGORIES, `${d}:${s.prefix} category`).toContain(s.category);
        expect(s.dialects, `${d}:${s.prefix}`).toEqual([d]);
        expect(s.builtin).toBe(true);
      }
    }
    expect(short, "descriptions of at least 14 characters").toEqual([]);
  });

  it('every dialect has all five categories, each with several snippets', () => {
    for (const d of DIALECTS) {
      for (const cat of SNIPPET_CATEGORIES) {
        const n = lists.get(d)!.filter((s) => s.category === cat).length;
        expect(n, `${d} ${cat}`).toBeGreaterThanOrEqual(cat === 'Programmability' && d === 'cql' ? 3 : 4);
      }
    }
  });

  it('the groups are loaded as one library for Settings (shared snippets merged)', async () => {
    const all = await loadAllBuiltins();
    const sel = all.filter((s) => s.prefix === 'sel');
    expect(sel).toHaveLength(1);
    expect(sel[0].dialects).toBeNull();
    expect(all.length).toBeGreaterThan(450);
  });
});

describe('Monaco snippet syntax', () => {
  it('placeholders are balanced and every dollar is a tab stop, a placeholder or escaped', () => {
    for (const d of DIALECTS) {
      for (const s of lists.get(d)!) {
        expect(unclosedPlaceholders(s.body), `${d}:${s.prefix} unclosed`).toBe(0);
        // a bare `$name` would be read as a snippet variable; `$$` and `v$session` must be written `\$`
        expect(/(^|[^\\])\$(?![0-9{])/.test(s.body), `${d}:${s.prefix} unescaped $`).toBe(false);
        // placeholders are numbered from 1 (0 is the final cursor) and a default may not contain `${`
        for (const m of s.body.matchAll(/\$\{(\d+)[:|}]/g)) expect(Number(m[1]), `${d}:${s.prefix} tab stop`).toBeGreaterThanOrEqual(1);
        expect(s.body.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('a placeholder number always carries the same default (mirrors stay in sync)', () => {
    const bad: string[] = [];
    for (const d of DIALECTS) {
      for (const s of lists.get(d)!) {
        const seen = new Map<string, string>(); // tab stop number -> default text
        for (const m of s.body.matchAll(/\$\{(\d+):([^}]*)\}/g)) {
          const prev = seen.get(m[1]);
          if (prev !== undefined && prev !== m[2]) bad.push(`${d}:${s.prefix} tab stop ${m[1]}: '${prev}' vs '${m[2]}'`);
          seen.set(m[1], m[2]);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('previews expand placeholders to their defaults', () => {
    expect(snippetPreview(lists.get('tsql')!.find((s) => s.prefix === 'merge')!.body)).toContain('OUTPUT $action');
    expect(snippetPreview(lists.get('pgsql')!.find((s) => s.prefix === 'dyn')!.body)).toContain('> $1');
    expect(snippetPreview(lists.get('snowflake')!.find((s) => s.prefix === 'proc')!.body)).toContain('AS\n$$\nBEGIN');
    expect(snippetPreview('a \\d b}')).toBe('a \\d b}');
  });
});

describe('dialect hygiene', () => {
  const body = (d: Dialect, p: string) => lists.get(d)!.find((s) => s.prefix === p)!.body;

  it('syntax that belongs to another dialect does not leak', () => {
    const only = (re: RegExp, allowed: Dialect[]) => {
      for (const d of DIALECTS.filter((x) => !allowed.includes(x))) {
        for (const s of lists.get(d)!) {
          // comments and descriptions may mention other dialects; check the SQL lines
          const sql = snippetPreview(s.body).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
          expect(re.test(sql), `${d}:${s.prefix} contains ${re}`).toBe(false);
        }
      }
    };
    only(/\bSELECT\s+TOP\b/i, ['tsql', 'snowflake']);
    only(/\bdbo\./i, ['tsql']);
    only(/\bFROM\s+DUAL\b/i, ['plsql', 'snowflake', 'mysql']);
    only(/\bIDENTITY\s*\(/i, ['tsql']);
    only(/\bAUTO_INCREMENT\b/i, ['mysql']);
    only(/\bILIKE\b/i, ['pgsql', 'snowflake']);
    only(/\bROWNUM\b/i, ['plsql']);
    only(/\bGENERATE_SERIES\b/i, ['pgsql']);
    only(/\bBEGIN\s+TRY\b/i, ['tsql']);
    only(/\bsp_executesql\b/i, ['tsql']);
    only(/\bLIMIT\b/i, ['sqlite', 'pgsql', 'mysql', 'clickhouse', 'snowflake', 'cql']);
    only(/\bOFFSET\b[^\n]*\bROWS\b/i, ['tsql', 'plsql']);
    only(/\bQUALIFY\b/i, ['snowflake']);
    only(/\bALLOW FILTERING\b/i, ['cql']);
  });

  it('known per-dialect corrections are in place', () => {
    // ClickHouse has no UPDATE statement or plain CREATE INDEX; Snowflake has no CREATE INDEX
    expect(body('clickhouse', 'upd')).toMatch(/^ALTER TABLE/);
    expect(body('clickhouse', 'idx')).toContain('TYPE');
    expect(body('snowflake', 'idx')).toContain('CLUSTER BY');
    expect(lists.get('cql')!.some((s) => s.prefix === 'join' || s.prefix === 'cte' || s.prefix === 'case')).toBe(false);
    // MySQL cannot compute LIMIT/OFFSET expressions
    expect(body('mysql', 'page')).not.toMatch(/OFFSET \(/);
    // Oracle recursive CTE needs the column list and has no RECURSIVE keyword
    expect(body('plsql', 'cterec')).not.toMatch(/RECURSIVE/);
    expect(body('tsql', 'cterec')).not.toMatch(/RECURSIVE/);
  });

  it('shared snippets keep their historical prefixes in every dialect', () => {
    for (const d of DIALECTS) {
      const have = new Set(lists.get(d)!.map((s) => s.prefix));
      for (const p of ['sel', 'selw', 'selc', 'ins', 'upd', 'del']) expect(have, `${d}:${p}`).toContain(p);
      if (d !== 'cql') for (const p of ['cte', 'join', 'case']) expect(have, `${d}:${p}`).toContain(p);
    }
  });
});

describe('syntax sanity through the dialect tokenizer and statement splitter', () => {
  for (const d of DIALECTS) {
    it(`${d}: every snippet tokenizes, splits and passes the lexical checks`, () => {
      const intel = createIntel(d);
      for (const s of lists.get(d)!) {
        const text = snippetPreview(s.body);
        const uri = `snip:${d}:${s.prefix}`;
        intel.setDocument(uri, text);
        const where = `${d}:${s.prefix}`;
        // no unterminated strings/comments/quoted identifiers, no unbalanced parentheses
        const errors = intel.softDiagnostics(uri).filter((x) => x.severity === 'error');
        expect(errors.map((e) => e.message), where).toEqual([]);
        // a snippet that is more than comments yields at least one statement and no client meta-command lines
        const significant = intel.tokens(uri).some((t) => t.kind !== 'comment' && t.kind !== 'ws' && t.kind !== 'eof');
        const statements = intel.statements(uri);
        // (DELIMITER is a client command, not a statement)
        if (significant && s.prefix !== 'delim') expect(statements.length, where).toBeGreaterThan(0);
        if (s.prefix !== 'delim') expect(intel.tokens(uri).some((t) => t.kind === 'meta'), `${where} meta`).toBe(false);
        // dollar-quoted bodies are never cut in the middle by the splitter
        if (d === 'pgsql' || d === 'snowflake') {
          for (const m of text.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
            const a = m.index!, z = a + m[0].length;
            for (const st of statements) expect(st.start <= a || st.start >= z || st.start === a, `${where} splits a $$ body`).toBe(true);
            const inside = statements.filter((st) => st.start > a && st.start < z);
            expect(inside, `${where} splits a $$ body`).toEqual([]);
          }
        }
        intel.closeDocument(uri);
      }
    });
  }

  it('statements of well-known snippets split as intended', () => {
    const intel = createIntel('tsql');
    const body = snippetPreview(lists.get('tsql')!.find((s) => s.prefix === 'tbltype')!.body);
    intel.setDocument('x', body);
    expect(intel.batchesFor('x').length).toBeGreaterThanOrEqual(2); // GO separates the type from the procedure
    const pg = createIntel('pgsql');
    pg.setDocument('x', snippetPreview(lists.get('pgsql')!.find((s) => s.prefix === 'trgupd')!.body));
    expect(pg.statements('x')).toHaveLength(2); // function + trigger
  });
});

describe('picker and completion', () => {
  it('Ctrl+J lists snippets of the dialect grouped by category, with the category in the label', () => {
    const items = snippetPickerItems('tsql', [], '', [0, 0]);
    const cats = items.map((i) => (i.description ?? '').split(' · ')[0]);
    // grouped: the category order never goes backwards
    const order = SNIPPET_CATEGORIES.map((c) => CATEGORY_LABELS[c]);
    let last = 0;
    for (const c of cats) {
      const i = order.indexOf(c);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
  });

  it('Ctrl+J finds snippets by prefix, name, description and category', () => {
    snippetsFor('pgsql', []); // loaded in beforeAll
    const label = (word: string) => snippetPickerItems('pgsql', [], word, [0, word.length]).map((i) => i.label);
    expect(label('rown')[0]).toBe('rown');
    expect(label('pagination')).toContain('page');
    expect(label('pagination')).toContain('keyset');
    expect(label('deadlock')).toEqual([]);
    expect(label('blocking')).toContain('block');
    expect(label('DBA')).toContain('sizes');
    expect(label('partial')).toContain('idxp');
  });

  it('statement-start completion offers library snippets by prefix, below keywords, in every dialect', () => {
    for (const d of DIALECTS) {
      const have = lists.get(d)!;
      expect(snippetsFor(d, []).length, d).toBe(have.length);
    }
  });
});
