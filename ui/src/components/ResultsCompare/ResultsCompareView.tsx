// The comparison of two result sets: one merged grid (Status column, added / removed / changed rows tinted, a changed
// row as a before / after pair), a summary, key columns, "Differences only", search and an export of what is shown.
import { ArrowLeftRight, Download, LoaderCircle, Rows3, Search, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { copyText } from '../../app/actions';
import { EMPTY_VIEW, type GridViewModel } from '../../filter/model';
import { formatCount } from '../../lib/format';
import { getPlatform } from '../../platform';
import { useDialect } from '../../store/connections';
import { useSettings } from '../../store/settings';
import { useTabs } from '../../store/tabs';
import { toast } from '../../store/ui';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { showMenuBelow } from '../common/Menu';
import { pluralize } from '../common/text';
import { DataGrid } from '../Grid/LazyDataGrid';
import type { GridSelectionInfo } from '../Grid/gridTypes';
import type { TabViewProps } from '../layout/tabViews';
import { RecordView } from '../RecordView/RecordView';
import { defaultKeys, mergeColumns, noSharedColumns, type DiffResult, type DiffSide } from './diff';
import { runDiff } from './diffRunner';
import { KeyPicker } from './KeyPicker';
import { noticesOf } from './notices';
import { buildMerged, exportDiff, STATUS_LABEL, summaryText, tintOf, type DiffExportFormat } from './merged';
import type { CompareTabState } from './open';
import { getComparison, type CompareSet, type Comparison } from './sources';
import './compare.css';

const side = (s: CompareSet): DiffSide => ({ columns: s.columns, rows: s.rows });

/** The grid's `rev` for a merged result: a new number per result (it re-reads the rows when this changes). */
const revs = new WeakMap<object, number>();
let revSeq = 0;
function revOf(m: object | null): number {
  if (!m) return 0;
  let r = revs.get(m);
  if (r === undefined) revs.set(m, (r = ++revSeq));
  return r;
}

export function ResultsCompareView({ tab, theme }: TabViewProps) {
  const compareId = (tab.state as CompareTabState | null)?.compareId;
  const found = getComparison(compareId);
  if (!found) {
    return (
      <div className="rc rc-gone" role="status">
        <TriangleAlert size={20} />
        <div>This comparison is no longer available. The compared results live in memory and do not survive a restart.</div>
        <button className="btn btn-xs" onClick={() => useTabs.getState().close(tab.id)}>
          <X size={12} /> Close this tab
        </button>
      </div>
    );
  }
  return (
    <ErrorBoundary area="the comparison" variant="panel">
      <CompareBody tab={tab} theme={theme} initial={found} />
    </ErrorBoundary>
  );
}

function CompareBody({ tab, theme, initial }: { tab: TabViewProps['tab']; theme: TabViewProps['theme']; initial: Comparison }) {
  const [sets, setSets] = useState<Comparison>(initial);
  const { left, right } = sets;
  const [keys, setKeys] = useState<string[]>(() => defaultKeys(side(initial.left), side(initial.right)));
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [trimText, setTrimText] = useState(false);
  const [differencesOnly, setDifferencesOnly] = useState(true);
  const [view, setViewState] = useState<GridViewModel>(EMPTY_VIEW);
  const [showRecord, setShowRecord] = useState(false);
  const [sel, setSel] = useState<GridSelectionInfo | null>(null);
  const dialect = useDialect(left.connectionId);
  const { nullText, dateFormat } = useSettings((s) => s.settings.results);
  const setView = useCallback((v: Partial<GridViewModel>) => setViewState((c) => ({ ...c, ...v })), []);

  const common = useMemo(
    () => mergeColumns(side(left), side(right)).filter((m) => m.left !== null && m.right !== null).map((m) => m.name),
    [left, right],
  );
  const primaryKey = useMemo(() => defaultKeys(side(left), side(right)), [left, right]);

  // One diff per (sets, key, options): `input` is the identity of the request, a finished diff only counts for its own.
  const input = useMemo(() => ({}), [left, right, keys, ignoreCase, trimText]); // eslint-disable-line react-hooks/exhaustive-deps
  const [done, setDone] = useState<{ input: object; diff: DiffResult | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    runDiff(side(left), side(right), { keys, ignoreCase, trimText }).then(
      (d) => live && setDone({ input, diff: d, error: null }),
      (e) => live && setDone({ input, diff: null, error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [input, left, right, keys, ignoreCase, trimText]);
  const diff = done?.input === input ? done.diff : null;
  const failed = done?.input === input ? done.error : null;

  const merged = useMemo(() => (diff ? buildMerged(diff, left, right, { differencesOnly }) : null), [diff, left, right, differencesOnly]);
  const rev = revOf(merged);
  const rowsSource = useMemo(() => ({ length: merged?.rows.length ?? 0, get: (i: number) => merged?.rows[i] }), [merged]);
  const tint = useCallback((row: number, col: number) => tintOf(merged?.meta[row], col), [merged]);
  const selected = sel && sel.sourceRow !== null && merged ? merged.rows[sel.sourceRow] ?? null : null;
  const selectedMeta = sel && sel.sourceRow !== null && merged ? merged.meta[sel.sourceRow] : undefined;

  // The tab follows what it compares.
  useEffect(() => {
    useTabs.getState().updateView(tab.id, { title: `Compare: ${left.title} ⇄ ${right.title}` });
  }, [left.title, right.title, tab.id]);

  const swap = () => setSets({ left: right, right: left });

  const exportAs = async (format: DiffExportFormat | 'copy') => {
    if (!merged) return;
    try {
      if (format === 'copy') {
        await copyText(exportDiff(merged, 'markdown'));
        toast('success', 'Copied the differences as a Markdown table');
        return;
      }
      const ext = format === 'csv' ? 'csv' : 'md';
      const saved = await getPlatform().saveFile({
        suggestedName: `diff ${left.title} vs ${right.title}.${ext}`.replace(/[\\/:*?"<>|]+/g, '_'),
        filters: [{ name: format === 'csv' ? 'CSV' : 'Markdown', extensions: [ext] }],
        content: exportDiff(merged, format), mime: format === 'csv' ? 'text/csv' : 'text/markdown',
      });
      if (saved) toast('success', `Exported ${saved}`);
    } catch (e) {
      toast('error', 'Could not export the differences', errorMessage(e));
    }
  };
  const exportMenu = (el: HTMLElement) =>
    showMenuBelow(el, [
      { label: 'Export differences as CSV…', onClick: () => void exportAs('csv') },
      { label: 'Export differences as Markdown…', onClick: () => void exportAs('markdown') },
      { separator: true },
      { label: 'Copy differences as Markdown', onClick: () => void exportAs('copy') },
    ]);

  const notices = diff ? noticesOf(diff, left, right, keys) : [];
  const total = diff ? diff.counts.added + diff.counts.removed + diff.counts.changed : 0;
  const identical = !!diff && total === 0 && !noSharedColumns(diff);

  return (
    <div className="rc" data-region="results-compare" data-command-scope="results-compare">
      <div className="rc-head">
        <SetLabel letter="A" set={left} />
        <button className="icon-btn sm" title="Swap A and B (rows only in B count as added)" aria-label="Swap A and B" onClick={swap}>
          <ArrowLeftRight size={14} />
        </button>
        <SetLabel letter="B" set={right} />
        <div className="flex-1" />
        {diff && (
          <div className="rc-summary" role="status" aria-label="Summary">
            <span className="rc-chip added" title="Rows only in B">+{formatCount(diff.counts.added)}</span>
            <span className="rc-chip removed" title="Rows only in A">−{formatCount(diff.counts.removed)}</span>
            <span className="rc-chip changed" title="Rows in both with different values">~{formatCount(diff.counts.changed)}</span>
            <span className="rc-chip same" title="Identical rows">={formatCount(diff.counts.same)}</span>
          </div>
        )}
      </div>
      <div className="rc-bar">
        <KeyPicker columns={common} keys={keys} primaryKey={primaryKey.length ? primaryKey : null} onChange={setKeys} />
        <label className="rc-opt" title="Text values that differ only in letter case are equal">
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /> Ignore case
        </label>
        <label className="rc-opt" title="Text values that differ only in leading or trailing spaces are equal">
          <input type="checkbox" checked={trimText} onChange={(e) => setTrimText(e.target.checked)} /> Trim text
        </label>
        <label className="rc-opt" title="Hide the rows that are the same on both sides">
          <input type="checkbox" checked={differencesOnly} onChange={(e) => setDifferencesOnly(e.target.checked)} /> Differences only
        </label>
        <div className="rs-quick rc-search">
          <Search size={13} />
          <input
            className="input xs borderless" placeholder="Search in differences" aria-label="Search in differences" value={view.quickFilter} spellCheck={false}
            onChange={(e) => setView({ quickFilter: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setView({ quickFilter: '' })}
          />
        </div>
        <div className="flex-1" />
        <button className="btn btn-xs" aria-haspopup="menu" disabled={!merged || merged.rows.length === 0} onClick={(e) => exportMenu(e.currentTarget)}>
          <Download size={12} /> Export <span aria-hidden="true">▾</span>
        </button>
        <button className={`icon-btn sm${showRecord ? ' on' : ''}`} title="Record view of the selected row" aria-label="Record view" aria-pressed={showRecord} onClick={() => setShowRecord((s) => !s)}>
          <Rows3 size={14} />
        </button>
      </div>
      {notices.length > 0 && (
        <div className="rc-notices" role="status">
          {notices.map((n) => (
            <div key={n} className="rc-notice">
              <TriangleAlert size={12} aria-hidden="true" /> {n}
            </div>
          ))}
        </div>
      )}
      <div className="rc-body">
        {failed ? (
          <div className="rc-state error" role="alert">Could not compare: {failed}</div>
        ) : !diff || !merged ? (
          <div className="rc-state" role="status">
            <LoaderCircle size={16} className="spin" aria-label="Comparing" /> Comparing {pluralize(left.rows.length + right.rows.length, 'row')}…
          </div>
        ) : noSharedColumns(diff) ? (
          <div className="rc-state error" role="alert">The two results share no column name, so there is nothing to compare.</div>
        ) : identical ? (
          <div className="rc-state ok" role="status">The two results are identical{ignoreCase || trimText ? ' with the chosen options' : ''} ({summaryText(diff.counts)}).</div>
        ) : (
          <>
            <div className="rc-grid">
              <DataGrid
                gridKey={`compare:${tab.id}`} columns={merged.columns} rows={rowsSource} rev={rev} done view={view} onViewChange={setView}
                dialect={dialect} theme={theme} nullText={nullText} dateFormat={dateFormat} cellTint={tint} onSelectCell={setSel}
                onToggleRecord={() => setShowRecord((s) => !s)}
              />
              {merged.rows.length === 0 && <div className="rc-state">No rows to show.</div>}
            </div>
            {showRecord && (
              <div className="rc-record">
                <RecordView
                  columns={merged.columns} values={selected} rowLabel={selectedMeta ? STATUS_LABEL[selectedMeta.kind] : 'Record'}
                  nullText={nullText} dialect={dialect} onClose={() => setShowRecord(false)}
                />
              </div>
            )}
          </>
        )}
      </div>
      <div className="rc-status">
        {merged && <span>{pluralize(merged.rows.length, 'line')} shown</span>}
        {diff && <span className="muted">{summaryText(diff.counts)}</span>}
        {diff && diff.keyColumns.length > 0 && <span className="muted">matched on {diff.keyColumns.join(', ')}</span>}
      </div>
    </div>
  );
}

function SetLabel({ letter, set }: { letter: string; set: CompareSet }) {
  return (
    <div className="rc-set" title={set.detail}>
      <span className="rc-letter">{letter}</span>
      <span className="rc-set-title">{set.title}</span>
      <span className="muted">{pluralize(set.rowCount, 'row')}</span>
    </div>
  );
}
