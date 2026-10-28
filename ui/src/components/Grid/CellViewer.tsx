import { Check, Copy, Download, FolderOpen, LoaderCircle, Pencil, WrapText, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import type { CellValue, ColumnInfo, Dialect } from '../../api/types';
import { copyText } from '../../app/actions';
import { displayShortcut } from '../../commands/keys';
import { base64Length, base64ToHex, formatBytes, isBinary, isPartial, isTruncated, prettyJsonText, prettyXml, rawText } from '../../lib/format';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import type { EffectiveTheme } from '../../theme/useTheme';
import { base64ToBytes, bytesToText, imageDataUrl, readFileBytes, svgDataUrl, utf8ToBase64 } from './cellViewer/binary';
import { EditorView } from './cellViewer/EditorView';
import { ImageView } from './cellViewer/ImageView';
import {
  MAX_EDIT_CHARS, MAX_FILE_BYTES, MODE_LABEL, binaryValue, buildApplyValue, checkDraft, describeSource, isJsonDocument, isTextMode, looksLikeXml, saveTarget,
  type ViewerMode, type ViewerSource,
} from './cellViewer/modes';
import './cellViewer/cellViewer.css';
import { focusGrid } from './controller';

/** A request from a command (Shift+Enter, "Save cell to file…", "Load cell from file…"): `nonce` makes each one new. */
export interface ViewerRequest {
  kind: 'edit' | 'save' | 'load';
  nonce: number;
}

interface Props {
  executionId: string | null;
  resultSetId: number;
  sourceRow: number;
  col: number;
  column: ColumnInfo;
  value: CellValue;
  onClose: () => void;
  /** Distinguishes cells that have no engine row (the pending inserts); part of what resets the viewer. */
  cellKey?: string;
  dialect?: Dialect;
  theme?: EffectiveTheme;
  /** Present when the cell can be written: Apply puts the value into the grid's pending edits, like typing it. */
  onApply?: (value: CellValue) => void;
  /** The cell has a pending edit (shown as a badge). */
  edited?: boolean;
  request?: ViewerRequest | null;
  /** Called once the request has been carried out, so the host drops it (a later remount must not repeat it). */
  onRequestDone?: () => void;
  /** Focus returns to this grid when an edit ends. */
  gridKey?: string;
}

type Full = { kind: 'string' | 'binary'; value: string; len: number };

const HEX_BYTES = 64 * 1024;
/** Binary values up to this size are fetched whole to draw an image. */
const MAX_AUTO_IMAGE_BYTES = 8 * 1024 * 1024;

/** Side panel showing one cell's full value: Text | JSON | XML | Hex | Image, editable when the grid is. */
export function CellViewer({ executionId, resultSetId, sourceRow, col, column, value, onClose, cellKey, dialect = 'sqlite', theme = 'light', onApply, edited, request, onRequestDone, gridKey }: Props) {
  const [full, setFull] = useState<Full | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [pretty, setPretty] = useState(true);
  const [picked, setPicked] = useState<ViewerMode | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [initial, setInitial] = useState('');
  const [applyError, setApplyError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const partial = isPartial(value);
  const cell = `${cellKey ?? ''}|${executionId}|${resultSetId}|${sourceRow}|${col}`;

  useEffect(() => {
    setFull(null);
    setError(null);
    setPicked(null);
    setEditing(false);
    setApplyError(null);
  }, [cell]);

  const loadFull = async (): Promise<Full | null> => {
    if (!executionId) return null;
    setLoading(true);
    setError(null);
    try {
      const f = await api.cell(executionId, resultSetId, sourceRow, col);
      setFull(f);
      return f;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // The full value only stands in for the cell's prefix: once the cell holds a pending edit, that edit is the value.
  const fullNow = partial ? full : null;
  const source = useMemo<ViewerSource>(() => {
    if (value === null) return { type: 'null' };
    if (fullNow) return fullNow.kind === 'binary' ? { type: 'binary', b64: fullNow.value, len: fullNow.len } : { type: 'text', text: fullNow.value };
    if (isBinary(value)) return { type: 'binary', b64: value.$bin, len: value.len };
    return { type: 'text', text: rawText(value) ?? '' };
  }, [value, fullNow]);
  const info = useMemo(() => describeSource(source, column.kind), [source, column.kind]);
  const unloaded = partial && !fullNow;
  const mode: ViewerMode = picked && info.modes.includes(picked) ? picked : info.auto;
  const total = isBinary(value) || isTruncated(value) ? value.len : null;

  // Auto-fetch moderately sized truncated text, and the whole bytes of an image.
  useEffect(() => {
    if (!partial || !executionId) return;
    if (isTruncated(value) && value.len <= 4 * 1024 * 1024) void loadFull();
    else if (isBinary(value) && info.imageMime && value.len <= MAX_AUTO_IMAGE_BYTES) void loadFull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partial, executionId, resultSetId, sourceRow, col]);

  /** The text the viewer shows for a text mode. */
  const shownText = useMemo(() => renderText(info.text ?? '', mode, pretty), [info.text, mode, pretty]);

  const hexText = useMemo(() => {
    if (mode !== 'hex') return '';
    return hexDump(source.type === 'binary' ? source.b64 : source.type === 'text' ? utf8ToBase64(source.text) : '');
  }, [mode, source]);

  const display = mode === 'hex' ? hexText : shownText;
  const language = mode === 'hex' ? 'hex' : mode;
  const bytesLen = source.type === 'binary' ? source.len : null;
  const chars = info.text !== null ? info.text.length : null;
  const words = useMemo(() => (info.text && mode !== 'hex' && info.text.length <= 1_000_000 ? (info.text.match(/\S+/g)?.length ?? 0) : null), [info.text, mode]);

  // ---- editing

  const canEditText = !!onApply;
  const editMode: ViewerMode = isTextMode(mode) ? mode : info.modes.find(isTextMode) ?? 'text';
  const textEditable = source.type === 'null' || info.text !== null;
  const stopEditing = () => {
    setEditing(false);
    setApplyError(null);
    if (gridKey) focusGrid(gridKey);
  };

  const tooLarge = `This value is too large to edit here (over ${formatBytes(MAX_EDIT_CHARS)}).`;
  const startEdit = async (fromRequest = false) => {
    if (!onApply) return;
    let inf = info;
    if (unloaded) {
      // A truncated text is fetched whole first (up to the edit limit): the viewer edits what the cell holds, not a prefix.
      if (!executionId || (total !== null && total > MAX_EDIT_CHARS)) {
        setError(total !== null && total > MAX_EDIT_CHARS ? tooLarge : 'Load the full value to edit it.');
        return;
      }
      const f = await loadFull();
      if (!f) return;
      inf = describeSource(f.kind === 'binary' ? { type: 'binary', b64: f.value, len: f.len } : { type: 'text', text: f.value }, column.kind);
    }
    if (source.type !== 'null' && inf.text === null) {
      // Shift+Enter on an image or other bytes just shows the value (it has no text to edit): no complaint.
      if (!fromRequest) setError('This binary value is not text. Use "Load from file…" to replace it.');
      return;
    }
    if ((inf.text?.length ?? 0) > MAX_EDIT_CHARS) {
      setError(tooLarge);
      return;
    }
    const m = isTextMode(mode) && inf.modes.includes(mode) ? mode : inf.modes.find(isTextMode) ?? 'text';
    const base = renderText(inf.text ?? '', m, pretty);
    setError(null);
    setApplyError(null);
    setInitial(base);
    setDraft(base);
    setPicked(m);
    setEditing(true);
  };

  const deferredDraft = useDeferredValue(draft);
  const check = useMemo(() => (editing ? checkDraft(deferredDraft, column, editMode) : { error: null, warning: null, problem: null }), [editing, deferredDraft, column, editMode]);
  const apply = () => {
    if (!onApply) return;
    const r = buildApplyValue(draft, column, dialect, editMode);
    if (!r.ok) {
      setApplyError(r.error);
      return;
    }
    setPicked(null);
    onApply(r.value);
    stopEditing();
  };
  const setNull = () => {
    onApply?.(null);
    setPicked(null);
    stopEditing();
  };
  const format = () => {
    try {
      if (editMode === 'json' && !checkDraft(draft, { ...column, kind: 'json' }, 'json').error) setDraft(prettyJsonText(draft.trim()));
      else if (editMode === 'xml' && looksLikeXml(draft)) setDraft(prettyXml(draft.trim()));
    } catch {
      /* leave the text as it is */
    }
  };

  // ---- files

  const saveToFile = async () => {
    let src: ViewerSource = source;
    let inf = info;
    if (unloaded) {
      const f = await loadFull();
      if (!f) return;
      src = f.kind === 'binary' ? { type: 'binary', b64: f.value, len: f.len } : { type: 'text', text: f.value };
      inf = describeSource(src, column.kind);
    }
    if (src.type === 'null') {
      setError('The value is NULL: there is nothing to save.');
      return;
    }
    const asBytes = src.type === 'binary' && (mode === 'hex' || mode === 'image' || inf.text === null);
    const t = saveTarget(column.name || 'value', mode, inf, src.type === 'binary');
    const content = asBytes && src.type === 'binary' ? new Blob([base64ToBytes(src.b64) as BlobPart], { type: t.mime }) : new Blob([inf.text ?? (src.type === 'text' ? src.text : '')], { type: t.mime });
    try {
      const where = await getPlatform().saveFile({ suggestedName: t.name, content, mime: t.mime });
      if (where) toast('success', `Saved ${t.name}`, where === t.name ? undefined : where);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file || !onApply) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }
    try {
      const bytes = await readFileBytes(file);
      setError(null);
      if (column.kind === 'binary') {
        setPicked(null);
        onApply(binaryValue(bytes));
        return;
      }
      const text = bytesToText(bytes);
      if (text === null) {
        setError(`${file.name} is not a text file (UTF-8). This column holds text.`);
        return;
      }
      if (text.length > MAX_EDIT_CHARS) {
        setError(`${file.name} is too large to load here (over ${formatBytes(MAX_EDIT_CHARS)} of text).`);
        return;
      }
      // Text goes into the editor first: Apply decides.
      const base = isTextMode(mode) ? shownText : (info.text ?? '');
      setInitial(base);
      setDraft(text);
      setPicked(isTextMode(mode) ? mode : editMode);
      setApplyError(null);
      setEditing(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Requests from the commands. The refs hold the latest closures: the request runs once per nonce.
  const run = useRef({ startEdit, saveToFile, pick: () => fileInput.current?.click() });
  run.current = { startEdit, saveToFile, pick: () => fileInput.current?.click() };
  const nonce = request?.nonce;
  useEffect(() => {
    if (!request) return;
    if (request.kind === 'edit') void run.current.startEdit(true);
    else if (request.kind === 'save') void run.current.saveToFile();
    else run.current.pick();
    onRequestDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const imageSrc = useMemo(() => {
    if (mode !== 'image' || unloaded || !info.imageMime) return null;
    if (info.imageMime === 'image/svg+xml') return svgDataUrl(info.text ?? '');
    return source.type === 'binary' ? imageDataUrl(info.imageMime, source.b64) : null;
  }, [mode, unloaded, info.imageMime, info.text, source]);

  const infoText = useMemo(() => {
    if (value === null && source.type === 'null') return 'NULL';
    if (source.type === 'binary') {
      const have = base64Length(source.b64);
      const kind = info.imageMime ? `${info.imageMime === 'image/svg+xml' ? 'SVG' : info.imageMime.slice(6).toUpperCase()} image · ` : '';
      return `${kind}${formatBytes(source.len)}${have < source.len ? ` (showing ${formatBytes(have)})` : ''}`;
    }
    const len = unloaded && total !== null ? total : (chars ?? 0);
    return `${len.toLocaleString()} chars${unloaded ? ' (truncated)' : ''}`;
  }, [value, source, info.imageMime, unloaded, total, chars]);

  const canSave = value !== null;
  const hasText = language === 'json' || language === 'xml';
  const showModes = info.modes.length > 1;

  return (
    <div className="cell-viewer" aria-label="Value viewer">
      <div className="panel-header">
        <span className="panel-title" title={column.dbType}>
          {column.name} <span className="muted">{column.dbType}</span>
        </span>
        <div className="panel-actions">
          <button className={`icon-btn${wrap ? ' on' : ''}`} title="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <WrapText size={14} />
          </button>
          <button className="icon-btn" title="Copy value" aria-label="Copy value" onClick={() => void copyText(fullNow?.kind === 'string' ? fullNow.value : rawText(value) ?? '')}>
            <Copy size={14} />
          </button>
          <button className="icon-btn" title="Save the value to a file…" aria-label="Save to file" disabled={!canSave} onClick={() => void saveToFile()}>
            <Download size={14} />
          </button>
          {onApply && (
            <>
              <button className="icon-btn" title={column.kind === 'binary' ? 'Replace the value with a file…' : 'Load the value from a text file…'} aria-label="Load from file" onClick={() => fileInput.current?.click()}>
                <FolderOpen size={14} />
              </button>
              <button
                className={`icon-btn${editing ? ' on' : ''}`}
                title={textEditable ? `Edit the value (${displayShortcut('Shift+Enter')})` : 'This binary value is not text: load it from a file instead'}
                aria-label="Edit value"
                aria-pressed={editing}
                disabled={!canEditText || (!textEditable && !editing)}
                onClick={() => (editing ? stopEditing() : void startEdit())}
              >
                <Pencil size={14} />
              </button>
            </>
          )}
          <button className="icon-btn" title="Close viewer" aria-label="Close viewer" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      {onApply && (
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          aria-label="Value file"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void onFilePicked(f);
          }}
        />
      )}
      {showModes && (
        <div className="segmented cell-viewer-modes" role="group" aria-label="View as">
          {info.modes.filter((m) => !editing || isTextMode(m)).map((m) => (
            <button key={m} className={m === (editing ? editMode : mode) ? 'on' : undefined} aria-pressed={m === (editing ? editMode : mode)} onClick={() => setPicked(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <div className="cell-viewer-meta">
        <span>{infoText}</span>
        {words !== null && !editing && <span>{words.toLocaleString()} words{bytesLen === null ? ' · UTF-8' : ''}</span>}
        {edited && <span className="cell-viewer-badge" title="Not saved yet: Save pending changes writes it">Edited</span>}
        {hasText && !editing && (
          <label className="check sm">
            <input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> Pretty {language.toUpperCase()}
          </label>
        )}
        {unloaded && executionId && (
          <button className="btn btn-xs" onClick={() => void loadFull()} disabled={loading}>
            {loading && <LoaderCircle size={12} className="spin" />} Load full value
          </button>
        )}
      </div>
      {error && <div className="cell-viewer-error" role="alert">{error}</div>}
      {editing ? (
        <div className="cell-viewer-edit" onKeyDown={(e) => e.key === 'Escape' && !e.defaultPrevented && stopEditing()}>
          <EditorView
            value={draft}
            onChange={setDraft}
            language={editMode}
            ariaLabel={`Edit ${column.name}`}
            theme={theme}
            problem={check.problem}
            onSubmit={() => !check.error && apply()}
            autoFocus
          />
          {(check.error || applyError) && <div className="cell-viewer-error" role="alert">{check.error ?? applyError}</div>}
          {!check.error && check.warning && <div className="cell-viewer-warn">{check.warning}</div>}
          <div className="cell-viewer-edit-actions">
            {(editMode === 'json' || editMode === 'xml') && (
              <button className="btn btn-xs" onClick={format} disabled={!draft.trim()} title={`Format the ${MODE_LABEL[editMode]}`}>Format</button>
            )}
            {column.nullable && <button className="btn btn-xs" onClick={setNull} title="Set the cell to NULL">Set NULL</button>}
            <span className="spacer" />
            <button className="btn btn-xs" onClick={stopEditing}>Cancel</button>
            <button className="btn btn-xs btn-primary" onClick={apply} disabled={!!check.error || draft === initial} title={`Put the value into the pending changes (${displayShortcut('Mod+Enter')})`}>
              <Check size={12} /> Apply
            </button>
          </div>
        </div>
      ) : value === null ? (
        <div className="cell-viewer-null">NULL</div>
      ) : mode === 'image' ? (
        unloaded ? (
          <div className="cell-viewer-null">{loading ? 'Loading the image…' : 'Load the full value to see the image.'}</div>
        ) : imageSrc ? (
          <ImageView key={imageSrc} src={imageSrc} alt={column.name} />
        ) : (
          <div className="cell-viewer-error">The image could not be drawn. Use the Hex view.</div>
        )
      ) : (
        <>
          <pre className={`cell-viewer-text${wrap ? ' wrap' : ''} lang-${language}`} dir={language === 'hex' ? undefined : 'auto'}>{display}</pre>
          {mode === 'hex' && bytesLen !== null && bytesLen > HEX_BYTES && <div className="cell-viewer-note">Showing the first {formatBytes(HEX_BYTES)}. Save to file to get all {formatBytes(bytesLen)}.</div>}
        </>
      )}
    </div>
  );
}

/** The text a text mode shows: JSON / XML indented when 'pretty' is on, else as stored. */
function renderText(t: string, mode: ViewerMode, pretty: boolean): string {
  if (!pretty) return t;
  if (mode === 'json') return isJsonDocument(t) ? prettyJsonText(t.trim()) : t;
  if (mode === 'xml') return looksLikeXml(t) ? prettyXml(t.trim()) : t;
  return t;
}

function hexDump(b64: string): string {
  const hex = base64ToHex(b64, HEX_BYTES);
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 32) {
    const chunk = hex.slice(i, i + 32);
    const bytes = chunk.match(/.{2}/g) ?? [];
    const ascii = bytes.map((h) => {
      const c = parseInt(h, 16);
      return c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
    });
    lines.push(`${(i / 2).toString(16).padStart(8, '0')}  ${bytes.join(' ').padEnd(47)}  ${ascii.join('')}`);
  }
  return lines.join('\n');
}
