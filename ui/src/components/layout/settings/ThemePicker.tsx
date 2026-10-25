// Settings › Appearance pickers: the app theme (swatch cards with a mini window, grouped by mode: one light and one
// dark favourite, so "Follow system" switches between them) and the code theme (cards with a 3-line SQL preview).
// The previews are painted from each theme's resolved tokens (theme/themes.ts), not from the live document.
import { Check } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { isMac } from '../../../commands/keys';
import { useSettings } from '../../../store/settings';
import { getActiveTheme, useThemeRevision } from '../../../theme/activeTheme';
import { themeTokens, type TokenMap } from '../../../theme/index';
import {
  APP_THEMES, appThemeFor, appThemeKey, EDITOR_GROUPS, EDITOR_THEME_KEY, EDITOR_THEMES, editorThemeById, editorThemeIdFor, loadExtraThemes, MATCH_APP,
  type AppTheme, type EditorExtras, type ThemeBase,
} from '../../../theme/themes';

const tokensOf = (base: ThemeBase, vars: Readonly<Record<string, string>>): TokenMap => themeTokens(base, vars);

function MiniWindow({ t }: { t: TokenMap }) {
  const bar = (color: string | undefined, width: string): CSSProperties => ({ background: color, width });
  return (
    <div className="tp-window" aria-hidden="true" style={{ background: t['--bg-app'], borderColor: t['--border'] }}>
      <div className="tp-window-bar" style={{ background: t['--bg-app'] }}>
        <span className="tp-dot" style={{ background: t['--accent'] }} />
        <span className="tp-line" style={bar(t['--fg-muted'], '34%')} />
      </div>
      <div className="tp-window-body">
        <div className="tp-side" style={{ background: t['--bg-sunken'], borderColor: t['--border-subtle'] }}>
          <span className="tp-line" style={bar(t['--obj-table'], '70%')} />
          <span className="tp-line tp-selected" style={{ ...bar(t['--fg-muted'], '60%'), boxShadow: `0 0 0 3px ${t['--bg-selected']}` }} />
          <span className="tp-line" style={bar(t['--obj-view'], '50%')} />
        </div>
        <div className="tp-main" style={{ background: t['--bg-panel'], borderColor: t['--border-subtle'] }}>
          <span className="tp-code"><span className="tp-line" style={bar(t['--syn-keyword'], '28%')} /><span className="tp-line" style={bar(t['--fg'], '40%')} /></span>
          <span className="tp-code"><span className="tp-line" style={bar(t['--syn-keyword'], '22%')} /><span className="tp-line" style={bar(t['--syn-string'], '46%')} /></span>
          <span className="tp-code"><span className="tp-line" style={bar(t['--syn-function'], '36%')} /><span className="tp-line" style={bar(t['--syn-number'], '14%')} /></span>
          <span className="tp-button" style={{ background: t['--accent'] }} />
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ theme, selected, inUse, onPick }: { theme: AppTheme; selected: boolean; inUse: boolean; onPick: () => void }) {
  const t = tokensOf(theme.base, theme.vars);
  return (
    <button type="button" role="radio" aria-checked={selected} className={`tp-card${selected ? ' selected' : ''}`} onClick={onPick} title={theme.description}>
      <MiniWindow t={t} />
      <span className="tp-card-text">
        <span className="tp-card-name">
          {theme.name}
          {inUse && <span className="tp-badge">In use</span>}
        </span>
        <span className="tp-card-desc">{theme.description}</span>
      </span>
      {selected && (
        <span className="tp-check" aria-hidden="true">
          <Check size={12} strokeWidth={2.5} data-stroke="" />
        </span>
      )}
    </button>
  );
}

