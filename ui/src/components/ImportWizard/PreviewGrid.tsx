// Preview table of the file, one page at a time, with the inferred type of every column in its header.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { typeLabel } from './model';
import type { PreviewResult } from './types';

interface Props {
  preview: PreviewResult | null;
  loading?: boolean;
  /** 0-based page shown (the engine returns one page per request). */
  page?: number;
  onPage?: (page: number) => void;
}

export function PreviewGrid({ preview, loading, page = 0, onPage }: Props) {
  if (!preview) {
    return <div className="iw-grid-empty" role="status">{loading ? 'Reading the file…' : 'No preview yet.'}</div>;
  }
  const first = preview.offset ?? 0;
  const count = preview.rows.length;
  const hasNext = !!preview.hasNextPage;
  return (
    <div className="iw-grid-wrap" aria-busy={loading ? true : undefined}>
      <table className="iw-grid" aria-label="Preview of the file">
        <thead>
          <tr>
            <th className="iw-grid-rownum" scope="col">#</th>
            {preview.columns.map((c) => (
              <th key={c.index} scope="col" title={`${c.name}: ${typeLabel(c.inferred)}${c.inferred.nullable ? ', has empty values' : ''}`}>
                <span className="iw-grid-name" dir="auto">{c.name}</span>
                <span className={`iw-kind iw-kind-${c.inferred.kind}`}>{typeLabel(c.inferred)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, i) => (
            <tr key={first + i}>
              <td className="iw-grid-rownum">{(first + i + 1).toLocaleString('en-US')}</td>
              {preview.columns.map((c) => {
                const v = row[c.index] ?? null;
                return v === null ? <td key={c.index} className="iw-null">NULL</td> : <td key={c.index} dir="auto">{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="iw-grid-foot" role="status">
        <span>
          {count === 0
            ? 'No rows on this page'
            : `Rows ${(first + 1).toLocaleString('en-US')}–${(first + count).toLocaleString('en-US')}`}
          {preview.moreRows ? ` · types are inferred from the first ${preview.sampledRows.toLocaleString('en-US')} rows` : ''}
        </span>
        {onPage && (page > 0 || hasNext) && (
          <span className="iw-pager">
            <button type="button" className="icon-btn sm" aria-label="Previous page" title="Previous page" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span className="iw-pager-label">Page {(page + 1).toLocaleString('en-US')}</span>
            <button type="button" className="icon-btn sm" aria-label="Next page" title="Next page" disabled={!hasNext || loading} onClick={() => onPage(page + 1)}>
              <ChevronRight size={14} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
