// Execute routine building blocks shared by the dialog and the result page (WP3): the parameter inputs state, the
// compact parameter form (one ~36px row per input parameter, typed editors, NULL / Default toggles, inline validation,
// a single "Outputs" line for the OUT-only parameters), the routine header and the call preview (a one-line summary that
// expands into the SQL). The SQL itself comes from routineSql.ts (pure, tested).
import { ArrowLeftFromLine, Check, ChevronRight, Copy, Rows3, TextCursorInput } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { copyText } from '../../app/actions';
import { ObjectIcon } from '../common/icons';
import {
  bareParamName, buildRoutineCall, initialInput, isOutputOnly, paramKindOf, routineLabel, routineName, routineNoun, valueEditorOf, type ParamInput,
  type RoutineCall, type RoutineParam, type RoutineSpec, type ValueEditor,
} from './routineSql';
import type { RememberedParam } from './store';

// ---------------------------------------------------------------------------------------------- state

export interface ParamInputsState {
  inputs: ParamInput[];
  setInputs(next: ParamInput[]): void;
  set(i: number, p: Partial<ParamInput>): void;
  call: RoutineCall | null;
  /** Every value parses and the call as a whole is fine. */
  valid: boolean;
  showErrors: boolean;
  setShowErrors(v: boolean): void;
  /** Index of the first parameter with an error, or -1. */
  firstError: number;
}

export function useParamInputs(spec: RoutineSpec | null, initial?: ParamInput[] | null): ParamInputsState {
  const [inputs, setInputs] = useState<ParamInput[]>(() => initial ?? spec?.params.map(initialInput) ?? []);
  const [showErrors, setShowErrors] = useState(false);
  const call = useMemo(() => (spec ? buildRoutineCall(spec, inputs) : null), [spec, inputs]);
  const valid = !!call && !call.error && call.errors.every((e) => e === null);
  return {
    inputs,
    setInputs,
    set: (i, p) => setInputs((cur) => cur.map((x, k) => (k === i ? { ...x, ...p } : x))),
    call,
    valid,
    showErrors,
    setShowErrors,
    firstError: call ? call.errors.findIndex((e) => e !== null) : -1,
  };
}

// ---------------------------------------------------------------------------------------------- header

export function kindBadge(spec: Pick<RoutineSpec, 'kind' | 'packageName'>): string {
  if (spec.kind === 'proc') return spec.packageName ? 'package procedure' : 'procedure';
  if (spec.kind === 'tablefunc') return 'table function';
  return spec.packageName ? 'package function' : 'function';
}