/** App theme picker: a radiogroup per mode. */
export function AppThemePicker() {
  useThemeRevision();
  useEffect(() => {
    void loadExtraThemes(); // the Darcula / IntelliJ Light palettes are a lazily loaded chunk (theme/themesExtra.ts)
  }, []);
  const pref = useSettings((s) => s.settings.theme);
  const ui = useSettings((s) => s.settings.ui);
  const shown = getActiveTheme();
  const os = isMac() ? 'macOS' : 'Windows';
  const pick = (theme: AppTheme) => {
    // An explicit mode follows the pick (choosing a dark theme in Light mode switches to Dark); "Follow system" only
    // stores the favourite for that mode.
    useSettings.getState().update({ ui: { [appThemeKey(theme.base)]: theme.id }, ...(pref !== 'system' && pref !== theme.base ? { theme: theme.base } : {}) });
  };
  return (
    <div className="tp-groups">
      {(['light', 'dark'] as const).map((base) => {
        const chosen = appThemeFor(ui, base);
        return (
          <div key={base} className="tp-group">
            <div className="tp-group-head">
              <span className="tp-group-title">{base === 'light' ? 'Light themes' : 'Dark themes'}</span>
              {pref === 'system' && <span className="tp-group-hint">Used when {os} is in {base} mode</span>}
            </div>
            <div className="tp-grid" role="radiogroup" aria-label={base === 'light' ? 'Light theme' : 'Dark theme'}>
              {APP_THEMES.filter((t) => t.base === base).map((t) => (
                <ThemeCard key={t.id} theme={t} selected={chosen.id === t.id} inUse={shown.base === base && shown.app.id === t.id} onPick={() => pick(t)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Three lines of SQL in a theme's syntax colours (identifiers, quoted identifiers and keyword weight follow its extras). */
function CodePreview({ t, extras }: { t: TokenMap; extras?: EditorExtras }) {
  const k = { color: t['--syn-keyword'], fontWeight: extras?.plainKeywords ? 400 : 600 } as CSSProperties;
  const s = (name: string) => ({ color: t[name] });
  const ident = { color: extras?.identifier ?? t['--fg'] };
  const quoted = { color: extras?.quoted ?? extras?.identifier ?? t['--fg'] };
  const punct = { color: extras?.punct ?? t['--syn-operator'] };
  return (
    <pre className="tp-code-preview" aria-hidden="true" style={{ background: t['--bg-panel'], color: t['--fg'], borderColor: t['--border-subtle'] }}>
      <span style={k}>SELECT</span> <span style={ident}>name</span><span style={punct}>,</span> <span style={s('--syn-function')}>count</span><span style={punct}>(</span><span style={s('--syn-operator')}>*</span><span style={punct}>)</span>{'\n'}
      <span style={k}>FROM</span> <span style={quoted}>&quot;orders&quot;</span> <span style={{ ...s('--syn-comment'), fontStyle: 'italic' }}>-- paid</span>{'\n'}
      <span style={k}>WHERE</span> <span style={ident}>id</span> <span style={s('--syn-operator')}>&gt;</span> <span style={s('--syn-number')}>10</span> <span style={k}>AND</span> <span style={ident}>s</span> <span style={s('--syn-operator')}>=</span> <span style={s('--syn-string')}>{"'ok'"}</span>
    </pre>
  );
}

interface CodeCard { id: string; name: string; desc: string; t: TokenMap; extras?: EditorExtras }

/**
 * Code theme picker: "Match app theme" first, then the code themes in sections (Rowlit, JetBrains, Popular; light
 * ones first). The JetBrains and popular palettes are a lazily loaded chunk (theme/themesExtra.ts): the picker asks for
 * it on mount and shows their previews as soon as it arrives.
 */
export function EditorThemePicker() {
  useThemeRevision();
  useEffect(() => {
    void loadExtraThemes();
  }, []);
  const ui = useSettings((s) => s.settings.ui);
  const value = editorThemeIdFor(ui);
  const shown = getActiveTheme();
  const app = appThemeFor(ui, shown.base);
  const pick = (id: string) => useSettings.getState().update({ ui: { [EDITOR_THEME_KEY]: id } });
  const twin = editorThemeById(app.id);
  const match: CodeCard = { id: MATCH_APP, name: 'Match app theme', desc: `Follows ${app.name}`, t: tokensOf(app.base, app.vars), extras: twin && twin.base === app.base ? twin.extras : undefined };
  const card = (c: CodeCard) => (
    <button key={c.id} type="button" role="radio" aria-checked={value === c.id} className={`tp-card tp-card-code${value === c.id ? ' selected' : ''}`} onClick={() => pick(c.id)}>
      <CodePreview t={c.t} extras={c.extras} />
      <span className="tp-card-text">
        <span className="tp-card-name">{c.name}</span>
        <span className="tp-card-desc">{c.desc}</span>
      </span>
      {value === c.id && (
        <span className="tp-check" aria-hidden="true">
          <Check size={12} strokeWidth={2.5} data-stroke="" />
        </span>
      )}
    </button>
  );
  return (
    <div className="tp-groups" role="radiogroup" aria-label="Code theme">
      <div className="tp-grid tp-grid-code">{card(match)}</div>
      {EDITOR_GROUPS.map((g) => {
        const themes = EDITOR_THEMES.filter((e) => e.group === g.id).sort((a, b) => Number(a.base === 'dark') - Number(b.base === 'dark'));
        return (
          <div key={g.id} className="tp-group" role="group" aria-label={g.title}>
            <div className="tp-group-head">
              <span className="tp-group-title">{g.title}</span>
              <span className="tp-group-hint">{themes.length} themes</span>
            </div>
            <div className="tp-grid tp-grid-code tp-grid-grouped">
              {themes.map((e) => card({ id: e.id, name: e.name, desc: e.description ?? (e.base === 'dark' ? 'Dark' : 'Light'), t: tokensOf(e.base, e.vars), extras: e.extras }))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
