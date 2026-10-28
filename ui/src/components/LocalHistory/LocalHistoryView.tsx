// Local history of one editor (DataGrip's "Local History"): the timeline of its snapshots on the left, a side-by-side
// diff of the selected snapshot against the editor's current text on the right, and Restore / Copy / Label / Delete.
import { Copy, History, LoaderCircle, RefreshCw, Tag, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../api/client';
import { copyText } from '../../app/actions';
import { useDialect } from '../../store/connections';
import { useSettings } from '../../store/settings';
import { useTabs } from '../../store/tabs';
import { toast, useUi } from '../../store/ui';
import type { TabViewProps } from '../layout/tabViews';
import { localHistoryApi, type SnapshotInfo } from './api';
import { primaryKey } from './keys';
import { formatSize, fullTimeLabel, REASON_LABEL, snapshotName, withDeltas, type LocalHistoryTabState } from './model';
import { localHistoryEnabled } from './settings';
import SnapshotDiff from './SnapshotDiff';
import { SnapshotList } from './SnapshotList';
import './localHistory.css';

const PAGE = 100;

export function LocalHistoryView({ tab, theme, visible }: TabViewProps) {
  const state = tab.state as LocalHistoryTabState;
  const target = useTabs((s) => {
    const t = s.tabs.find((x) => x.id === state.tabId);
    return t?.kind === 'console' ? t : undefined;
  });
  const enabled = useSettings((s) => localHistoryEnabled(s.settings));
  const dialect = useDialect(target?.connectionId);
  const current = target?.text ?? null;

  const [rows, setRows] = useState<SnapshotInfo[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const keys = state.keys;
  const keysId = keys.join('\u0000');

  const load = useCallback(async () => {
    try {
      const list = await localHistoryApi.list(keys, { limit: PAGE });
      if (!alive.current) return;
      setRows(list);
      setMore(list.length >= PAGE);
      setError(null);
      setSelectedId((id) => (id !== null && list.some((r) => r.id === id) ? id : (list[0]?.id ?? null)));
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys are compared by value through keysId
  }, [keysId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    try {
      const older = await localHistoryApi.list(keys, { limit: PAGE, before: last.id });
      if (!alive.current) return;
      setRows((r) => [...(r ?? []), ...older]);
      setMore(older.length >= PAGE);
    } catch (e) {
      toast('error', 'Could not load older snapshots', errorMessage(e));
    }
  };

  const selected = rows?.find((r) => r.id === selectedId) ?? null;
  const selectedText = selected ? texts[selected.id] : undefined;
  useEffect(() => {
    setLabelDraft(null);
    if (!selected || texts[selected.id] !== undefined) return;
    let live = true;
    localHistoryApi
      .get(selected.id)
      .then((s) => live && setTexts((t) => ({ ...t, [s.id]: s.text })))
      .catch((e) => live && setError(`Could not load the snapshot (${errorMessage(e)})`));
    return () => {
      live = false;
    };
    // the text cache is read once per selection
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const withDelta = useMemo(() => withDeltas(rows ?? []), [rows]);
  const identical = selectedText !== undefined && current !== null && selectedText === current;

  const restore = async () => {
    if (!target || !selected || selectedText === undefined) return;
    setBusy(true);
    try {
      // The text being replaced is kept first, so a restore can always be undone from this very list.
      if (target.text.trim() !== '') {
        await localHistoryApi.add({ key: primaryKey(target), text: target.text, reason: 'restore', title: target.title }).catch(() => undefined);
      }
      useTabs.getState().updateText(target.id, selectedText);
      toast('success', `Restored ${snapshotName(selected)}`, 'The text it replaced is in the history.');
      await load();
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const saveLabel = async (label: string | null) => {
    if (!selected) return;
    try {
      const updated = await localHistoryApi.label(selected.id, label);
      setRows((r) => r?.map((x) => (x.id === updated.id ? { ...x, label: updated.label } : x)) ?? r);
      setLabelDraft(null);
    } catch (e) {
      toast('error', 'Could not set the label', errorMessage(e));
    }
  };

  const remove = async () => {
    if (!selected || !rows) return;
    try {
      await localHistoryApi.remove(selected.id);
      const i = rows.findIndex((r) => r.id === selected.id);
      const next = rows.filter((r) => r.id !== selected.id);
      setRows(next);
      setSelectedId((next[i] ?? next[i - 1])?.id ?? null);
    } catch (e) {
      toast('error', 'Could not delete the snapshot', errorMessage(e));
    }
  };

  const clearAll = async () => {
    const ok = await useUi.getState().askConfirm({
      title: 'Clear local history?',
      message: `All ${rows?.length ?? 0}${more ? '+' : ''} snapshots of “${state.title}”, including labelled ones, are deleted. This cannot be undone.`,
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!ok) return;
    try {
      await localHistoryApi.clear(keys);
      setRows([]);
      setMore(false);
      setSelectedId(null);
    } catch (e) {
      toast('error', 'Could not clear the history', errorMessage(e));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !rows?.length) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const i = Math.max(0, rows.findIndex((r) => r.id === selectedId));
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      setSelectedId(next.id);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.lh [role="option"][aria-selected="true"]`)?.focus());
    }
  };

  return (
    <div className="lh" data-testid="local-history" onKeyDown={onKeyDown}>
      <div className="lh-toolbar">
        <History size={14} className="lh-tb-icon" aria-hidden />
        <strong className="lh-title" title={state.title}>
          Local history: {state.title}
        </strong>
        {rows && <span className="muted">{rows.length}{more ? '+' : ''} snapshot{rows.length === 1 && !more ? '' : 's'}</span>}
        <span className="lh-spacer" />
        <button type="button" className="btn" onClick={() => void load()} aria-label="Refresh the list" title="Refresh">
          <RefreshCw size={13} aria-hidden />
        </button>
        <button type="button" className="btn" disabled={!rows?.length} onClick={() => void clearAll()}>
          <Trash2 size={13} aria-hidden /> Clear history
        </button>
      </div>
      {!enabled && (
        <div className="lh-banner" role="status">
          Local history is turned off (Settings, Editor): new snapshots are not taken. The ones below are kept until they expire.
        </div>
      )}
      {!target && (
        <div className="lh-banner" role="status">
          The editor was closed. You can still read and copy its snapshots.
        </div>
      )}
      {error && (
        <div className="lh-banner lh-error" role="alert">
          {error}
        </div>
      )}
      <div className="lh-body">
        <div className="lh-left">
          {rows === null && !error && (
            <div className="lh-empty" role="status">
              <LoaderCircle size={16} className="spin" aria-label="Loading snapshots" />
            </div>
          )}
          {rows?.length === 0 && (
            <div className="lh-empty" role="status">
              <p>No snapshots yet.</p>
              <p className="muted">One is taken when you run, save or close the editor, and every 2 minutes while you type.</p>
            </div>
          )}
          {rows && rows.length > 0 && <SnapshotList rows={withDelta} selectedId={selectedId} onSelect={setSelectedId} hasMore={more} onMore={() => void loadMore()} />}
        </div>
        <div className="lh-right">
          {selected ? (
            <>
              <div className="lh-head">
                <div className="lh-head-text">
                  <strong>{snapshotName(selected)}</strong>
                  <span className="muted">
                    {REASON_LABEL[selected.reason]} · {fullTimeLabel(selected.at)} · {formatSize(selected.size)}
                  </span>
                </div>
                <div className="lh-actions">
                  <button type="button" className="btn btn-primary" disabled={!target || selectedText === undefined || identical || busy} onClick={() => void restore()}>
                    <Undo2 size={13} aria-hidden /> Restore
                  </button>
                  <button type="button" className="btn" disabled={selectedText === undefined} onClick={() => void copyText(selectedText ?? '', 'Copied the snapshot')}>
                    <Copy size={13} aria-hidden /> Copy
                  </button>
                  <button type="button" className="btn" onClick={() => setLabelDraft(selected.label ?? '')}>
                    <Tag size={13} aria-hidden /> Label…
                  </button>
                  <button type="button" className="btn" onClick={() => void remove()}>
                    <Trash2 size={13} aria-hidden /> Delete
                  </button>
                </div>
              </div>
              {labelDraft !== null && (
                <form
                  className="lh-label-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveLabel(labelDraft.trim() === '' ? null : labelDraft.trim());
                  }}
                >
                  <input
                    className="input"
                    autoFocus
                    aria-label="Label"
                    placeholder="Name this version (labelled snapshots are never deleted automatically)"
                    maxLength={200}
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setLabelDraft(null);
                      }
                    }}
                  />
                  <button type="submit" className="btn btn-primary">
                    {labelDraft.trim() === '' ? 'Clear label' : 'Save label'}
                  </button>
                  <button type="button" className="btn" onClick={() => setLabelDraft(null)}>
                    Cancel
                  </button>
                </form>
              )}
              <div className="lh-sides muted">
                {current === null
                  ? 'The editor is closed: the snapshot is compared with an empty text.'
                  : 'Compared with the text in the editor now (red: only in the snapshot, green: only in the editor).'}
              </div>
              {identical && (
                <div className="lh-banner" role="status">
                  This snapshot is identical to the text in the editor.
                </div>
              )}
              {selectedText === undefined ? (
                <div className="lh-empty" role="status">
                  <LoaderCircle size={16} className="spin" aria-label="Loading the snapshot" />
                </div>
              ) : (
                <SnapshotDiff snapshot={selectedText} current={current ?? ''} dialect={dialect} theme={theme} ariaLabel={`Differences between ${snapshotName(selected)} and the current text`} />
              )}
            </>
          ) : (
            rows !== null && <div className="lh-empty muted">Select a snapshot to compare it with the current text.</div>
          )}
        </div>
      </div>
    </div>
  );
}