/** Icon tile, `schema.name` and the kind badge (plus an optional eyebrow line above the name). */
export function RoutineHeading({ spec, fallbackName, eyebrow, trailing }: { spec: RoutineSpec | null; fallbackName: string; eyebrow?: string; trailing?: ReactNode }) {
  const type = spec?.kind ?? 'proc';
  return (
    <span className="er-heading">
      <span className={`er-tile kind-${type === 'proc' ? 'proc' : 'func'}`} aria-hidden="true">
        <ObjectIcon type={type} size={16} />
      </span>
      <span className="er-heading-text">
        {eyebrow && <span className="er-eyebrow">{eyebrow}</span>}
        <span className="er-heading-name mono" title={spec ? routineLabel(spec) : fallbackName}>{spec ? routineLabel(spec) : fallbackName}</span>
      </span>
      {spec && <span className="er-kind">{kindBadge(spec)}</span>}
      {trailing}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------- form

const DIRECTION_LABEL = { in: 'IN', out: 'OUT', inout: 'IN OUT' } as const;

/** Output-only parameters (and Oracle REF CURSORs) take no value: they are listed on the "Outputs" line instead. */
export function isOutputRow(p: RoutineParam, spec: Pick<RoutineSpec, 'dialect'>): boolean {
  return isOutputOnly(p) || (paramKindOf(p.type, spec.dialect) === 'refcursor' && spec.dialect === 'plsql');
}

/** How an argument is written: `@name` in T-SQL, the bare name elsewhere. */
export function bindPrefix(spec: Pick<RoutineSpec, 'dialect'>): string {
  return spec.dialect === 'tsql' ? '@' : '';
}

interface FormProps {
  spec: RoutineSpec;
  state: ParamInputsState;
  /** Remembered values per parameter (lower-case bare name): MRU suggestions. */
  memory?: Record<string, RememberedParam>;
  /** Enter on the last field / Ctrl+Enter anywhere. */
  onSubmit(): void;
  /** Id prefix (the dialog and the result page can both be mounted). */
  idPrefix?: string;
  /** Narrow window: name and toggles on one line, the field on its own line below. */
  stacked?: boolean;
}

/**
 * The parameter rows. Enter in a single-line field moves to the next field (on the last one it runs), Ctrl+Enter
 * runs from anywhere.
 */
export function RoutineParamsForm({ spec, state, memory, onSubmit, idPrefix = 'er', stacked = false }: FormProps) {
  const noun = routineNoun(spec.kind);
  if (!spec.params.length) {
    return <p className="er-muted er-noparams">This {noun} has no parameters.</p>;
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      onSubmit();
      return;
    }
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLInputElement) || !t.matches('[data-er-value]')) return;
    e.preventDefault();
    e.stopPropagation();
    const fields = [...(e.currentTarget.querySelectorAll<HTMLElement>('[data-er-value]:not([disabled])'))];
    const next = fields[fields.indexOf(t) + 1];
    if (next) next.focus();
    else onSubmit();
  };
  const rows = spec.params.map((p, i) => ({ p, i })).filter(({ p }) => !isOutputRow(p, spec));
  const outputs = spec.params.map((p, i) => ({ p, i })).filter(({ p }) => isOutputRow(p, spec));
  const anyDefault = rows.some(({ p }) => p.hasDefault);
  return (
    <div className={`er-form${stacked ? ' er-stacked' : ''}`}>
      {rows.length > 0 && (
        <div className={`er-params${anyDefault ? ' has-defaults' : ''}`} role="group" aria-label="Parameters" onKeyDown={onKeyDown}>
          {rows.map(({ p, i }) => (
            <ParamRow
              key={`${spec.packageName ?? ''}.${spec.name}#${spec.overload ?? ''}-${i}`}
              id={`${idPrefix}-value-${i}`}
              index={i}
              param={p}
              spec={spec}
              input={state.inputs[i] ?? initialInput(p)}
              error={state.showErrors || (state.inputs[i]?.value ?? '') !== '' ? state.call?.errors[i] ?? null : null}
              mru={memory?.[bareParamName(p).toLowerCase()]?.values ?? []}
              onValue={(v) => state.set(i, { value: v, mode: 'value' })}
              onMode={(mode) => state.set(i, { mode })}
            />
          ))}
        </div>
      )}
      {outputs.length > 0 && (
        <p className="er-outputs" role="note" aria-label="Output parameters" title="Written by the routine; shown with the results">
          <ArrowLeftFromLine size={13} aria-hidden="true" />
          <span className="er-outputs-label">Outputs:</span>
          {outputs.map(({ p, i }, k) => (
            <span key={i} className="er-out">
              <span className="mono er-out-name">{bindPrefix(spec)}{bareParamName(p) || `$${i + 1}`}</span> <span className="mono er-type">{p.type || 'any'}</span>
              {k < outputs.length - 1 ? ',' : ''}
            </span>
          ))}
          <span className="er-outputs-note">(returned after the run)</span>
        </p>
      )}
    </div>
  );
}

interface RowProps {
  id: string;
  index: number;
  param: RoutineParam;
  spec: RoutineSpec;
  input: ParamInput;
  error: string | null;
  mru: string[];
  onValue(v: string): void;
  onMode(m: ParamInput['mode']): void;
}

