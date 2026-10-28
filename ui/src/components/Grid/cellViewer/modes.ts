// Which modes the value viewer offers for a cell (Text | JSON | XML | Hex | Image), how a draft is checked, and how it
// becomes the cell value that goes into the pending edit buffer.
import type { CellValue, ColumnInfo, ColumnKind, Dialect } from '../../../api/types';
import { base64ToBytes, looksLikeSvg, sniffImageMime, type ImageMime } from '../../../lib/format';
import { bytesToBase64, decodeUtf8Text, imageExtension, safeFileName, utf8ToBase64 } from './binary';
import { parseEdit } from '../editValue';

export type ViewerMode = 'text' | 'json' | 'xml' | 'hex' | 'image';

/** Display order of the mode pills. */
export const MODE_ORDER: readonly ViewerMode[] = ['text', 'json', 'xml', 'hex', 'image'];
export const MODE_LABEL: Record<ViewerMode, string> = { text: 'Text', json: 'JSON', xml: 'XML', hex: 'Hex', image: 'Image' };
export const isTextMode = (m: ViewerMode) => m === 'text' || m === 'json' || m === 'xml';

/** Editing refuses values above this many characters (the grid truncates at 32 K; the full-value fetch stops at 4 M). */
export const MAX_EDIT_CHARS = 8 * 1024 * 1024;
/** "Load from file" refuses files above this many bytes (the engine accepts 64 MB bodies; base64 adds a third). */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Binary values this small are decoded for text detection (larger ones are never text in practice). */
const MAX_TEXT_SNIFF_BYTES = 1024 * 1024;

/** What the viewer shows: NULL, text, or bytes (base64, maybe only a prefix of `len` bytes). */
export type ViewerSource =
  | { type: 'null' }
  | { type: 'text'; text: string }
  | { type: 'binary'; b64: string; len: number };

export interface ModeInfo {
  modes: ViewerMode[];
  /** The mode chosen when the user has not picked one. */
  auto: ViewerMode;
  /** The text (a text value, or UTF-8 text found inside a binary value), else null. */
  text: string | null;
  /** The bytes of a binary value (the prefix the grid has, or all of them once loaded). */
  bytes: Uint8Array | null;
  /** An image the browser can draw: the bytes' type, or `image/svg+xml` for SVG text. */
  imageMime: ImageMime | 'image/svg+xml' | null;
}

