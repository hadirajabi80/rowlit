// Bind parameters in SQL about to run (PLAN-M1.5 A2): `@x` (T-SQL, not DECLAREd in the batch), `:x` (Oracle,
// SQLite), `?`/`?N`, `$x` (SQLite); PostgreSQL `$n` (positional n), `:x`/`@x` (named), never `?` (a jsonb operator). Uses the intel lexer so strings and comments never produce false positives.
import type { Dialect, SqlBatch } from '../../api/types';
import { getSpec, tokenize, type Token } from '../../intel';

export interface DetectedParam {
  /** Bind name without prefix; positional `?` parameters are named "1", "2", … */
  name: string;
  /** As written ("@id", ":id", "?"). */
  display: string;
  positional: boolean;
}

const STATEMENT_START = /^(SELECT|SET|INSERT|UPDATE|DELETE|MERGE|IF|WHILE|EXEC|EXECUTE|BEGIN|RETURN|DECLARE|WITH|PRINT)$/;

const SIG = (t: Token) => t.kind !== 'ws' && t.kind !== 'comment' && t.kind !== 'eof';

/** Statements whose `@x` / `:x` are definitions, not binds (procedure headers, trigger :new/:old). */
function isDefinition(toks: Token[]): boolean {
  const i = toks[0]?.upper === 'CREATE' ? 1 : -1;
  if (i < 0) return false;
  let j = i;
  if (toks[j]?.upper === 'OR') j += 2; // OR REPLACE / OR ALTER
  // MySQL: CREATE DEFINER = user@host | CURRENT_USER[()] [AGGREGATE] …
  if (toks[j]?.upper === 'DEFINER') while (j < toks.length && !/^(PROCEDURE|FUNCTION|TRIGGER|EVENT|VIEW|AGGREGATE)$/.test(toks[j].upper)) j++;
  if (toks[j]?.upper === 'AGGREGATE') j++;
  const what = toks[j]?.upper;
  return what === 'PROCEDURE' || what === 'PROC' || what === 'FUNCTION' || what === 'TRIGGER' || what === 'PACKAGE' || what === 'TYPE' || what === 'EVENT';
}

/**
 * CQL: is the `:x` at toks[i] a map / UDT key-value separator glued to a value (`{'k':true}`, `{name:x}`)? It is when it
 * directly follows a key (literal, name, marker, closed tuple) inside braces; a marker follows `{`, `,` or `:` instead.
 * Mirrors the engine's CqlText.IsKeyValueColon.
 */
function isMapColon(toks: Token[], i: number): boolean {
  const prev = toks[i - 1];
  if (!prev) return false;
  const keyLike = prev.kind === 'string' || prev.kind === 'number' || prev.kind === 'ident' || prev.kind === 'keyword'
    || prev.kind === 'quotedIdent' || prev.kind === 'param' || prev.text === ')' || prev.text === ']' || prev.text === '}';
  if (!keyLike) return false;
  let depth = 0;
  for (let k = i - 1; k >= 0; k--) {
    const t = toks[k].text;
    if (t === '}' || t === ')' || t === ']') depth++;
    else if (t === '(' || t === '[') {
      if (depth === 0) return false;
      depth--;
    } else if (t === '{') {
      if (depth === 0) return true;
      depth--;
    }
  }
  return false;
}

export function detectParams(batches: readonly SqlBatch[], dialect: Dialect): DetectedParam[] {
  const spec = getSpec(dialect);
  const out: DetectedParam[] = [];
  const seen = new Set<string>();
  let positional = 0;
  for (const b of batches) {
    const toks = tokenize(b.sql, spec).filter(SIG);
    if (isDefinition(toks)) continue;
    if (dialect === 'pgsql' && toks[0]?.upper === 'DO') continue; // DO $$ … $$: a PL/pgSQL block, no binds
    const declared = new Set<string>();
    if (dialect === 'tsql') {
      // DECLARE @a int, @b int = 1, @t TABLE (…)
      for (let i = 0; i < toks.length; i++) {
        if (toks[i].upper !== 'DECLARE') continue;
        let depth = 0;
        for (let j = i + 1; j < toks.length; j++) {
          const t = toks[j];
          if (t.text === '(') depth++;
          else if (t.text === ')') depth--;
          else if (t.text === ';' && depth === 0) break;
          if (depth !== 0) continue;
          if (t.kind === 'param' && (j === i + 1 || toks[j - 1].text === ',')) declared.add(t.upper);
          else if (STATEMENT_START.test(t.upper) && toks[j - 1].text !== '=') break; // next statement (no `;`)
        }
      }
    }
    const isExec = toks[0] && /^(EXEC|EXECUTE)$/.test(toks[0].upper);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind === 'param') {
        const text = t.text;
        if (dialect === 'tsql') {
          if (text.startsWith('@@')) continue;
          if (declared.has(t.upper)) continue;
          if (isExec && toks[i + 1]?.text === '=') continue; // EXEC p @Name = value: a parameter name of p
          add(text.slice(1), text);
        } else if (dialect === 'pgsql') {
          if (text.startsWith('?')) continue;
          if (text.startsWith(':') && b.sql[t.start - 1] === ':') continue; // x::type cast
          if (text.startsWith('$') && !/^\$\d+$/.test(text)) continue; // only $1, $2, … are binds
          add(text.slice(1).replace(/^"|"$/g, ''), text);
        } else if (dialect === 'plsql') {
          if (!text.startsWith(':')) continue; // &substitution variables are SQL*Plus, not binds
          const name = text.slice(1).replace(/^"|"$/g, '');
          add(name, text);
        } else {
          if (dialect === 'mysql' && text.startsWith('@')) continue; // @user_var / @@sysvar: variables, not binds
          if (dialect === 'cql' && text.startsWith(':') && isMapColon(toks, i)) continue; // {'k':true}: a map entry
          if (text.startsWith('?')) {
            if (text.length > 1) add(text.slice(1), text, true);
            else add(String(++positional), '?', true, true);
          } else add(text.slice(1), text);
        }
      } else if (t.text === '?' && dialect !== 'sqlite' && dialect !== 'pgsql') {
        add(String(++positional), '?', true, true);
      }
    }
  }
  return out;

  function add(name: string, display: string, isPositional = /^\d+$/.test(name), always = false) {
    const key = name.toUpperCase();
    if (!always && seen.has(key)) return;
    seen.add(key);
    out.push({ name, display, positional: isPositional });
  }
}
