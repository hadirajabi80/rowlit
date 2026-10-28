import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ColumnKind } from '../../../api/types';
import { bytesToBase64, looksLikeSvg, sniffImageMime } from '../../../lib/format';
import { bytesToText, decodeUtf8Text, safeFileName } from './binary';
import { buildApplyValue, checkDraft, describeSource, jsonProblem, saveTarget, xmlProblem } from './modes';

const col = (kind: ColumnKind, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name: 'c', ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 't', schema: 'main', isKey: false, ...extra,
});
const bytes = (...v: number[]) => new Uint8Array(v);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe('sniffImageMime', () => {
  it('recognises the magic numbers', () => {
    expect(sniffImageMime(PNG)).toBe('image/png');
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe('image/jpeg');
    expect(sniffImageMime(new TextEncoder().encode('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMime(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('BMP needs a plausible DIB header, not just "BM"', () => {
    const bmp = new Uint8Array(30);
    bmp[0] = 0x42; bmp[1] = 0x4d; bmp[14] = 40;
    expect(sniffImageMime(bmp)).toBe('image/bmp');
    expect(sniffImageMime(new TextEncoder().encode('BM is a text that starts with BM and goes on'))).toBeNull();
  });
  it('is null for other bytes and short input', () => {
    expect(sniffImageMime(bytes(1, 2, 3))).toBeNull();
    expect(sniffImageMime(bytes())).toBeNull();
  });
  it('detects SVG text', () => {
    expect(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true);
    expect(looksLikeSvg('<?xml version="1.0"?>\n<!-- c --><svg width="1"></svg>')).toBe(true);
    expect(looksLikeSvg('<svgx/>')).toBe(false);
    expect(looksLikeSvg('<root><svg/></root>')).toBe(false);
  });
});

describe('describeSource: modes of a cell', () => {
  it('JSON text: Text | JSON | Hex, JSON chosen', () => {
    const d = describeSource({ type: 'text', text: '{"a":1}' }, 'string');
    expect(d.modes).toEqual(['text', 'json', 'hex']);
    expect(d.auto).toBe('json');
  });
  it('a bare number in a text column is not JSON', () => {
    expect(describeSource({ type: 'text', text: '42' }, 'string')).toMatchObject({ modes: ['text', 'hex'], auto: 'text' });
  });
  it('a json column offers JSON even when the text is invalid', () => {
    expect(describeSource({ type: 'text', text: '{oops' }, 'json').modes).toContain('json');
  });
  it('XML text and xml columns', () => {
    expect(describeSource({ type: 'text', text: '<a><b/></a>' }, 'string')).toMatchObject({ modes: ['text', 'xml', 'hex'], auto: 'xml' });
    expect(describeSource({ type: 'text', text: 'plain' }, 'xml').auto).toBe('xml');
  });
  it('SVG text also offers Image', () => {
    const d = describeSource({ type: 'text', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, 'string');
    expect(d.modes).toContain('image');
    expect(d.imageMime).toBe('image/svg+xml');
    expect(d.auto).toBe('xml');
  });
  it('binary with a PNG header: Hex | Image, Image chosen', () => {
    const d = describeSource({ type: 'binary', b64: bytesToBase64(PNG), len: PNG.length }, 'binary');
    expect(d.modes).toEqual(['hex', 'image']);
    expect(d.auto).toBe('image');
    expect(d.imageMime).toBe('image/png');
    expect(d.text).toBeNull();
  });
  it('binary that is not an image or text: Hex only', () => {
    const b = bytes(0, 1, 2, 3, 0xff);
    expect(describeSource({ type: 'binary', b64: bytesToBase64(b), len: b.length }, 'binary')).toMatchObject({ modes: ['hex'], auto: 'hex', text: null });
  });
  it('binary holding UTF-8 text also shows as text / json', () => {
    const b = new TextEncoder().encode('{"k":"é"}');
    const d = describeSource({ type: 'binary', b64: bytesToBase64(b), len: b.length }, 'binary');
    expect(d.modes).toEqual(['text', 'json', 'hex']);
    expect(d.text).toBe('{"k":"é"}');
  });
  it('a prefix of a larger binary is never decoded as text', () => {
    const b = new TextEncoder().encode('hello');
    expect(describeSource({ type: 'binary', b64: bytesToBase64(b), len: 99 }, 'binary').text).toBeNull();
  });
  it('NULL has only the text mode', () => {
    expect(describeSource({ type: 'null' }, 'string')).toMatchObject({ modes: ['text'], auto: 'text', text: null });
  });
});

describe('text and bytes helpers', () => {
  it('decodeUtf8Text refuses control bytes and invalid UTF-8', () => {
    expect(decodeUtf8Text(new TextEncoder().encode('a\tb\nc'))).toBe('a\tb\nc');
    expect(decodeUtf8Text(bytes(0x61, 0))).toBeNull();
    expect(decodeUtf8Text(bytes(0xff, 0xfe, 0x41))).toBeNull();
    expect(decodeUtf8Text(bytes())).toBe('');
  });
  it('bytesToText drops a BOM and refuses binary files', () => {
    expect(bytesToText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toBe('hi');
    expect(bytesToText(bytes(0x68, 0, 0x69))).toBeNull();
  });
  it('file names are safe', () => {
    expect(safeFileName('a/b:c', 'png')).toBe('a_b_c.png');
    expect(safeFileName('', 'bin')).toBe('value.bin');
  });
});

describe('problems and drafts', () => {
  it('jsonProblem locates the error', () => {
    expect(jsonProblem('{"a":1}')).toBeNull();
    const p = jsonProblem('{\n "a": 1,\n}');
    expect(p).not.toBeNull();
    expect(p!.message.length).toBeGreaterThan(0);
  });
  it('xmlProblem flags a mismatched tag', () => {
    expect(xmlProblem('<a><b/></a>')).toBeNull();
    expect(xmlProblem('<a><b></a>')).not.toBeNull();
  });
  it('invalid JSON blocks a json column', () => {
    const r = checkDraft('{"a":', col('json'), 'json');
    expect(r.error).toMatch(/^Invalid JSON/);
    expect(checkDraft('{"a":1}', col('json'), 'json')).toMatchObject({ error: null, warning: null });
  });
  it('an empty draft blocks a json column, with the NULL hint when nullable', () => {
    expect(checkDraft('  ', col('json'), 'json').error).toMatch(/set the cell to NULL/);
    expect(checkDraft('', col('json', { nullable: false }), 'json').error).not.toMatch(/NULL/);
  });
  it('JSON mode on a text column only warns', () => {
    expect(checkDraft('{"a":', col('string'), 'json')).toMatchObject({ error: null, warning: expect.stringMatching(/^Invalid JSON/) });
    expect(checkDraft('{"a":', col('string'), 'text')).toMatchObject({ error: null, warning: null });
  });
  it('malformed XML blocks an xml column', () => {
    expect(checkDraft('<a>', col('xml'), 'xml').error).toMatch(/^Not well-formed XML/);
  });
});

describe('buildApplyValue', () => {
  it('text becomes the cell value, checked like typing it', () => {
    expect(buildApplyValue('{"a":1}', col('json'), 'sqlite', 'json')).toEqual({ ok: true, value: '{"a":1}' });
    expect(buildApplyValue('{"a":', col('json'), 'sqlite', 'json')).toMatchObject({ ok: false });
    expect(buildApplyValue('12', col('int'), 'sqlite', 'text')).toEqual({ ok: true, value: 12 });
    expect(buildApplyValue('x', col('int'), 'sqlite', 'text')).toMatchObject({ ok: false, error: 'Enter a whole number' });
  });
  it('a binary column gets the UTF-8 bytes as base64', () => {
    expect(buildApplyValue('hi', col('binary'), 'sqlite', 'text')).toEqual({ ok: true, value: { $bin: 'aGk=', len: 2 } });
    expect(buildApplyValue('é', col('binary'), 'sqlite', 'text')).toEqual({ ok: true, value: { $bin: 'w6k=', len: 2 } });
  });
});

describe('saveTarget', () => {
  it('names the file after the mode', () => {
    const none = { imageMime: null, text: 'x' } as const;
    expect(saveTarget('doc', 'json', none, false)).toEqual({ name: 'doc.json', mime: 'application/json' });
    expect(saveTarget('doc', 'xml', none, false)).toEqual({ name: 'doc.xml', mime: 'application/xml' });
    expect(saveTarget('doc', 'text', none, false)).toEqual({ name: 'doc.txt', mime: 'text/plain' });
    expect(saveTarget('pic', 'image', { imageMime: 'image/png', text: null }, true)).toEqual({ name: 'pic.png', mime: 'image/png' });
    expect(saveTarget('blob', 'hex', { imageMime: null, text: null }, true)).toEqual({ name: 'blob.bin', mime: 'application/octet-stream' });
  });
});
