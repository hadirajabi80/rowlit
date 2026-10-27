// Byte-exact editing of invalid-UTF-8 hash / list / set / zset elements (redis/binary.ts).
import { describe, expect, it } from 'vitest';
import { binFor, editedValue, escapedBytes, mergeBin, toBase64, utf8Text } from '../binary';

describe('binary elements', () => {
  it('reads \\xHH escapes as bytes and everything else as UTF-8', () => {
    expect([...escapedBytes('a\\xffé\\x5cx41')]).toEqual([0x61, 0xff, 0xc3, 0xa9, 0x5c, 0x78, 0x34, 0x31]);
    expect(toBase64(escapedBytes('\\x00\\xff\\x10'))).toBe('AP8Q');
  });

  it('utf8Text answers null for invalid bytes', () => {
    expect(utf8Text(Uint8Array.from([0x61, 0xc3, 0xa9]))).toBe('aé');
    expect(utf8Text(Uint8Array.from([0xff]))).toBeNull();
  });

  it('a plain value edited as text is sent as typed', () => {
    expect(editedValue('C:\\x41', 'old', {})).toEqual({ text: 'C:\\x41' });
  });

  it('an edited binary value goes back as bytes; once it is valid text again it is plain', () => {
    const bin = { 'a\\xff': '/w==' };
    expect(editedValue('b\\xfe', 'a\\xff', bin)).toEqual({ text: 'b\\xfe', b64: toBase64(Uint8Array.from([0x62, 0xfe])) });
    expect(editedValue('hello', 'a\\xff', bin)).toEqual({ text: 'hello' });
    // the unchanged text parses back to the original bytes
    expect(editedValue('a\\xff', 'a\\xff', { 'a\\xff': toBase64(Uint8Array.from([0x61, 0xff])) }).b64).toBe(toBase64(Uint8Array.from([0x61, 0xff])));
  });

  it('binFor carries only the entries a request uses, plus the extra ones', () => {
    const bin = { 'x\\xff': 'eP8=', 'y\\xfe': 'ev4=' };
    expect(binFor(bin, ['plain', 'x\\xff'])).toEqual({ 'x\\xff': 'eP8=' });
    expect(binFor(bin, ['plain'])).toBeUndefined();
    expect(binFor(bin, ['plain'], { z: 'AA==' })).toEqual({ z: 'AA==' });
    expect(mergeBin({ a: '1' }, null, { b: '2' })).toEqual({ a: '1', b: '2' });
  });
});