function ParamRow({ id, index, param: p, spec, input, error, mru, onValue, onMode }: RowProps) {
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const refocus = useRef(false);
  const name = bareParamName(p) || `$${index + 1}`;
  const dir = p.direction;
  const kind = paramKindOf(p.type, spec.dialect);
  const editor: ValueEditor = valueEditorOf(p.type, kind);
  const listId = `${id}-mru`;
  const passive = input.mode !== 'value';
  const placeholder = input.mode === 'null' ? 'NULL' : input.mode === 'default' ? 'default' : kind === 'string' ? 'empty string' : '';
  const shown = input.mode === 'value' ? input.value : '';
  const area = editor === 'multiline' && (expanded || shown.includes('\n'));
  // Switching between the line and the text area replaces the element: keep the keyboard where it was.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    document.getElementById(id)?.focus();
  }, [area, id]);
  const common = {
    id,
    'data-er-value': true,
    'aria-label': `Value of ${name}`,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : undefined,
    spellCheck: false,
  } as const;
  const cls = (extra = '') => `input mono er-input${passive ? ' er-passive' : ''}${error ? ' invalid' : ''}${extra}`;
  const dateLike = editor === 'date' || editor === 'datetime' || editor === 'time';

  let field: ReactNode;
  if (editor === 'bool') {
    const v = input.mode === 'value' ? input.value : '';
    field = (
      <span className={`er-bool${passive ? ' er-passive' : ''}${error ? ' invalid' : ''}`} role="radiogroup" aria-label={`Value of ${name}`}>
        {['true', 'false'].map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={v === b}
            className={v === b ? 'on' : ''}
            data-er-value={b === 'true' ? true : undefined}
            onClick={() => onValue(b)}
          >
            {b}
          </button>
        ))}
        {passive && <span className="er-bool-state">{input.mode === 'null' ? 'NULL' : 'default'}</span>}
      </span>
    );
  } else if (area) {
    field = <textarea {...common} className={cls(' er-text')} rows={4} value={shown} placeholder={placeholder} onChange={(e) => onValue(e.target.value)} />;
  } else {
    const type = raw || !dateLike ? 'text' : editor === 'date' ? 'date' : editor === 'datetime' ? 'datetime-local' : 'time';
    field = (
      <span className="er-field-line">
        <input
          {...common}
          type={type}
          step={type === 'datetime-local' || type === 'time' ? 1 : undefined}
          inputMode={editor === 'number' ? (kind === 'int' ? 'numeric' : 'decimal') : undefined}
          className={cls(editor === 'number' ? ' er-number' : '')}
          value={shown}
          placeholder={placeholder || (dateLike && raw ? (editor === 'date' ? 'YYYY-MM-DD' : editor === 'time' ? 'hh:mm:ss' : 'YYYY-MM-DD hh:mm:ss') : '')}
          list={mru.length && type === 'text' ? listId : undefined}
          onChange={(e) => onValue(e.target.value)}
        />
        {dateLike && (
          <button
            type="button"
            className={`er-raw${raw ? ' on' : ''}`}
            aria-pressed={raw}
            title={raw ? 'Use the date picker' : 'Type the value as text'}
            aria-label={`Type ${name} as text`}
            onClick={() => setRaw(!raw)}
          >
            <TextCursorInput size={13} />
          </button>
        )}
        {mru.length > 0 && type === 'text' && (
          <datalist id={listId}>
            {mru.map((v) => <option key={v} value={v} />)}
          </datalist>
        )}
      </span>
    );
  }

  return (
    <div className={`er-row ed-${editor}${error ? ' has-error' : ''}`} data-er-row={index}>
      <span className="er-name-cell">
        <label className="er-name mono" htmlFor={editor === 'bool' ? undefined : id} title={p.name}>{name}</label>
        <span className="er-meta">
          <span className="er-type mono" title={p.type}>{p.type || 'any'}</span>
          {dir !== 'in' && <span className={`er-dir dir-${dir}`}>{DIRECTION_LABEL[dir]}</span>}
        </span>
      </span>
      <span className="er-value">
        <span className="er-value-line">
          {field}
          {editor === 'multiline' && (
            <button
              type="button"
              className={`er-raw${area ? ' on' : ''}`}
              aria-pressed={area}
              aria-label={`${area ? 'Collapse' : 'Expand'} ${name} to a text area`}
              title={area ? 'Back to a single line' : 'Edit as multi-line text'}
              disabled={area && shown.includes('\n')}
              onClick={() => {
                refocus.current = true;
                setExpanded(!area);
              }}
            >
              <Rows3 size={13} />
            </button>
          )}
        </span>
        {error && <span id={`${id}-err`} className="er-field-error" role="alert">{error}</span>}
      </span>
      <span className="er-opts">
        <button
          type="button"
          className={`er-toggle${input.mode === 'null' ? ' on' : ''}`}
          aria-pressed={input.mode === 'null'}
          title={`Pass NULL for ${name}`}
          onClick={() => onMode(input.mode === 'null' ? 'value' : 'null')}
        >
          NULL
        </button>
        {p.hasDefault && (
          <button
            type="button"
            className={`er-toggle${input.mode === 'default' ? ' on' : ''}`}
            aria-pressed={input.mode === 'default'}
            title={`Use the default of ${name} (the argument is left out of the call)`}
            onClick={() => onMode(input.mode === 'default' ? 'value' : 'default')}
          >
            Default
          </button>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- preview

const KEYWORDS = /^(?:DECLARE|EXEC|EXECUTE|SELECT|FROM|AS|OUTPUT|OUT|BEGIN|END|CALL|NULL|DEFAULT|TABLE|INT|VARIADIC)$/i;
const TOKEN = /('(?:[^']|'')*')|(\[[^\]]*\]|"[^"]*")|([@:]\w+|\$\d+)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][\w$#]*\b)|(\s+|.)/g;

/** Light syntax colouring of the generated call (the text content stays exactly the SQL). */
export function highlightCall(sql: string): ReactNode[] {
  const out: ReactNode[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  let plain = '';
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  while ((m = TOKEN.exec(sql))) {
    const [text, str, quoted, bind, num, word] = m;
    const cls = str ? 'tk-str' : quoted ? 'tk-ident' : bind ? 'tk-bind' : num ? 'tk-num' : word && KEYWORDS.test(word) ? 'tk-kw' : null;
    if (!cls) {
      plain += text;
      continue;
    }
    flush();
    out.push(<span key={i++} className={cls}>{text}</span>);
  }
  flush();
  return out;
}

const SUMMARY_VALUE_MAX = 40;

function clip(s: string): string {
  return s.length > SUMMARY_VALUE_MAX ? `${s.slice(0, SUMMARY_VALUE_MAX - 1)}…` : s;
}

/**
 * One line that reads like the call with its values filled in: `EXEC [dbo].[Report] @Year = 2024, @Total OUT`.
 * (The SQL that runs holds bind placeholders; this is the human summary, the expanded view shows the real text.)
 */
export function callSummary(spec: RoutineSpec, inputs: readonly ParamInput[], call: RoutineCall): string {
  const pre = bindPrefix(spec);
  const args = argumentSummary(spec, inputs);
  const parts: string[] = [];
  const positional = spec.kind !== 'proc' && spec.dialect === 'tsql';
  spec.params.forEach((p, i) => {
    const a = args[i];
    const nm = `${pre}${a.name}`;
    const val = call.errors[i] ? '?' : clip(a.text);
    if (a.mode === 'output') parts.push(`${nm} OUT`);
    else if (positional) parts.push(a.mode === 'default' ? 'DEFAULT' : val);
    else if (a.mode === 'default') return; // omitted from the call
    else parts.push(`${nm} ${spec.dialect === 'tsql' ? '=' : '=>'} ${val}${p.direction === 'inout' ? ' OUT' : ''}`);
  });
  const name = routineName(spec);
  if (spec.kind === 'proc') {
    if (spec.dialect === 'tsql') return `EXEC ${name}${parts.length ? ` ${parts.join(', ')}` : ''}`;
    return `CALL ${name}(${parts.join(', ')})`;
  }
  return `SELECT ${name}(${parts.join(', ')})`;
}

/**
 * The call: a one-line summary bar ("EXEC [dbo].[Report] @Year = 2024") with Show SQL and Copy, expanding into a
 * scrollable, coloured block holding the SQL that runs.
 */
export function CallPreview({ spec, call, inputs, defaultOpen = false }: { spec: RoutineSpec; call: RoutineCall; inputs: readonly ParamInput[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const bodyId = useId();
  const summary = useMemo(() => callSummary(spec, inputs, call), [spec, inputs, call]);
  const copy = () => {
    void copyText(call.sql, 'Call copied');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className={`er-preview-wrap${open ? ' open' : ''}`}>
      <div className="er-preview-bar">
        <button type="button" className="er-expander" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)} title={open ? 'Hide the SQL' : 'Show the SQL that runs'}>
          <ChevronRight size={13} aria-hidden="true" />
          {open ? 'Hide SQL' : 'Show SQL'}
        </button>
        <code className="er-summary mono" aria-label="Call summary" title={summary}>{highlightCall(summary)}</code>
        <button type="button" className="er-copy" onClick={copy} title="Copy the call SQL" aria-label="Copy the call SQL">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && <pre id={bodyId} className="er-preview mono" aria-label="Generated SQL">{highlightCall(call.sql)}</pre>}
    </div>
  );
}

/** "@Year = 2024", "@Month = default": the arguments of a run, for the result page. */
export function argumentSummary(spec: RoutineSpec, inputs: readonly ParamInput[]): { name: string; text: string; mode: ParamInput['mode'] | 'output' }[] {
  return spec.params.map((p, i) => {
    const input = inputs[i] ?? initialInput(p);
    const name = bareParamName(p) || `$${i + 1}`;
    if (isOutputOnly(p)) return { name, text: 'output', mode: 'output' as const };
    if (input.mode === 'null') return { name, text: 'NULL', mode: 'null' as const };
    if (input.mode === 'default') return { name, text: 'default', mode: 'default' as const };
    const kind = paramKindOf(p.type, spec.dialect);
    const v = input.value;
    return { name, text: kind === 'string' || kind === 'guid' || kind === 'date' || kind === 'datetime' ? `'${v}'` : v || "''", mode: 'value' as const };
  });
}
