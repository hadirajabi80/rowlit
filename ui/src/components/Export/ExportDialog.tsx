// Export dialog (lazy chunk): which rows (loaded, selection, current filter & sort, all records, re-run of a console
// query) with their counts, the format and its options, the file, and "open after export". Server-side scopes run as
// engine jobs with progress and cancel; the dialog can be closed while one runs (it finishes with a toast).
import { Download, FolderOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dialect, ExportFormat } from '../../api/types';
import { EXPORT_EXT, EXPORT_FILTER_NAME } from '../../lib/exportFormats';
import { getPlatform } from '../../platform';
import { Dialog } from '../common/Dialog';
import { Select, type SelectOption } from '../common/Select';
import { cleanPastedPath } from '../ImportWizard/files';
import { DATE_PRESETS } from './dateFormat';
import {
  DEFAULT_SETTINGS, defaultNullText, dirOf, EXPORT_LABEL, exportFileName, isBinaryFormat, isServerScope, isTextFormat, joinPath, loadPrefs, nullTextOf, savePrefs,
  scopeCountText, supportsDateFormat, supportsHeader, supportsNullText, withFormatExtension,
} from './model';
import { announceOutcome, runExport } from './run';
import type { ExportScopeId, ExportSettings, ExportSource, ScopeOption } from './types';
import './export.css';

const FORMATS: ExportFormat[] = ['csv', 'tsv', 'xlsx', 'json', 'sql-insert', 'markdown'];
const FORMAT_OPTIONS: SelectOption<ExportFormat>[] = FORMATS.map((f) => ({ value: f, label: EXPORT_LABEL[f] }));
const DELIMITERS: SelectOption[] = [
  { value: ',', label: 'Comma ( , )' }, { value: ';', label: 'Semicolon ( ; )' }, { value: '\t', label: 'Tab' }, { value: '|', label: 'Pipe ( | )' },
];
const ENCODINGS: SelectOption[] = [{ value: 'utf8', label: 'UTF-8' }, { value: 'bom', label: 'UTF-8 with BOM (Excel-friendly)' }];
const CUSTOM_DATE = '__custom';
const DIALECTS: SelectOption[] = [
  { value: '', label: 'Same as the connection' },
  { value: 'tsql', label: 'SQL Server (T-SQL)' }, { value: 'plsql', label: 'Oracle (PL/SQL)' }, { value: 'pgsql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL / MariaDB' }, { value: 'sqlite', label: 'SQLite' }, { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'snowflake', label: 'Snowflake' }, { value: 'cql', label: 'Cassandra (CQL)' },
];

interface Counts {
  [id: string]: { count: number | null; kind: 'exact' | 'estimate'; loading: boolean };
}

