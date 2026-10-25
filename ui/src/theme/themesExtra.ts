// The palettes of the lazily loaded themes (themes.ts lists them with metadata only, installExtraThemes swaps these in):
// the JetBrains set (Darcula, IntelliJ Light, New UI dark / light, High Contrast) and popular editor schemes. This is
// data in its own chunk, imported by themes.ts loadExtraThemes() when the settings name one of them or the Appearance
// pickers open, so none of it weighs on the initial bundle. Like themes.ts, one of the few files where colours are
// written down (the token lint skips src/theme/).
//
// The palettes are recreated by hand from the public colour descriptions of each scheme (editor background, text,
// SQL keyword / string / number / comment / function colours, selection, current line), not copied from a scheme file.
// Where a scheme's own colour (for example Darcula's #808080 comments or #6A8759 strings) sits below the 4.5:1 that
// themes.test.ts demands of every syntax colour, it is lifted just enough to pass and keeps its hue.
import type { EditorExtras, ThemeVars } from './themes';

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const channels = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** `a` moved towards `b` by `t` (0..1), as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join('')}`;
}

/** Everything a code theme says, in one place (surfaces, text, accent, SQL syntax, the IntelliSense kind icons). */
interface Palette {
  bg: string; elev: string; hover: string; hoverElev?: string; sel: string; selOff?: string; sunken?: string; input?: string;
  border: string; strong: string; subtle?: string;
  fg: string; muted: string; disabled?: string; mutedSel?: string;
  accent: string; accentFg: string; accentHover?: string; accentSel?: string; accentSoft: string;
  kw: string; str: string; com: string; num: string; fn: string; vr: string; op: string; ty: string;
  /** IntelliSense kind icon hues (table, view, column, function, schema, database, snippet, alias). */
  kinds?: readonly [string, string, string, string, string, string, string, string];
}

function code(p: Palette): ThemeVars {
  const dark = channels(p.bg).reduce((s, v) => s + v, 0) < 384;
  const out: Record<string, string> = {
    '--bg-panel': p.bg,
    '--bg-elevated': p.elev,
    '--bg-hover': p.hover,
    '--bg-hover-elevated': p.hoverElev ?? p.hover,
    '--bg-selected': p.sel,
    '--bg-selected-inactive': p.selOff ?? mix(p.sel, p.bg, 0.5),
    '--bg-sunken': p.sunken ?? mix(p.bg, dark ? '#000000' : '#000000', dark ? 0.2 : 0.04),
    '--bg-input': p.input ?? p.sunken ?? p.bg,
    '--border': p.border,
    '--border-strong': p.strong,
    '--border-subtle': p.subtle ?? mix(p.bg, p.border, 0.5),
    '--fg': p.fg,
    '--fg-muted': p.muted,
    '--fg-disabled': p.disabled ?? mix(p.bg, p.muted, 0.45),
    '--fg-muted-on-selected': p.mutedSel ?? mix(p.muted, p.fg, 0.5),
    '--accent': p.accent,
    '--accent-fg': p.accentFg,
    '--accent-hover': p.accentHover ?? mix(p.accent, p.fg, 0.25),
    '--accent-on-selected': p.accentSel ?? mix(p.accent, p.fg, 0.4),
    '--accent-soft': p.accentSoft,
    '--focus-ring': p.accent,
    '--syn-keyword': p.kw,
    '--syn-string': p.str,
    '--syn-comment': p.com,
    '--syn-number': p.num,
    '--syn-function': p.fn,
    '--syn-variable': p.vr,
    '--syn-operator': p.op,
    '--syn-type': p.ty,
  };
  if (p.kinds) {
    p.kinds.forEach((c, i) => {
      out[['--kind-table', '--kind-view', '--kind-column', '--kind-function', '--kind-schema', '--kind-database', '--kind-snippet', '--kind-alias'][i]] = c;
    });
  }
  return out;
}

interface Surface {
  line: string; sel: string; selOff: string; bracket: string; bracketBorder: string; find: string; guide: string; guideActive: string;
  cursor: string; ln: string; lnActive: string;
}

/** Monaco colour keys of the editor surface (themes.ts EditorExtras.colors). */
function surface(s: Surface): Record<string, string> {
  return {
    'editor.lineHighlightBackground': s.line,
    'editor.selectionBackground': s.sel,
    'editor.inactiveSelectionBackground': s.selOff,
    'editor.selectionHighlightBackground': s.selOff,
    'editorBracketMatch.background': s.bracket,
    'editorBracketMatch.border': s.bracketBorder,
    'editor.findMatchHighlightBackground': s.find,
    'editor.findMatchBackground': s.find,
    'editorIndentGuide.background1': s.guide,
    'editorIndentGuide.activeBackground1': s.guideActive,
    'editorCursor.foreground': s.cursor,
    'editorLineNumber.foreground': s.ln,
    'editorLineNumber.activeForeground': s.lnActive,
  };
}

interface Code {
  vars: ThemeVars;
  extras?: EditorExtras;
}

// ----------------------------------------------------------------- JetBrains

const DARCULA_PALETTE: Palette = {
  bg: '#2b2b2b', elev: '#35383a', hover: '#323232', hoverElev: '#3f4244', sel: '#0d293e', selOff: '#2f3133', sunken: '#262626', input: '#303234',
  border: '#4e5254', strong: '#7d8286', subtle: '#3a3a3a',
  fg: '#a9b7c6', muted: '#adb0b4', disabled: '#6b6f72', mutedSel: '#c3c7cb',
  accent: '#7cb1f5', accentFg: '#1e2022', accentHover: '#9ac4f8', accentSel: '#9ac4f8', accentSoft: '#2a3d55',
  kw: '#d4803b', str: '#7f9f6a', com: '#929292', num: '#6897bb', fn: '#ffc66d', vr: '#a98bbe', op: '#a9b7c6', ty: '#2fb0b4',
  kinds: ['#6897bb', '#a98bbe', '#2fb0b4', '#ffc66d', '#e0b252', '#8aa9d6', '#d4803b', '#e08fa6'],
};
const DARCULA: Code = {
  vars: code(DARCULA_PALETTE),
  extras: {
    plainKeywords: true,
    identifier: '#a9b7c6',
    quoted: '#a9b7c6',
    punct: '#a9b7c6',
    colors: surface({
      line: '#323232', sel: '#214283', selOff: '#21428355', bracket: '#3b514d', bracketBorder: '#ffef2866', find: '#32593d', guide: '#3b3b3b', guideActive: '#5a5a5a',
      cursor: '#bbbbbb', ln: '#606366', lnActive: '#a4a3a3',
    }),
  },
};

const JB_DARK_PALETTE: Palette = {
  bg: '#1e1f22', elev: '#2b2d30', hover: '#26282e', hoverElev: '#35373b', sel: '#2e436e', selOff: '#26282e', sunken: '#18191b', input: '#2b2d30',
  border: '#3f4147', strong: '#74777e', subtle: '#2b2d30',
  fg: '#bcbec4', muted: '#9a9da4', disabled: '#5a5d63', mutedSel: '#bfc2c8',
  accent: '#6b9bfa', accentFg: '#14151a', accentHover: '#8ab0fb', accentSel: '#a5c3fc', accentSoft: '#25324d',
  kw: '#cf8e6d', str: '#6aab73', com: '#868a91', num: '#2aacb8', fn: '#56a8f5', vr: '#c77dbb', op: '#bcbec4', ty: '#16baac',
  kinds: ['#56a8f5', '#c77dbb', '#2aacb8', '#6aab73', '#e0bb65', '#8aa4f0', '#cf8e6d', '#f08bb4'],
};
const JB_DARK: Code = {
  vars: code(JB_DARK_PALETTE),
  extras: {
    plainKeywords: true,
    identifier: '#bcbec4',
    quoted: '#bcbec4',
    punct: '#bcbec4',
    colors: surface({
      line: '#26282e', sel: '#214283', selOff: '#21428360', bracket: '#43454a', bracketBorder: '#6f737a', find: '#3d4f3a', guide: '#393b40', guideActive: '#4e5157',
      cursor: '#ced0d6', ln: '#4b5059', lnActive: '#a1a3ab',
    }),
  },
};

const INTELLIJ_LIGHT_PALETTE: Palette = {
  bg: '#ffffff', elev: '#f7f8fa', hover: '#f5f5f5', hoverElev: '#e7eaef', sel: '#cfe0f5', selOff: '#e6e8ec', sunken: '#f2f2f2', input: '#ffffff',
  border: '#c9ccd6', strong: '#8a8d96', subtle: '#ebecf0',
  fg: '#080808', muted: '#656977', disabled: '#a7aab5', mutedSel: '#4f5361',
  accent: '#2470b3', accentFg: '#ffffff', accentHover: '#1b5c95', accentSel: '#174f82', accentSoft: '#edf3fb',
  kw: '#000080', str: '#067d17', num: '#0000ff', com: '#6f6f6f', fn: '#6b6b00', vr: '#660e7a', op: '#080808', ty: '#17707a',
  kinds: ['#2470b3', '#7a3f9e', '#17707a', '#067d17', '#9a6700', '#4338ca', '#b4501a', '#b8326f'],
};
const INTELLIJ_LIGHT: Code = {
  vars: code(INTELLIJ_LIGHT_PALETTE),
  extras: {
    identifier: '#080808',
    quoted: '#080808',
    punct: '#080808',
    colors: surface({
      line: '#fffae3', sel: '#a6d2ff', selOff: '#d4d4d4', bracket: '#93d9d9', bracketBorder: '#93d9d900', find: '#f9dc82', guide: '#d2d2d2', guideActive: '#8f8f8f',
      cursor: '#000000', ln: '#999999', lnActive: '#4f4f4f',
    }),
  },
};

const JB_LIGHT_PALETTE: Palette = {
  bg: '#ffffff', elev: '#ffffff', hover: '#f7f8fa', hoverElev: '#edeff3', sel: '#d5e3fd', selOff: '#e8ebf1', sunken: '#f7f8fa', input: '#ffffff',
  border: '#d3d5db', strong: '#868a94', subtle: '#ebecf0',
  fg: '#1b1c1f', muted: '#676b78', disabled: '#a8abb5', mutedSel: '#4b4f5c',
  accent: '#2e64d6', accentFg: '#ffffff', accentHover: '#2352b5', accentSel: '#1c459c', accentSoft: '#e8effd',
  kw: '#0033b3', str: '#067d17', num: '#1750eb', com: '#707070', fn: '#00627a', vr: '#871094', op: '#1b1c1f', ty: '#0f7172',
  kinds: ['#2e64d6', '#871094', '#0f7172', '#00627a', '#9a6700', '#4338ca', '#b4501a', '#b8326f'],
};
const JB_LIGHT: Code = {
  vars: code(JB_LIGHT_PALETTE),
  extras: {
    plainKeywords: true,
    identifier: '#080808',
    quoted: '#080808',
    punct: '#080808',
    colors: surface({
      line: '#f5f8fe', sel: '#a6d2ff', selOff: '#d4d4d4', bracket: '#dbe6fc', bracketBorder: '#2e64d666', find: '#ffe9a8', guide: '#e4e6ec', guideActive: '#a6a9b4',
      cursor: '#000000', ln: '#9aa0ad', lnActive: '#4b4f5c',
    }),
  },
};

const JB_HC_PALETTE: Palette = {
  bg: '#000000', elev: '#161616', hover: '#141414', hoverElev: '#2a2a2a', sel: '#003c78', selOff: '#1c1c1c', sunken: '#0a0a0a', input: '#0a0a0a',
  border: '#6a6a6a', strong: '#b0b0b0', subtle: '#2b2b2b',
  fg: '#ffffff', muted: '#d0d0d0', disabled: '#7a7a7a', mutedSel: '#e6e6e6',
  accent: '#7ab8ff', accentFg: '#000000', accentHover: '#a3cfff', accentSel: '#b8d9ff', accentSoft: '#0b2a4a',
  kw: '#ff9d3c', str: '#8be08f', com: '#bdbdbd', num: '#62cbff', fn: '#ffe066', vr: '#e7acff', op: '#ffffff', ty: '#4deadb',
  kinds: ['#7ab8ff', '#e7acff', '#4deadb', '#ffe066', '#ffc857', '#a9b6ff', '#ff9d3c', '#ff8fc0'],
};
const JB_HC: Code = {
  vars: code(JB_HC_PALETTE),
  extras: {
    plainKeywords: true,
    identifier: '#ffffff',
    quoted: '#ffffff',
    punct: '#ffffff',
    colors: surface({
      line: '#1a1a1a', sel: '#214fbf', selOff: '#214fbf70', bracket: '#00000000', bracketBorder: '#ffffff', find: '#7a5b00', guide: '#4a4a4a', guideActive: '#9a9a9a',
      cursor: '#ffffff', ln: '#8c8c8c', lnActive: '#ffffff',
    }),
  },
};

// ------------------------------------------------------------------- popular

const VSCODE_DARK: Code = {
  vars: code({
    bg: '#1e1e1e', elev: '#252526', hover: '#2a2d2e', hoverElev: '#2f3234', sel: '#04395e', selOff: '#37373d', sunken: '#181818', input: '#3c3c3c',
    border: '#454545', strong: '#8c8c8c', subtle: '#2b2b2b',
    fg: '#d4d4d4', muted: '#a6a6a6', disabled: '#6e6e6e', mutedSel: '#c8c8c8',
    accent: '#3794ff', accentFg: '#0b0b0b', accentHover: '#6cb0ff', accentSel: '#8ec4ff', accentSoft: '#0b2a44',
    kw: '#569cd6', str: '#ce9178', com: '#6a9955', num: '#b5cea8', fn: '#dcdcaa', vr: '#9cdcfe', op: '#d4d4d4', ty: '#4ec9b0',
    kinds: ['#3794ff', '#c586c0', '#9cdcfe', '#dcdcaa', '#e5c07b', '#7f9bf5', '#ce9178', '#f0749c'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#9cdcfe',
    quoted: '#ce9178',
    punct: '#d4d4d4',
    colors: surface({
      line: '#2a2d2e', sel: '#264f78', selOff: '#3a3d41', bracket: '#0064001a', bracketBorder: '#888888', find: '#515c6a', guide: '#404040', guideActive: '#707070',
      cursor: '#aeafad', ln: '#858585', lnActive: '#c6c6c6',
    }),
  },
};

const VSCODE_LIGHT: Code = {
  vars: code({
    bg: '#ffffff', elev: '#f3f3f3', hover: '#f5f5f5', hoverElev: '#e4e6f1', sel: '#cde3f7', selOff: '#e4e6f1', sunken: '#f3f3f3', input: '#ffffff',
    border: '#c8c8c8', strong: '#8a8a8a', subtle: '#e5e5e5',
    fg: '#1f1f1f', muted: '#616161', disabled: '#a0a0a0', mutedSel: '#454545',
    accent: '#005fb8', accentFg: '#ffffff', accentHover: '#0a4a8a', accentSel: '#00478f', accentSoft: '#e1eefa',
    kw: '#0000ff', str: '#a31515', com: '#007a00', num: '#098658', fn: '#795e26', vr: '#001080', op: '#1f1f1f', ty: '#267f99',
    kinds: ['#005fb8', '#af00db', '#267f99', '#795e26', '#8a6a00', '#4338ca', '#b4501a', '#c2185b'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#001080',
    quoted: '#a31515',
    punct: '#1f1f1f',
    colors: surface({
      line: '#f5f5f5', sel: '#add6ff', selOff: '#e5ebf1', bracket: '#0064001a', bracketBorder: '#b9b9b9', find: '#f2d679', guide: '#d3d3d3', guideActive: '#939393',
      cursor: '#000000', ln: '#6e7681', lnActive: '#171184',
    }),
  },
};

const TOKYO_NIGHT: Code = {
  vars: code({
    bg: '#1a1b26', elev: '#16161e', hover: '#1f2335', hoverElev: '#232538', sel: '#2f3549', selOff: '#292e42', sunken: '#13141c', input: '#14141b',
    border: '#3b4261', strong: '#6f7aa3', subtle: '#232538',
    fg: '#c0caf5', muted: '#9aa5ce', disabled: '#565f89', mutedSel: '#b4bde6',
    accent: '#7aa2f7', accentFg: '#13141c', accentHover: '#9bb9fa', accentSel: '#a9c2fb', accentSoft: '#232d4f',
    kw: '#bb9af7', str: '#9ece6a', com: '#7e88b3', num: '#ff9e64', fn: '#7aa2f7', vr: '#e0af68', op: '#89ddff', ty: '#2ac3de',
    kinds: ['#7aa2f7', '#bb9af7', '#2ac3de', '#9ece6a', '#e0af68', '#7dcfff', '#ff9e64', '#f7768e'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#c0caf5',
    quoted: '#73daca',
    punct: '#89ddff',
    colors: surface({
      line: '#1e202e', sel: '#33467c', selOff: '#2a3252', bracket: '#2a3252', bracketBorder: '#7aa2f780', find: '#3d59a1', guide: '#2b2f45', guideActive: '#4a5275',
      cursor: '#c0caf5', ln: '#3b4261', lnActive: '#737aa2',
    }),
  },
};

const CATPPUCCIN_MOCHA: Code = {
  vars: code({
    bg: '#1e1e2e', elev: '#181825', hover: '#313244', hoverElev: '#2a2b3c', sel: '#45475a', selOff: '#313244', sunken: '#11111b', input: '#181825',
    border: '#45475a', strong: '#7f849c', subtle: '#313244',
    fg: '#cdd6f4', muted: '#a6adc8', disabled: '#6c7086', mutedSel: '#c4cbe6',
    accent: '#89b4fa', accentFg: '#11111b', accentHover: '#a6c8fc', accentSel: '#b4befe', accentSoft: '#2a3550',
    kw: '#cba6f7', str: '#a6e3a1', com: '#9399b2', num: '#fab387', fn: '#89b4fa', vr: '#eba0ac', op: '#89dceb', ty: '#f9e2af',
    kinds: ['#89b4fa', '#cba6f7', '#94e2d5', '#a6e3a1', '#f9e2af', '#b4befe', '#fab387', '#f5c2e7'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#cdd6f4',
    quoted: '#94e2d5',
    punct: '#9399b2',
    colors: surface({
      line: '#313244', sel: '#585b7066', selOff: '#585b7040', bracket: '#585b7055', bracketBorder: '#9399b2', find: '#3e5f6b', guide: '#313244', guideActive: '#585b70',
      cursor: '#f5e0dc', ln: '#6c7086', lnActive: '#b4befe',
    }),
  },
};

const CATPPUCCIN_LATTE: Code = {
  vars: code({
    bg: '#eff1f5', elev: '#e6e9ef', hover: '#e6e9ef', hoverElev: '#d9dde6', sel: '#ccd0da', selOff: '#dce0e8', sunken: '#dce0e8', input: '#e6e9ef',
    border: '#bcc0cc', strong: '#7c7f93', subtle: '#ccd0da',
    fg: '#4c4f69', muted: '#5c5f77', disabled: '#9ca0b0', mutedSel: '#434660',
    accent: '#1655d0', accentFg: '#ffffff', accentHover: '#1245a8', accentSel: '#0f3a90', accentSoft: '#e6ecfb',
    kw: '#8839ef', str: '#2f7d1f', com: '#5c5f77', num: '#b84300', fn: '#1a5be0', vr: '#b01a35', op: '#0f6f77', ty: '#955500',
    kinds: ['#1a5be0', '#8839ef', '#0f6f77', '#2f7d1f', '#955500', '#5a52d6', '#b84300', '#c52e8b'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#4c4f69',
    quoted: '#0f6f77',
    punct: '#5c5f77',
    colors: surface({
      line: '#e6e9ef', sel: '#acb0be88', selOff: '#acb0be55', bracket: '#acb0be55', bracketBorder: '#7c7f93', find: '#f2d3a0', guide: '#ccd0da', guideActive: '#9ca0b0',
      cursor: '#bf4a32', ln: '#8c8fa1', lnActive: '#7287fd',
    }),
  },
};

const GRUVBOX_DARK: Code = {
  vars: code({
    bg: '#282828', elev: '#3c3836', hover: '#32302f', hoverElev: '#45403d', sel: '#504945', selOff: '#3c3836', sunken: '#1d2021', input: '#1d2021',
    border: '#504945', strong: '#928374', subtle: '#3c3836',
    fg: '#ebdbb2', muted: '#bdae93', disabled: '#7c6f64', mutedSel: '#d5c4a1',
    accent: '#fabd2f', accentFg: '#1d2021', accentHover: '#fcd059', accentSel: '#fbd36c', accentSoft: '#4a4028',
    kw: '#fe5a45', str: '#b8bb26', com: '#a89984', num: '#d3869b', fn: '#8ec07c', vr: '#83a598', op: '#fe8019', ty: '#fabd2f',
    kinds: ['#83a598', '#d3869b', '#8ec07c', '#b8bb26', '#fabd2f', '#b0a8ee', '#fe8019', '#fb7a8a'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#ebdbb2',
    quoted: '#8ec07c',
    punct: '#bdae93',
    colors: surface({
      line: '#32302f', sel: '#665c5499', selOff: '#66554366', bracket: '#665c5488', bracketBorder: '#a89984', find: '#6b5e1c', guide: '#3c3836', guideActive: '#665c54',
      cursor: '#ebdbb2', ln: '#7c6f64', lnActive: '#bdae93',
    }),
  },
};

const AYU_MIRAGE: Code = {
  vars: code({
    bg: '#1f2430', elev: '#272d38', hover: '#242b38', hoverElev: '#2f3644', sel: '#33415e', selOff: '#2a3040', sunken: '#191e2a', input: '#191e2a',
    border: '#3a4254', strong: '#707a8c', subtle: '#2a3040',
    fg: '#cccac2', muted: '#a0a7b5', disabled: '#5c6773', mutedSel: '#c2c5cd',
    accent: '#ffcc66', accentFg: '#1a1f29', accentHover: '#ffdb8c', accentSel: '#ffd98a', accentSoft: '#3d3a2c',
    kw: '#ffa759', str: '#d5ff80', com: '#8a93a6', num: '#dfbfff', fn: '#ffd173', vr: '#f28779', op: '#f29e74', ty: '#73d0ff',
    kinds: ['#73d0ff', '#dfbfff', '#95e6cb', '#ffd173', '#ffcc66', '#a5b4fc', '#ffa759', '#f28779'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#cccac2',
    quoted: '#95e6cb',
    punct: '#b8b4a9',
    colors: surface({
      line: '#1a1f29', sel: '#409fff40', selOff: '#409fff25', bracket: '#409fff25', bracketBorder: '#73d0ff80', find: '#695380', guide: '#2d3342', guideActive: '#4a5568',
      cursor: '#ffcc66', ln: '#5c6773', lnActive: '#8a9199',
    }),
  },
};

const NIGHT_OWL: Code = {
  vars: code({
    bg: '#011627', elev: '#021d33', hover: '#0b253a', hoverElev: '#0e2f4a', sel: '#1d3b53', selOff: '#0e293f', sunken: '#010f1c', input: '#0b2942',
    border: '#1d3b53', strong: '#5f7e97', subtle: '#0e293f',
    fg: '#d6deeb', muted: '#8fa7c0', disabled: '#4b6479', mutedSel: '#b4c4d6',
    accent: '#82aaff', accentFg: '#011627', accentHover: '#a5c0ff', accentSel: '#b3caff', accentSoft: '#0e3355',
    kw: '#c792ea', str: '#ecc48d', com: '#7d9a9a', num: '#f78c6c', fn: '#82aaff', vr: '#addb67', op: '#7fdbca', ty: '#ffcb8b',
    kinds: ['#82aaff', '#c792ea', '#7fdbca', '#addb67', '#ffcb8b', '#a3b8f5', '#f78c6c', '#ff869a'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#d6deeb',
    quoted: '#addb67',
    punct: '#7fdbca',
    colors: surface({
      line: '#0b253a', sel: '#1d3b53', selOff: '#0b2942', bracket: '#122d42', bracketBorder: '#5f7e97', find: '#5f7e9779', guide: '#122d42', guideActive: '#5f7e97',
      cursor: '#80a4c2', ln: '#4b6479', lnActive: '#c5e4fd',
    }),
  },
};

const MATERIAL_DARKER: Code = {
  vars: code({
    bg: '#212121', elev: '#2a2a2a', hover: '#292929', hoverElev: '#333333', sel: '#3d4a4c', selOff: '#303030', sunken: '#1a1a1a', input: '#1a1a1a',
    border: '#424242', strong: '#7a7a7a', subtle: '#2e2e2e',
    fg: '#eeffff', muted: '#a8b2b2', disabled: '#616161', mutedSel: '#d0dada',
    accent: '#80cbc4', accentFg: '#0f1a19', accentHover: '#a3dbd6', accentSel: '#a3dbd6', accentSoft: '#25403d',
    kw: '#c792ea', str: '#c3e88d', com: '#8a8a8a', num: '#f78c6c', fn: '#82aaff', vr: '#f07178', op: '#89ddff', ty: '#ffcb6b',
    kinds: ['#82aaff', '#c792ea', '#80cbc4', '#c3e88d', '#ffcb6b', '#a9b8ff', '#f78c6c', '#ff8aa0'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#eeffff',
    quoted: '#80cbc4',
    punct: '#89ddff',
    colors: surface({
      line: '#292929', sel: '#80cbc440', selOff: '#80cbc425', bracket: '#80cbc430', bracketBorder: '#80cbc4', find: '#ffcc0040', guide: '#363636', guideActive: '#5c5c5c',
      cursor: '#ffcc00', ln: '#515151', lnActive: '#b0bec5',
    }),
  },
};

const ROSE_PINE: Code = {
  vars: code({
    bg: '#191724', elev: '#1f1d2e', hover: '#21202e', hoverElev: '#2a283e', sel: '#403d52', selOff: '#26233a', sunken: '#14121d', input: '#14121d',
    border: '#403d52', strong: '#6e6a86', subtle: '#26233a',
    fg: '#e0def4', muted: '#908caa', disabled: '#6e6a86', mutedSel: '#c9c6e0',
    accent: '#c4a7e7', accentFg: '#191724', accentHover: '#d6c0f0', accentSel: '#d6c0f0', accentSoft: '#2c2842',
    kw: '#3e8fb0', str: '#f6c177', com: '#908caa', num: '#eb6f92', fn: '#ebbcba', vr: '#c4a7e7', op: '#908caa', ty: '#9ccfd8',
    kinds: ['#9ccfd8', '#c4a7e7', '#6db3d1', '#ebbcba', '#f6c177', '#b4a9f0', '#eb6f92', '#f08fb0'],
  }),
  extras: {
    plainKeywords: true,
    identifier: '#e0def4',
    quoted: '#ebbcba',
    punct: '#908caa',
    colors: surface({
      line: '#21202e', sel: '#6e6a8680', selOff: '#6e6a8640', bracket: '#6e6a8640', bracketBorder: '#908caa', find: '#6e5a3a', guide: '#26233a', guideActive: '#524f67',
      cursor: '#c4a7e7', ln: '#6e6a86', lnActive: '#e0def4',
    }),
  },
};

export const EDITOR_PALETTES: Readonly<Record<string, Code>> = {
  darcula: DARCULA,
  'jetbrains-dark': JB_DARK,
  'intellij-light': INTELLIJ_LIGHT,
  'jetbrains-light': JB_LIGHT,
  'jetbrains-hc': JB_HC,
  'vscode-dark': VSCODE_DARK,
  'vscode-light': VSCODE_LIGHT,
  'tokyo-night': TOKYO_NIGHT,
  'catppuccin-mocha': CATPPUCCIN_MOCHA,
  'catppuccin-latte': CATPPUCCIN_LATTE,
  'gruvbox-dark': GRUVBOX_DARK,
  'ayu-mirage': AYU_MIRAGE,
  'night-owl': NIGHT_OWL,
  'material-darker': MATERIAL_DARKER,
  'rose-pine': ROSE_PINE,
};

// ----------------------------------------------------------------- app themes
// The two JetBrains app themes reuse their code theme's surfaces and syntax and add what only the window needs.

/** Translucent glass tints of a theme's panel colour (the top bar, shell.css); same recipe as themes.ts. */
function glass(rgb: string, dark: boolean, material: string): Record<string, string> {
  return {
    '--glass-bg': `rgb(${rgb} / ${dark ? 70 : 62}%)`,
    '--glass-bg-native': `rgb(${rgb} / ${dark ? 50 : 45}%)`,
    '--glass-material': material,
  };
}

const DARCULA_APP: ThemeVars = {
  ...DARCULA.vars,
  '--bg-app': '#3c3f41',
  '--bg-panel': '#2b2b2b',
  '--bg-elevated': '#3c3f41',
  '--bg-hover': '#404345',
  '--bg-hover-elevated': '#424548',
  '--bg-grid-alt': '#2d2d2d',
  '--bg-active': '#3f4244',
  '--bg-sunken': '#313335',
  '--bg-input': '#33363a',
  '--bg-selected': '#0d293e',
  '--bg-selected-inactive': '#3a3d3f',
  '--border': '#515456',
  '--border-strong': '#80858a',
  '--border-subtle': '#464a4c',
  '--fg-muted': '#b2b5b9',
  '--fg-muted-on-selected': '#c7cacd',
  '--accent-soft-strong': '#35506f',
  // warm tints behind the grid's changed cells and the search highlight, light enough to keep the text at 4.5:1
  '--cell-edited': 'rgb(250 204 21 / 14%)',
  '--cell-inserted': 'rgb(98 181 67 / 16%)',
  '--mark-bg': 'rgb(255 198 109 / 15%)',
  '--glass-hover': 'rgb(255 255 255 / 4%)',
  '--glass-active': 'rgb(255 255 255 / 8%)',
  '--brand': '#4a88c7',
  '--brand-fg': '#ffffff',
  '--success': '#62b543',
  '--warning': '#f2c55c',
  '--danger': '#ff6b68',
  '--info': '#6cb6d9',
  '--danger-text': '#ff8d8a',
  '--success-soft': '#2c3b2a',
  '--warning-soft': '#403a28',
  '--danger-soft': '#452d2d',
  '--info-soft': '#27394a',
  '--num': '#78a6cb',
  '--string': '#8aaa75',
  '--date': '#b095c2',
  '--bool': '#d4803b',
  '--obj-table': '#78a6cb',
  '--obj-view': '#b095c2',
  '--obj-routine': '#ffc66d',
  '--obj-package': '#e0b252',
  '--obj-trigger': '#d4803b',
  '--obj-key': '#e0b252',
  '--obj-fk': '#2fb0b4',
  '--obj-db': '#8aa9d6',
  '--obj-other': '#a2a6aa',
  ...glass('40 42 44', true, '#35383a'),
};

const INTELLIJ_LIGHT_APP: ThemeVars = {
  ...INTELLIJ_LIGHT.vars,
  '--bg-app': '#f2f2f2',
  '--bg-panel': '#ffffff',
  '--bg-elevated': '#ffffff',
  '--bg-hover': '#e9ebef',
  '--bg-hover-elevated': '#eaecf0',
  '--bg-grid-alt': '#f8f9fb',
  '--bg-active': '#dfe2e8',
  '--bg-sunken': '#f4f5f7',
  '--bg-input': '#ffffff',
  '--bg-selected': '#d4e2f4',
  '--bg-selected-inactive': '#e1e4ea',
  '--border': '#c9ccd6',
  '--border-strong': '#868a94',
  '--border-subtle': '#e4e6eb',
  '--fg-muted': '#5d6170',
  '--fg-muted-on-selected': '#434858',
  '--accent-soft-strong': '#c8dbf3',
  '--brand': '#2470b3',
  '--brand-fg': '#ffffff',
  '--success': '#2b7f2a',
  '--warning': '#9a5f00',
  '--danger': '#c4262e',
  '--info': '#17707a',
  '--success-soft': '#eef7ed',
  '--warning-soft': '#fbf1dc',
  '--conn-green': '#15803d',
  '--danger-soft': '#fbe7e6',
  '--info-soft': '#e1f1f3',
  '--num': '#0b4fc4',
  '--string': '#2b7a1f',
  '--date': '#660e7a',
  '--bool': '#a03a00',
  '--obj-table': '#2470b3',
  '--obj-view': '#7a3f9e',
  '--obj-routine': '#17707a',
  '--obj-package': '#9a6700',
  '--obj-trigger': '#9a5f00',
  '--obj-key': '#9a6700',
  '--obj-fk': '#17707a',
  '--obj-db': '#4338ca',
  '--obj-other': '#656977',
  ...glass('242 242 242', false, '#e6e7ea'),
};

export const APP_PALETTES: Readonly<Record<string, ThemeVars>> = {
  darcula: DARCULA_APP,
  'intellij-light': INTELLIJ_LIGHT_APP,
};