const JSON_START = /^\s*[{[]/;

/** Valid JSON text that is an object or an array (a bare number or string in a text column is not "JSON"). */
export function isJsonDocument(text: string): boolean {
  if (!JSON_START.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function looksLikeXml(text: string): boolean {
  const t = text.trim();
  return t.startsWith('<') && t.endsWith('>');
}

export function describeSource(src: ViewerSource, kind: ColumnKind): ModeInfo {
  let text: string | null = null;
  let bytes: Uint8Array | null = null;
  let imageMime: ModeInfo['imageMime'] = null;
  if (src.type === 'text') {
    text = src.text;
    if (looksLikeSvg(text)) imageMime = 'image/svg+xml';
  } else if (src.type === 'binary') {
    bytes = base64ToBytes(src.b64);
    imageMime = sniffImageMime(bytes);
    if (!imageMime && src.len <= MAX_TEXT_SNIFF_BYTES && bytes.length === src.len) {
      text = decodeUtf8Text(bytes);
      if (text !== null && looksLikeSvg(text)) imageMime = 'image/svg+xml';
    }
  }
  const set = new Set<ViewerMode>();
  if (text !== null) {
    set.add('text');
    if (kind === 'json' || isJsonDocument(text)) set.add('json');
    if (kind === 'xml' || looksLikeXml(text)) set.add('xml');
  }
  if (src.type === 'text' || src.type === 'binary') set.add('hex');
  if (imageMime) set.add('image');
  if (src.type === 'null') set.add('text');
  const modes = MODE_ORDER.filter((m) => set.has(m));
  let auto: ViewerMode;
  if (imageMime && src.type === 'binary') auto = 'image';
  else if (text === null) auto = src.type === 'binary' ? 'hex' : 'text';
  else if (kind === 'json' || isJsonDocument(text)) auto = 'json';
  else if (kind === 'xml' || looksLikeXml(text)) auto = 'xml';
  else auto = 'text';
  return { modes, auto, text, bytes, imageMime };
}

// ---- checking a draft

export interface Problem {
  message: string;
  line?: number;
  column?: number;
}

/** The problem of a text that should be JSON, or null when it parses. */
export function jsonProblem(text: string): Problem | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const lc = /line (\d+) column (\d+)/i.exec(raw);
    const pos = /position (\d+)/i.exec(raw);
    let line: number | undefined;
    let column: number | undefined;
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else if (pos) {
      const before = text.slice(0, Number(pos[1]));
      line = before.split('\n').length;
      column = before.length - before.lastIndexOf('\n');
    }
    return { message: raw.replace(/\s*\(line \d+ column \d+\)/i, ''), ...(line ? { line, column } : {}) };
  }
}

/** The problem of a text that should be well-formed XML, or null. Needs DOMParser (browser, Electron, jsdom). */
export function xmlProblem(text: string): Problem | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (!err) return null;
  // Chrome appends "Below is a rendering of the page up to the first error." (no space before it, after a "<" or ">").
  const raw = (err.textContent ?? '').replace(/\s*Below is a rendering of the page.*$/is, '').replace(/\s+/g, ' ').trim();
  // Chrome: "…error on line 1 at column 8: Opening and ending tag mismatch…"; Firefox: "…Line Number 1, Column 8:".
  const m = /line (\d+) at column (\d+): (.*)$/i.exec(raw) ?? /Line Number (\d+), Column (\d+):/i.exec(raw);
  const message = m && m[3] ? m[3] : raw.replace(/^This page contains the following errors:\s*/i, '').replace(/^XML Parsing Error:\s*/i, '');
  return { message: message || 'Not well-formed XML', ...(m ? { line: Number(m[1]), column: Number(m[2]) } : {}) };
}

export interface DraftCheck {
  /** Blocks Apply. */
  error: string | null;
  /** Shown, does not block (a text column in JSON mode that is not valid JSON). */
  warning: string | null;
  problem: Problem | null;
}

const where = (p: Problem) => (p.line ? ` (line ${p.line}${p.column ? `, column ${p.column}` : ''})` : '');

/**
 * A JSON or XML column must hold what the server will accept, so an invalid draft blocks Apply. In a text column the
 * JSON / XML mode is only a view: the problem is shown, but the text may be saved.
 */
export function checkDraft(draft: string, column: Pick<ColumnInfo, 'kind' | 'name' | 'nullable'>, mode: ViewerMode): DraftCheck {
  const strict = column.kind === 'json' || column.kind === 'xml';
  const which: 'json' | 'xml' | null = column.kind === 'json' ? 'json' : column.kind === 'xml' ? 'xml' : mode === 'json' ? 'json' : mode === 'xml' ? 'xml' : null;
  if (!which) return { error: null, warning: null, problem: null };
  if (draft.trim() === '') {
    return strict
      ? { error: `Enter ${which === 'json' ? 'a JSON value' : 'an XML document'}${column.nullable ? ', or set the cell to NULL' : ''}`, warning: null, problem: null }
      : { error: null, warning: null, problem: null };
  }
  const problem = which === 'json' ? jsonProblem(draft) : xmlProblem(draft);
  if (!problem) return { error: null, warning: null, problem: null };
  const text = `${which === 'json' ? 'Invalid JSON' : 'Not well-formed XML'}: ${problem.message}${where(problem)}`;
  return strict ? { error: text, warning: null, problem } : { error: null, warning: text, problem };
}

export type ApplyResult = { ok: true; value: CellValue } | { ok: false; error: string };

/** The cell value a draft stands for, checked like typing it into the cell (parseEdit), plus the JSON / XML rule. */
export function buildApplyValue(draft: string, column: ColumnInfo, dialect: Dialect, mode: ViewerMode): ApplyResult {
  const check = checkDraft(draft, column, mode);
  if (check.error) return { ok: false, error: check.error };
  if (column.kind === 'binary') {
    const b64 = utf8ToBase64(draft);
    return { ok: true, value: { $bin: b64, len: base64ToBytes(b64).length } };
  }
  return parseEdit(draft, column, dialect);
}

/** The cell value for bytes read from a file. */
export function binaryValue(bytes: Uint8Array): CellValue {
  return { $bin: bytesToBase64(bytes), len: bytes.length };
}

// ---- save to file

/** File name and MIME type for "Save to file…". */
export function saveTarget(columnName: string, mode: ViewerMode, info: Pick<ModeInfo, 'imageMime' | 'text'>, isBinary: boolean): { name: string; mime: string } {
  if (mode === 'image' && info.imageMime) return { name: safeFileName(columnName, imageExtension(info.imageMime)), mime: info.imageMime };
  if (isBinary && (mode === 'hex' || info.text === null)) return { name: safeFileName(columnName, imageExtension(info.imageMime ?? '')), mime: info.imageMime ?? 'application/octet-stream' };
  if (mode === 'json') return { name: safeFileName(columnName, 'json'), mime: 'application/json' };
  if (mode === 'xml') return { name: safeFileName(columnName, 'xml'), mime: 'application/xml' };
  return { name: safeFileName(columnName, 'txt'), mime: 'text/plain' };
}
