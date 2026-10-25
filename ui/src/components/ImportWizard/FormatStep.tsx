// Step 2: format options with a live preview (the engine re-reads the file after every change, debounced).
import { LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DATE_FORMAT_PRESETS, DELIMITERS, ENCODINGS } from './model';
import { PreviewGrid } from './PreviewGrid';
import type { SourceFormat, SourceOptions } from './types';
import type { Wizard } from './useWizard';

const FORMATS: { value: SourceFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'tsv', label: 'TSV (tab separated)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'json', label: 'JSON' },
  { value: 'ndjson', label: 'NDJSON' },
];

const DEFAULT_NULL_TOKENS = ['', 'NULL', 'null'];
const PRESET_DELIMITERS = new Set([',', ';', '\t', '|']);

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`iw-field${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FormatStep({ w }: { w: Wizard }) {
  const { s, setOpt } = w;
  const p = s.preview;
  const eff = (p?.options ?? {}) as Partial<SourceOptions>;
  const val = <K extends keyof SourceOptions>(k: K): SourceOptions[K] | undefined => (s.userOpts[k] ?? eff[k]) as SourceOptions[K] | undefined;
  const format = (val('format') ?? 'csv') as SourceFormat;
  const isText = format === 'csv' || format === 'tsv';
  const [customDelimiter, setCustomDelimiter] = useState(() => s.userOpts.delimiter !== undefined && !PRESET_DELIMITERS.has(s.userOpts.delimiter));

  const delimiter = s.userOpts.delimiter;
  const delimiterSelect = customDelimiter ? 'custom' : delimiter === undefined ? 'auto' : delimiter;
  const detectedDelimiter = eff.delimiter === '\t' ? 'tab' : eff.delimiter;

  const tokens = val('nullTokens') ?? DEFAULT_NULL_TOKENS;
  const emptyIsNull = tokens.includes('');
  const extraTokens = tokens.filter((t) => t !== '').join(', ');
  const setTokens = (empty: boolean, extras: string) => {
    const list = extras.split(',').map((t) => t.trim()).filter(Boolean);
    setOpt('nullTokens', [...(empty ? [''] : []), ...list]);
  };

  const dateFormats = val('dateFormats') ?? [];
  const toggleDate = (f: string) => setOpt('dateFormats', dateFormats.includes(f) ? dateFormats.filter((x) => x !== f) : [...dateFormats, f]);

  return (
    <section className="iw-step iw-format" aria-labelledby="iw-fmt-title">
      <h2 id="iw-fmt-title" className="iw-h">
        Format options
        {s.previewLoading && <LoaderCircle size={14} className="spin iw-spin" aria-label="Reading the file" />}
      </h2>
      <div className="iw-opts">
        <Field label="File format">
          <select className="input" value={format} onChange={(e) => setOpt('format', e.target.value as SourceFormat)} aria-label="File format">
            {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>

        {isText && (
          <>
            <Field label="Encoding">
              <select
                className="input"
                aria-label="Encoding"
                value={s.userOpts.encoding ?? 'auto'}
                onChange={(e) => setOpt('encoding', e.target.value === 'auto' ? undefined : e.target.value)}
              >
                {ENCODINGS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {s.userOpts.encoding === undefined && eff.encoding && <small className="iw-note">Detected: {eff.encoding}</small>}
            </Field>
            <Field label="Delimiter">
              <select
                className="input"
                aria-label="Delimiter"
                value={delimiterSelect}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setCustomDelimiter(true);
                    if (delimiter === undefined || PRESET_DELIMITERS.has(delimiter)) setOpt('delimiter', undefined);
                  } else {
                    setCustomDelimiter(false);
                    setOpt('delimiter', v === 'auto' ? undefined : v);
                  }
                }}
              >
                {DELIMITERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {customDelimiter && (
                <input
                  className="input iw-narrow"
                  aria-label="Custom delimiter"
                  maxLength={1}
                  value={delimiter && !PRESET_DELIMITERS.has(delimiter) ? delimiter : ''}
                  onChange={(e) => setOpt('delimiter', e.target.value || undefined)}
                />
              )}
              {!customDelimiter && delimiter === undefined && detectedDelimiter && <small className="iw-note">Detected: {detectedDelimiter}</small>}
            </Field>
            <Field label="Quote">
              <input className="input iw-narrow" aria-label="Quote character" maxLength={1} value={val('quote') ?? '"'} onChange={(e) => setOpt('quote', e.target.value)} />
            </Field>
            <Field label="Escape">
              <select className="input" aria-label="Escape character" value={s.userOpts.escape ?? ''} onChange={(e) => setOpt('escape', e.target.value || undefined)}>
                <option value="">Doubled quote ("")</option>
                <option value="\">Backslash (\)</option>
              </select>
            </Field>
          </>
        )}

        {format === 'xlsx' && (
          <Field label="Sheet">
            <select
              className="input"
              aria-label="Sheet"
              value={val('sheet') ?? p?.sheets?.[0] ?? ''}
              onChange={(e) => setOpt('sheet', e.target.value || undefined)}
              disabled={!p?.sheets?.length}
            >
              {(p?.sheets ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        )}

        {format === 'json' && (
          <Field label="JSON path of the array">
            <input
              className="input"
              aria-label="JSON path"
              list="iw-json-paths"
              placeholder="data.items (empty: the top-level array)"
              value={s.userOpts.jsonPath ?? eff.jsonPath ?? ''}
              onChange={(e) => setOpt('jsonPath', e.target.value || undefined)}
            />
            <datalist id="iw-json-paths">
              {(p?.jsonPaths ?? []).map((j) => <option key={j} value={j} />)}
            </datalist>
          </Field>
        )}

        {format !== 'json' && format !== 'ndjson' && (
          <>
            <Field label="Skip rows at the top">
              <input
                className="input iw-narrow"
                type="number"
                min={0}
                aria-label="Skip rows"
                value={val('skipRows') ?? 0}
                onChange={(e) => setOpt('skipRows', Math.max(0, Number(e.target.value) || 0) || undefined)}
              />
            </Field>
            <label className="check iw-check">
              <input type="checkbox" checked={val('hasHeader') ?? true} onChange={(e) => setOpt('hasHeader', e.target.checked)} />
              First row contains the column names
            </label>
          </>
        )}
        <label className="check iw-check">
          <input type="checkbox" checked={val('trim') ?? false} onChange={(e) => setOpt('trim', e.target.checked || undefined)} />
          Trim spaces around text
        </label>
      </div>

      <details className="iw-more">
        <summary>NULL, number and date formats</summary>
        <div className="iw-opts">
          <label className="check iw-check">
            <input type="checkbox" checked={emptyIsNull} onChange={(e) => setTokens(e.target.checked, extraTokens)} />
            Empty text is NULL
          </label>
          <Field label="More NULL texts (comma separated)">
            <input className="input" aria-label="NULL texts" value={extraTokens} onChange={(e) => setTokens(emptyIsNull, e.target.value)} />
          </Field>
          <Field label="Date and time formats">
            <input
              className="input"
              aria-label="Date formats"
              placeholder="empty: ISO 8601, e.g. dd/MM/yyyy, yyyy-MM-dd HH:mm"
              value={dateFormats.join(', ')}
              onChange={(e) => {
                const list = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                setOpt('dateFormats', list.length ? list : undefined);
              }}
            />
            <span className="iw-chips">
              {DATE_FORMAT_PRESETS.map((f) => (
                <button key={f} type="button" className="iw-chip" aria-pressed={dateFormats.includes(f)} onClick={() => toggleDate(f)}>{f}</button>
              ))}
            </span>
          </Field>
          <Field label="Decimal separator">
            <select className="input iw-narrow" aria-label="Decimal separator" value={val('decimalSeparator') ?? '.'} onChange={(e) => setOpt('decimalSeparator', e.target.value === '.' ? undefined : e.target.value)}>
              <option value=".">. (dot)</option>
              <option value=",">, (comma)</option>
            </select>
          </Field>
          <Field label="Thousands separator">
            <select className="input iw-narrow" aria-label="Thousands separator" value={val('thousandsSeparator') ?? ''} onChange={(e) => setOpt('thousandsSeparator', e.target.value || undefined)}>
              <option value="">None</option>
              <option value=",">, (comma)</option>
              <option value=".">. (dot)</option>
              <option value=" ">(space)</option>
            </select>
          </Field>
          <label className="check iw-check">
            <input type="checkbox" checked={val('normalizeDigits') ?? true} onChange={(e) => setOpt('normalizeDigits', e.target.checked ? undefined : false)} />
            Read Persian / Arabic digits as numbers
          </label>
        </div>
      </details>

      {s.previewError && <div className="iw-msg iw-error" role="alert">{s.previewError}</div>}
      {p?.warnings.map((m, i) => <div key={i} className="iw-msg iw-warn" role="status">{m}</div>)}
      <PreviewGrid preview={p} loading={s.previewLoading} page={s.previewPage} onPage={w.setPreviewPage} />
    </section>
  );
}
