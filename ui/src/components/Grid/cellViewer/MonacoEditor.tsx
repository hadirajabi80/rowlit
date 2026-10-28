// Monaco implementation of the value viewer's editor: small Monarch languages for JSON and XML (the Monaco entry has
// no bundled languages) and a marker where the text stops being valid. Loaded lazily (EditorView.tsx).
import { useEffect, useRef } from 'react';
import * as monaco from '../../../editor/monaco';
import { ensureMonacoSetup, THEME_IDS } from '../../../editor/monaco-setup';
import { baseMonacoOptions } from '../../../editor/monacoOptions';
import type { EditorViewProps } from './EditorView';

const JSON_LANGUAGE = 'rowlit-value-json';
const XML_LANGUAGE = 'rowlit-value-xml';
let registered = false;
let seq = 0;

function ensureLanguages() {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: JSON_LANGUAGE });
  monaco.languages.setMonarchTokensProvider(JSON_LANGUAGE, {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}[\],:]/, 'delimiter'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration(JSON_LANGUAGE, {
    brackets: [['{', '}'], ['[', ']']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
  });
  monaco.languages.register({ id: XML_LANGUAGE });
  monaco.languages.setMonarchTokensProvider(XML_LANGUAGE, {
    tokenizer: {
      root: [
        [/<!--/, 'comment', '@comment'],
        [/<!\[CDATA\[[\s\S]*?\]\]>/, 'string'],
        [/<[?!][^>]*>/, 'keyword'],
        [/<\/?[\w:.-]+/, 'type', '@tag'],
      ],
      comment: [[/-->/, 'comment', '@pop'], [/[^-]+|-/, 'comment']],
      tag: [
        [/[\w:.-]+(?=\s*=)/, 'variable'],
        [/"[^"]*"|'[^']*'/, 'string'],
        [/\/?>/, 'type', '@pop'],
        [/[=]/, 'delimiter'],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration(XML_LANGUAGE, {
    // no `brackets` / auto-closing pairs for <>: typing "<a>" must not insert a second ">"
    autoClosingPairs: [{ open: '"', close: '"' }, { open: "'", close: "'" }],
    comments: { blockComment: ['<!--', '-->'] },
  });
}

const languageId = (l: EditorViewProps['language']) => (l === 'json' ? JSON_LANGUAGE : l === 'xml' ? XML_LANGUAGE : 'plaintext');

export default function MonacoEditor(p: EditorViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    if (!host.current) return;
    ensureMonacoSetup();
    ensureLanguages();
    const model = monaco.editor.createModel(latest.current.value, languageId(latest.current.language), monaco.Uri.parse(`rowlit-value://cell/${++seq}`));
    const e = monaco.editor.create(host.current, {
      ...baseMonacoOptions(), model, theme: THEME_IDS[latest.current.theme], ariaLabel: latest.current.ariaLabel, automaticLayout: true,
      minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 13, lineHeight: 20, tabSize: 2, lineNumbersMinChars: 3, glyphMargin: false,
      overviewRulerLanes: 0, stickyScroll: { enabled: false }, wordBasedSuggestions: 'off', quickSuggestions: false, wordWrap: 'on',
    });
    ed.current = e;
    const sub = model.onDidChangeContent(() => latest.current.onChange(model.getValue()));
    e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => latest.current.onSubmit?.());
    if (latest.current.autoFocus) e.focus();
    return () => {
      sub.dispose();
      e.dispose();
      model.dispose();
      ed.current = null;
    };
  }, []);

  useEffect(() => {
    const model = ed.current?.getModel();
    if (model && model.getValue() !== p.value) model.setValue(p.value);
  }, [p.value]);

  useEffect(() => {
    const model = ed.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, languageId(p.language));
  }, [p.language]);

  useEffect(() => {
    monaco.editor.setTheme(THEME_IDS[p.theme]);
  }, [p.theme]);

  // The first problem as a marker (at its line and column when known, else at the start).
  useEffect(() => {
    const model = ed.current?.getModel();
    if (!model) return;
    const pr = p.problem;
    monaco.editor.setModelMarkers(model, 'rowlit-value', pr
      ? [{
        severity: monaco.MarkerSeverity.Error, message: pr.message,
        startLineNumber: pr.line ?? 1, startColumn: pr.column ?? 1, endLineNumber: pr.line ?? 1, endColumn: (pr.column ?? 1) + 1,
      }]
      : []);
  }, [p.problem, p.value]);

  return <div ref={host} className="cell-viewer-monaco" />;
}
