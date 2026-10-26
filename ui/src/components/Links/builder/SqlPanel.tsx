// Right panel of the builder: the SQL the model compiles to (read-only Monaco, same text the engine compiles), its
// warnings, and Advanced mode: the SQL becomes editable (DuckDB dialect with the link's IntelliSense) and runs as
// written; "Back to builder" parses it again (POST /links/{cid}/parse).
import { AlertTriangle, ArrowLeftRight, Braces, Copy, Info, LoaderCircle, SquareTerminal, Undo2 } from 'lucide-react';
import type { CompileResult } from '../../../api/links';
import type { RunLabel, SqlBatch } from '../../../api/types';
import { copyText } from '../../../app/actions';
import { keyHint } from '../../../commands/registry';
import { SqlEditor } from '../../../editor/SqlEditor';
import { inlineParams } from '../../../filter/sql';
import { useSnapshot } from '../../../store/catalog';
import { useSettings } from '../../../store/settings';
import type { EffectiveTheme } from '../../../theme/useTheme';

interface Props {
  tabId: string;
  linkId: string;
  theme: EffectiveTheme;
  mode: 'builder' | 'sql';
  compiled: CompileResult;
  /** Show bind values inlined in the preview (readable) instead of $fp1… */
  inline: boolean;
  onInline(v: boolean): void;
  sql: string;
  onSqlChange(sql: string): void;
  onToggleMode(): void;
  /** Advanced mode only: drop the hand edits and go back to the builder's SQL. */
  onDiscardSql(): void;
  parsing: boolean;
  onRun(): void;
  onOpenInConsole(): void;
}

/** Splits text at top-level occurrences of `sep` (outside parentheses and quotes). */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/**
 * The preview's layout: long SELECT lists one item per line, long WHERE / HAVING / ON chains one condition per line.
 * Display only — Copy, Run and the engine use the canonical text.
 */
export function previewLayout(sql: string, width = 72): string {
  const NL = '\n';
  return sql.split(NL).map((line) => {
    if (line.length <= width) return line;
    const sel = /^(SELECT (?:DISTINCT )?)(.*)$/.exec(line);
    if (sel) {
      const items = splitTop(sel[2], ', ');
      if (items.length > 1) return sel[1] + items.join(`,${NL}${' '.repeat(sel[1].length)}`);
    }
    const cond = /^(WHERE |HAVING |(?:INNER|LEFT|RIGHT|FULL) JOIN .*? ON )(.*)$/.exec(line);
    if (cond) {
      const parts = splitTop(cond[2], ' AND ');
      if (parts.length > 1) return cond[1] + parts.join(`${NL}  AND `);
    }
    const order = /^((?:GROUP|ORDER) BY )(.*)$/.exec(line);
    if (order) {
      const parts = splitTop(order[2], ', ');
      if (parts.length > 1) return order[1] + parts.join(`,${NL}${' '.repeat(order[1].length)}`);
    }
    return line;
  }).join(NL);
}

const WARN_TEXT: Record<string, string> = {
  cartesian: 'Rows multiply',
  limitWithoutOrder: 'Limit without sort',
  joinKinds: 'Join types differ',
  filter: 'Filter',
};

export function SqlPanel(p: Props) {
  const settings = useSettings((s) => s.settings.editor);
  const snapshot = useSnapshot(p.linkId, null);
  const preview = previewLayout(p.inline ? inlineParams(p.compiled.sql, p.compiled.params, 'duckdb') : p.compiled.sql);
  const text = p.mode === 'sql' ? p.sql : preview;
  const onRun = (_l: RunLabel, _b: SqlBatch[]) => p.onRun();
  return (
    <aside className={`lkb-sql${p.mode === 'sql' ? ' advanced' : ''}`} aria-label="SQL">
      <div className="lkb-sql-head">
        <Braces size={13} aria-hidden="true" />
        <span className="lkb-sql-title">{p.mode === 'sql' ? 'SQL (Advanced)' : 'SQL'}</span>
        <span className="flex-1" />
        {p.mode === 'builder' && p.compiled.params.length > 0 && (
          <label className="check sm" title="Show the filter values in the SQL instead of the $fp1 bind parameters it runs with">
            <input type="checkbox" checked={p.inline} onChange={(e) => p.onInline(e.target.checked)} /> Values
          </label>
        )}
        <button type="button" className="icon-btn xs" aria-label="Copy SQL" title="Copy SQL" disabled={!text} onClick={() => void copyText(p.mode === 'sql' ? p.sql : inlineParams(p.compiled.sql, p.compiled.params, 'duckdb'), 'SQL copied')}>
          <Copy size={13} />
        </button>
        <button type="button" className="icon-btn xs" aria-label="Open SQL in a console" title="Open in a console on the link" disabled={!text} onClick={p.onOpenInConsole}>
          <SquareTerminal size={13} />
        </button>
      </div>
      {p.mode === 'builder' && p.compiled.warnings.length > 0 && (
        <ul className="lkb-warnings" aria-label="Warnings">
          {p.compiled.warnings.map((w, i) => (
            <li key={i} className={`lkb-warning ${w.code}`} title={w.message}>
              <AlertTriangle size={11} aria-hidden="true" /> <b>{WARN_TEXT[w.code] ?? w.code}</b> <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="lkb-sql-editor">
        {text || p.mode === 'sql' ? (
          <SqlEditor
            tabId={`${p.tabId}-${p.mode === 'sql' ? 'sql' : 'preview'}`}
            dialect="duckdb"
            catalog={p.mode === 'sql' ? snapshot : null}
            value={text}
            onChange={(v) => { if (p.mode === 'sql') p.onSqlChange(v); }}
            onRun={onRun}
            readOnly={p.mode !== 'sql'}
            theme={p.theme}
            settings={settings}
            parameterHint={false}
          />
        ) : (
          <div className="lkb-sql-empty"><Info size={14} aria-hidden="true" /> The SQL appears here as you build the query.</div>
        )}
      </div>
      <div className="lkb-sql-foot">
        {p.mode === 'builder' ? (
          <button type="button" className="btn btn-xs" onClick={p.onToggleMode} disabled={!p.compiled.sql} title={`Edit the SQL by hand${keyHint('links.toggleSql', ' (', ')')}. The builder can read it back when it stays within what the builder can show.`}>
            <ArrowLeftRight size={12} /> Edit SQL (Advanced)
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-xs btn-primary" onClick={p.onToggleMode} disabled={p.parsing} title={`Read the SQL back into the builder${keyHint('links.toggleSql', ' (', ')')}`}>
              {p.parsing ? <LoaderCircle size={12} className="spin" /> : <ArrowLeftRight size={12} />} Back to builder
            </button>
            <button type="button" className="btn btn-xs" onClick={p.onDiscardSql} title="Forget the hand edits and return to the builder's query">
              <Undo2 size={12} /> Discard edits
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
