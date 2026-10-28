// Byte helpers of the value viewer: UTF-8 text in and out of binary cells, image data URLs, file names.
import { base64ToBytes, bytesToBase64, type ImageMime } from '../../../lib/format';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

export const encodeUtf8 = (text: string): Uint8Array => encoder.encode(text);

/**
 * The bytes as text when they are valid UTF-8 without control characters (other than tab, line feed and carriage
 * return), i.e. text stored in a binary column. Null for anything else (images, archives, encrypted data).
 */
export function decodeUtf8Text(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return '';
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? null : text;
}

export const utf8ToBase64 = (text: string): string => bytesToBase64(encoder.encode(text));
export { base64ToBytes, bytesToBase64 };

/** The bytes of a picked file (FileReader: also present where Blob.arrayBuffer is not). */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsArrayBuffer(file);
  });
}

/** Text of a file's bytes: UTF-8 (a byte order mark is dropped); null when it holds NUL bytes or is not valid UTF-8. */
export function bytesToText(bytes: Uint8Array): string | null {
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (body.includes(0)) return null;
  try {
    return decoder.decode(body);
  } catch {
    return null;
  }
}

export const imageDataUrl = (mime: ImageMime, b64: string): string => `data:${mime};base64,${b64}`;
/** SVG text as an <img> source (scripts never run in an image). */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
};

export const imageExtension = (mime: string): string => EXTENSIONS[mime] ?? 'bin';

/** A file name made of a column name that is safe on Windows, macOS and Linux. */
export function safeFileName(base: string, ext: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim() || 'value';
  return `${clean}.${ext}`;
}