export function ExportDialog({ source, onClose }: { source: ExportSource; onClose: () => void }) {
  const platform = getPlatform();
  const prefs = useMemo(() => loadPrefs(), []);
  const [settings, setSettings] = useState<ExportSettings>(() => {
    const { dir: _dir, ...rest } = prefs; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...DEFAULT_SETTINGS, ...rest };
  });
  const [scope, setScope] = useState<ExportScopeId>(() => source.scopes.find((s) => s.id === source.initialScope && !s.disabled)?.id ?? source.scopes.find((s) => !s.disabled)?.id ?? 'loaded');
  const [path, setPath] = useState(() => (prefs.dir && platform.hasFileSystem ? joinPath(prefs.dir, exportFileName(source.baseName, prefs.format ?? 'csv')) : ''));
  const [customDate, setCustomDate] = useState(() => !!prefs.dateFormat && !DATE_PRESETS.some((p) => p.value === prefs.dateFormat));
  const [counts, setCounts] = useState<Counts>({});
  const [run, setRun] = useState<{ rows: number; canceling: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const set = (p: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...p }));
  const format = settings.format;
  const server = isServerScope(scope);
  const showPath = platform.hasFileSystem || server;
  const running = run !== null;

  // Counts that are not known yet: the filter's COUNT(*) and the table estimate run once, in the background.
  useEffect(() => {
    let live = true;
    const put = (id: string, v: Counts[string]) => live && setCounts((c) => ({ ...c, [id]: v }));
    for (const s of source.scopes) {
      if (s.disabled || s.count !== null) continue;
      if (s.estimate) {
        put(s.id, { count: null, kind: 'estimate', loading: true });
        s.estimate().then((n) => put(s.id, { count: n, kind: 'estimate', loading: false }), () => put(s.id, { count: null, kind: 'estimate', loading: false }));
      } else if (s.countNow && !s.countOnRequest) {
        put(s.id, { count: null, kind: 'exact', loading: true });
        s.countNow().then((n) => put(s.id, { count: n, kind: 'exact', loading: false }), () => put(s.id, { count: null, kind: 'exact', loading: false }));
      }
    }
    return () => { live = false; };
  }, [source]);

  const countOf = (s: ScopeOption) => counts[s.id] ?? { count: s.count, kind: s.countKind, loading: false };
  const countExactly = (s: ScopeOption) => {
    setCounts((c) => ({ ...c, [s.id]: { count: null, kind: 'exact', loading: true } }));
    s.countNow?.().then(
      (n) => mounted.current && setCounts((c) => ({ ...c, [s.id]: { count: n, kind: 'exact', loading: false } })),
      () => mounted.current && setCounts((c) => ({ ...c, [s.id]: { count: null, kind: 'exact', loading: false } })),
    );
  };

  const changeFormat = (f: ExportFormat) => {
    setSettings((s) => ({ ...s, format: f, nullText: s.nullText !== null && s.nullText === defaultNullText(s.format) ? null : s.nullText }));
    setPath((p) => (p ? withFormatExtension(p, f) : p));
  };

  const browse = async (): Promise<string | null> => {
    const chosen = await platform.showSaveDialog({
      title: 'Export to file', defaultPath: path || exportFileName(source.baseName, format),
      filters: [{ name: EXPORT_FILTER_NAME[format], extensions: [EXPORT_EXT[format]] }],
    });
    if (chosen) setPath(chosen);
    return chosen;
  };

  const go = async () => {
    if (running) return;
    setError(null);
    let target: string | null = path.trim() || null;
    if (server && !target) {
      if (platform.hasFileSystem) target = await browse();
      else setError('Type the full path of the file to write on this computer.');
      if (!target) return;
    }
    savePrefs(settings, target ? dirOf(target) || prefs.dir : prefs.dir);
    setRun({ rows: 0, canceling: false });
    const out = await runExport({
      source, scope, settings, path: target,
      onProgress: (rows) => mounted.current && setRun((r) => (r ? { ...r, rows } : r)),
      onCancelable: (cancel) => { cancelRef.current = cancel; },
    });
    cancelRef.current = null;
    if (out.status === 'error' && mounted.current) {
      setError(out.error ?? 'The export failed.');
      setRun(null);
      return;
    }
    announceOutcome(out, { openAfter: settings.openAfter });
    if (mounted.current) {
      setRun(null);
      if (out.status === 'ok') onClose();
    }
  };

  const cancel = () => {
    setRun((r) => (r ? { ...r, canceling: true } : r));
    cancelRef.current?.();
  };

  const chosen = source.scopes.find((s) => s.id === scope);
  const total = chosen ? countOf(chosen).count : null;
  const pct = run && total ? Math.min(99, Math.round((run.rows / total) * 100)) : null;
  const dateValue = customDate ? CUSTOM_DATE : settings.dateFormat;
  const dateOptions: SelectOption[] = [...DATE_PRESETS, { value: CUSTOM_DATE, label: 'Custom pattern…' }];

  return (
    <Dialog
      title={`Export ${source.title}`}
      ariaLabel={`Export ${source.title}`}
      width={580}
      className="ex-dialog"
      onClose={onClose}
      onSubmit={() => void go()}
      footer={
        run ? (
          <>
            <button className="btn" onClick={onClose} title="The export keeps running; you are told when it ends">Hide</button>
            {server && <button className="btn" onClick={cancel} disabled={run.canceling}>{run.canceling ? 'Cancelling…' : 'Cancel export'}</button>}
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => void go()} disabled={!chosen || !!chosen.disabled}>
              <Download size={14} aria-hidden /> Export
            </button>
          </>
        )
      }
    >
      <fieldset className="ex-scopes" role="radiogroup" aria-label="Rows to export" disabled={running}>
        {source.scopes.map((s) => {
          const c = countOf(s);
          const text = scopeCountText({ count: c.count, countKind: c.kind });
          return (
            <label key={s.id} className={`ex-scope${scope === s.id ? ' on' : ''}${s.disabled ? ' off' : ''}`} data-testid={`ex-scope-${s.id}`}>
              <input type="radio" name="ex-scope" checked={scope === s.id} disabled={!!s.disabled} onChange={() => setScope(s.id)} />
              <span className="ex-scope-main">
                <span className="ex-scope-head">
                  <span className="ex-scope-label">{s.label}</span>
                  <span className="ex-scope-count" data-testid={`ex-count-${s.id}`}>
                    {c.loading ? <LoaderCircle size={11} className="spin" aria-label="Counting" /> : text}
                    {!c.loading && c.count === null && s.countNow && s.countOnRequest && !s.disabled && (
                      <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); countExactly(s); }}>count</button>
                    )}
                    {!c.loading && c.kind === 'estimate' && c.count !== null && s.countNow && (
                      <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); countExactly(s); }} title="Run COUNT(*) for the exact number">exact</button>
                    )}
                  </span>
                </span>
                <span className="ex-scope-hint">{s.disabled ?? s.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="form-grid ex-form">
        <label className="form-label" id="ex-format-label">Format</label>
        <Select aria-labelledby="ex-format-label" value={format} options={FORMAT_OPTIONS} onChange={changeFormat} disabled={running} />

        {format === 'csv' && (
          <>
            <span className="form-label" id="ex-delim-label">Delimiter</span>
            <Select aria-labelledby="ex-delim-label" value={settings.delimiter} options={DELIMITERS} onChange={(v) => set({ delimiter: v })} disabled={running} />
          </>
        )}
        {supportsHeader(format) && (
          <>
            <span className="form-label">Header</span>
            <label className="check"><input type="checkbox" checked={settings.header} disabled={running} onChange={(e) => set({ header: e.target.checked })} /> First row holds the column names</label>
          </>
        )}
        {isTextFormat(format) && (
          <>
            <span className="form-label" id="ex-enc-label">Encoding</span>
            <Select aria-labelledby="ex-enc-label" value={settings.bom ? 'bom' : 'utf8'} options={ENCODINGS} onChange={(v) => set({ bom: v === 'bom' })} disabled={running} />
          </>
        )}
        {supportsNullText(format) && (
          <>
            <label className="form-label" htmlFor="ex-null">NULL as</label>
            <input id="ex-null" className="input" dir="auto" spellCheck={false} value={nullTextOf(settings)} placeholder="(empty)" disabled={running} onChange={(e) => set({ nullText: e.target.value })} />
          </>
        )}
        {supportsDateFormat(format) && (
          <>
            <span className="form-label" id="ex-date-label">Dates</span>
            <div className="ex-date">
              <Select
                aria-labelledby="ex-date-label" value={dateValue} options={dateOptions} disabled={running}
                onChange={(v) => {
                  setCustomDate(v === CUSTOM_DATE);
                  if (v !== CUSTOM_DATE) set({ dateFormat: v });
                }}
              />
              {customDate && (
                <input
                  className="input mono" aria-label="Date pattern" placeholder="yyyy-MM-dd HH:mm:ss" spellCheck={false} disabled={running}
                  value={settings.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}
                />
              )}
            </div>
          </>
        )}
        {format === 'sql-insert' && (
          <>
            <label className="form-label" htmlFor="ex-table">Table name</label>
            <input id="ex-table" className="input mono" spellCheck={false} value={settings.tableName} placeholder={source.defaultTable} disabled={running} onChange={(e) => set({ tableName: e.target.value })} />
            <span className="form-label" id="ex-dialect-label">SQL dialect</span>
            <Select
              aria-labelledby="ex-dialect-label" value={settings.sqlDialect ?? ''} options={DIALECTS} disabled={running}
              onChange={(v) => set({ sqlDialect: (v || null) as Dialect | null })}
            />
          </>
        )}
        {format === 'xlsx' && (
          <>
            <label className="form-label" htmlFor="ex-sheet">Sheet name</label>
            <input id="ex-sheet" className="input" dir="auto" spellCheck={false} maxLength={31} value={settings.sheetName} placeholder={source.baseName} disabled={running} onChange={(e) => set({ sheetName: e.target.value })} />
          </>
        )}

        {showPath && (
          <>
            <label className="form-label" htmlFor="ex-path">{platform.hasFileSystem ? 'Save to' : 'Save to (path)'}</label>
            <div className="file-input">
              <input
                id="ex-path" className="input flex-1" spellCheck={false} dir="ltr" value={path} disabled={running}
                placeholder={platform.hasFileSystem ? 'Choose a file…' : 'Full path on this computer'} onChange={(e) => setPath(cleanPastedPath(e.target.value))}
              />
              {platform.hasFileSystem && (
                <button className="btn" type="button" onClick={() => void browse()} disabled={running}><FolderOpen size={14} aria-hidden /> Browse…</button>
              )}
            </div>
          </>
        )}
        {platform.openPath && (
          <>
            <span className="form-label" />
            <label className="check"><input type="checkbox" checked={settings.openAfter} disabled={running} onChange={(e) => set({ openAfter: e.target.checked })} /> Open the file after export</label>
          </>
        )}
      </div>

      {!isBinaryFormat(format) && settings.bom && format !== 'json' && format !== 'sql-insert' && (
        <p className="form-help">The byte order mark makes Excel read UTF-8 text (Persian, Arabic, …) correctly.</p>
      )}
      {run && (
        <div className="ex-progress" role="progressbar" aria-label="Export progress" aria-valuenow={pct ?? undefined} aria-valuetext={`${run.rows.toLocaleString('en-US')} rows written`}>
          <div className="ex-bar"><span className={pct === null ? 'indeterminate' : undefined} style={pct === null ? undefined : { width: `${pct}%` }} /></div>
          <em>{server ? `${run.rows.toLocaleString('en-US')} rows written${pct !== null ? ` (${pct}%)` : ''}` : 'Preparing the file…'}</em>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
