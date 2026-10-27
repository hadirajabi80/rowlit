// Schema example chips: the engine cuts strings at 100 characters, so "use as filter" on a cut example matches by its start.
import { describe, expect, it } from 'vitest';
import { exampleFilterValue, isCutExample } from '../SchemaView';

describe('schema example chips', () => {
  it('a short string is filtered by its value', () => {
    expect(isCutExample('paid')).toBe(false);
    expect(exampleFilterValue('paid')).toBe('"paid"');
    expect(exampleFilterValue(42)).toBe('42');
  });

  it('a string cut at 100 characters is filtered by a "starts with" regex, escaped', () => {
    const cut = `a.b (c) [d] $e ^f / g \\ h\n${'x'.repeat(100)}`.slice(0, 100);
    expect(isCutExample(cut)).toBe(true);
    const text = exampleFilterValue(cut);
    expect(text.startsWith('/^') && text.endsWith('/')).toBe(true);
    // the literal text of the regex matches the cut value and nothing is left unescaped
    const re = new RegExp(text.slice(1, -1).replace(/\\\//g, '/'));
    expect(re.test(cut)).toBe(true);
    expect(re.test(`${cut}and more`)).toBe(true);
    expect(re.test(`z${cut}`)).toBe(false);
    expect(text).not.toContain('\n');
  });
});
