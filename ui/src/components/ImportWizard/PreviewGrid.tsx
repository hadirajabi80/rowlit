// Preview table of the first rows of the file, with the inferred type of every column in its header.
import { typeLabel } from './model';
import type { PreviewResult } from './types';

export function PreviewGrid({ preview, loading }: { preview: PreviewResult | null; loading?: boolean }) {
  if (!preview) {
    return <div className="iw-grid-empty" role="status">{loading ? 'Reading the file…' : 'No preview yet.'}</div>;
  }
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
            <tr key={i}>
              <td className="iw-grid-rownum">{i + 1}</td>
              {preview.columns.map((c) => {
                const v = row[c.index] ?? null;
                return v === null ? <td key={c.index} className="iw-null">NULL</td> : <td key={c.index} dir="auto">{v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="iw-grid-foot" role="status">
        {preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'} shown
        {preview.moreRows ? ` · the file has more rows (types are inferred from the first ${preview.sampledRows.toLocaleString('en-US')})` : ''}
      </div>
    </div>
  );
}
