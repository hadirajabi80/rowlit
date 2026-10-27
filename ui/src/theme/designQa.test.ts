// Visual-design QA round regressions (docs/qa/round-design.md): stylesheet-level rules the screenshots and the DOM audits
// of the round turned up. Static checks on the stylesheets (the vitest config has `css: false`, so they are read from
// disk), next to the contrast matrix tests that own the colour pairs (themes.test.ts / tokens.test.ts).
import { describe, expect, it } from 'vitest';
import { CONTRAST_MATRIX } from './contrastMatrix';

// Node API, typed locally (the app tsconfig has no Node types; vitest runs on Node).
const nodeFs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as {
  readFileSync(p: string, enc: 'utf8'): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const SRC = `${cwd}/src`;
const read = (rel: string) => nodeFs.readFileSync(`${SRC}/${rel}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function cssFiles(dir: string): string[] {
  return nodeFs.readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (f === 'node_modules') return [];
    return nodeFs.statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}

/** The declarations of every rule whose selector list contains exactly `selector`, merged (later rules win). */
function rule(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector)) continue;
    found = true;
    for (const d of m[2].matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) out[d[1]] = d[2].trim();
  }
  if (!found) throw new Error(`no rule for ${selector}`);
  return out;
}

describe('Find in database result badges', () => {
  const css = read('components/Search/search.css');
  it('draw their text in the kind colour mixed with --fg, the mix the contrast matrix checks on --bg-sunken', () => {
    for (const [cls, token] of [['column', '--kind-column'], ['code', '--obj-routine'], ['data', '--obj-package']] as const) {
      expect(rule(css, `.sx-badge.${cls}`).color).toBe(`color-mix(in srgb, var(${token}) 65%, var(--fg))`);
      expect(CONTRAST_MATRIX.some((p) => p.fg === `mix:${token}:--fg:65` && p.bg === '--bg-sunken')).toBe(true);
    }
  });
  it('use the selected-row muted colour on the selected result row', () => {
    expect(rule(css, '.sx-row.active')['--text-muted']).toBe('var(--fg-muted-on-selected)');
  });
});

describe('muted text on --bg-active', () => {
  it('uses --fg-muted-on-selected (the matrix pair), never plain --fg-muted / --text-muted (4.19:1 in the dark theme)', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const t = nodeFs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const bg = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(m[2]);
        const col = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(m[2]);
        if (bg && col && /var\(--bg-active\)/.test(bg[1]) && /var\(--(text-muted|fg-muted)\)/.test(col[1])) offenders.push(`${file.replace(SRC, '')}: ${m[1].trim()}`);
      }
    }
    // the settings search "clear" button is an icon (3:1), not text
    expect(offenders.filter((o) => !o.includes('.settings-search-clear'))).toEqual([]);
  });
});

describe('Objects tab toolbar', () => {
  it('wraps instead of pushing "Details" out of a narrow window', () => {
    const css = read('components/ObjectList/objectList.css');
    const r = rule(css, '.ol-toolbar');
    expect(r['flex-wrap']).toBe('wrap');
    expect(r.height).toBeUndefined();
    expect(r['min-height']).toBe('var(--toolbar-h)');
  });
});

describe('error hint under a message', () => {
  it('keeps the bulb, the sentence and the action on one row (the sentence shrinks and wraps)', () => {
    const css = read('components/layout/layout.css');
    expect(rule(css, '.message-help')['flex-wrap']).toBeUndefined();
    expect(rule(css, '.message-help > span')['min-width']).toBe('0');
    expect(rule(css, '.message-help')['white-space']).toBe('normal');
  });
});
