// The timeline on the left of the local history view: snapshots newest first, grouped by day.
import { CircleDot, Clock, Play, Save, Tag, Undo2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SnapshotReason } from './api';
import { formatDelta, fullTimeLabel, groupByDay, REASON_LABEL, timeLabel, type SnapshotRow } from './model';

const REASON_ICON: Record<SnapshotReason, ReactNode> = {
  run: <Play size={12} aria-hidden />,
  save: <Save size={12} aria-hidden />,
  close: <X size={12} aria-hidden />,
  auto: <Clock size={12} aria-hidden />,
  restore: <Undo2 size={12} aria-hidden />,
  manual: <CircleDot size={12} aria-hidden />,
};

export interface SnapshotListProps {
  rows: SnapshotRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  hasMore: boolean;
  onMore: () => void;
}

export function SnapshotList({ rows, selectedId, onSelect, hasMore, onMore }: SnapshotListProps) {
  const groups = groupByDay(rows);
  return (
    <div className="lh-list" role="listbox" aria-label="Snapshots, newest first">
      {groups.map((g) => (
        <div key={g.day} role="group" aria-label={g.day}>
          <div className="lh-day">{g.day}</div>
          {g.rows.map(({ info, delta }) => (
            <button
              key={info.id}
              type="button"
              role="option"
              aria-selected={info.id === selectedId}
              className={`lh-row${info.id === selectedId ? ' selected' : ''}`}
              title={`${REASON_LABEL[info.reason]} · ${fullTimeLabel(info.at)}`}
              onClick={() => onSelect(info.id)}
            >
              <span className={`lh-reason lh-reason-${info.reason}`}>{REASON_ICON[info.reason]}</span>
              <span className="lh-time">{timeLabel(info.at)}</span>
              <span className="lh-main">
                {info.label ? (
                  <span className="lh-label">
                    <Tag size={11} aria-hidden /> {info.label}
                  </span>
                ) : (
                  <span className="lh-what">{REASON_LABEL[info.reason]}</span>
                )}
              </span>
              {delta !== null && (
                <span className={`lh-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`} aria-label={`${delta} characters`}>
                  {formatDelta(delta)}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
      {hasMore && (
        <button type="button" className="btn lh-more" onClick={onMore}>
          Load older snapshots
        </button>
      )}
    </div>
  );
}
