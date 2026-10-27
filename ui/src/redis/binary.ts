// Byte-exact editing of Redis hash / list / set / sorted-set elements that are not valid UTF-8.
//
// The engine shows such an element as text with `\xHH` for each invalid byte (and a literal backslash as `\x5c`), and sends
// the real bytes next to it, base64, in `bin` (keyed by that text). Valid text never appears in `bin`. When the text of an
// element goes back to the engine (to delete it, to keep it as a field name, ...) the request carries the `bin` entries of
// the texts it uses, and the engine writes those exact bytes. A binary value the user edited is parsed back here.

export type BinMap = Record<string, string>;

/** Merges the `bin` maps of several pages / loads. */
export function mergeBin(...maps: (BinMap | null | undefined)[]): BinMap {
  return Object.assign({}, ...maps.filter(Boolean));
}

const HEX_ESCAPE = /\\x([0-9a-fA-F]{2})/g;

/** The bytes a binary display text stands for: `\xHH` becomes a byte, everything else UTF-8. */
export function escapedBytes(text: string): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  let last = 0;
  for (const m of text.matchAll(HEX_ESCAPE)) {
    for (const b of enc.encode(text.slice(last, m.index))) parts.push(b);
    parts.push(parseInt(m[1], 16));
    last = (m.index ?? 0) + m[0].length;
  }
  for (const b of enc.encode(text.slice(last))) parts.push(b);
  return Uint8Array.from(parts);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The text of `bytes` when they are valid UTF-8, otherwise null. */
export function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The text (and bytes) to send for a value the user edited. When the value it replaces was binary, the edited text is read
 * with its `\xHH` escapes: if that is still not valid UTF-8 it travels with its base64 twin, otherwise as the plain text.
 * A value that was plain text is sent as typed.
 */
export function editedValue(text: string, original: string | undefined, bin: BinMap): { text: string; b64?: string } {
  if (original === undefined || bin[original] === undefined) return { text };
  const bytes = escapedBytes(text);
  const plain = utf8Text(bytes);
  return plain !== null ? { text: plain } : { text, b64: toBase64(bytes) };
}

/** The `bin` entries for the texts a request uses (undefined when none of them is binary), plus extra entries. */
export function binFor(bin: BinMap, texts: Iterable<string>, extra: BinMap = {}): BinMap | undefined {
  const out: BinMap = { ...extra };
  for (const t of texts) if (bin[t] !== undefined && out[t] === undefined) out[t] = bin[t];
  return Object.keys(out).length ? out : undefined;
}
