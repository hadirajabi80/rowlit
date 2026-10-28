// The chart series palette (--chart-1..8) must stay visible on the panel surface of every app theme (graphical objects
// need 3:1, WCAG 1.4.11) and the eight hues must be told apart.
import { describe, expect, it } from 'vitest';
import { appTokens, type ActiveTheme } from '../../theme/activeTheme';
import { contrast, parseTokenBlocks } from '../../theme';
import { APP_THEMES, appThemeById, loadExtraThemes, MATCH_APP } from '../../theme/themes';

interface NodeFs { readFileSync(p: string, enc: 'utf8'): string }
const nodeFs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as NodeFs;
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const CSS = nodeFs.readFileSync(`${cwd}/src/theme/tokens.css`, 'utf8');
await loadExtraThemes();

const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--chart-${i}`);

describe('chart palette tokens', () => {
  it('defines eight distinct series colours in both base themes', () => {
    const raw = parseTokenBlocks(CSS);
    for (const base of ['light', 'dark'] as const) {
      const vals = SERIES.map((k) => raw[base][k]);
      expect(vals.every(Boolean), base).toBe(true);
      expect(new Set(vals).size, base).toBe(8);
    }
  });

  for (const theme of APP_THEMES) {
    it(`${theme.name}: every series colour reaches 3:1 on the panel`, () => {
      const sel: ActiveTheme = { base: theme.base, app: appThemeById(theme.id)!, editorId: MATCH_APP };
      const t = appTokens(sel, CSS);
      const low = SERIES.map((k) => `${k} ${t[k]} = ${contrast(t[k], t['--bg-panel']).toFixed(2)}`).filter((_, i) => contrast(t[SERIES[i]], t['--bg-panel']) < 3);
      expect(low).toEqual([]);
    });
  }
});
