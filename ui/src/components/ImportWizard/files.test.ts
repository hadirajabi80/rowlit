import { describe, expect, it } from 'vitest';
import { cleanPastedPath, fileNameOf } from './files';

describe('cleanPastedPath', () => {
  it('removes the quotes of a Windows "Copy as path"', () => {
    expect(cleanPastedPath('"C:\\data\\my file.csv"')).toBe('C:\\data\\my file.csv');
    expect(fileNameOf(cleanPastedPath('"C:\\data\\imp1.csv"'))).toBe('imp1.csv');
  });

  it('tolerates whitespace around the quoted text', () => {
    expect(cleanPastedPath('  "C:\\a.csv"  ')).toBe('C:\\a.csv');
  });

  it('keeps a half-typed quote and unquoted paths as they are', () => {
    expect(cleanPastedPath('"C:\\data')).toBe('"C:\\data');
    expect(cleanPastedPath('C:\\data\\a.csv')).toBe('C:\\data\\a.csv');
    expect(cleanPastedPath('"')).toBe('"');
    expect(cleanPastedPath('')).toBe('');
  });
});
