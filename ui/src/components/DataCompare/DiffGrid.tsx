// The differences of a comparison as one grid: a row per difference (classified by the engine), key columns first-class,
// changed cells showing the target value struck through above the source value.
import { KeyRound } from 'lucide-react';
import type { DataCompareColumn, DataDiffRow } from '../../api/types.dataCompare';
import { CLASS_LABEL, cellText, shownRow } from './model';

export interface DiffGridProps {
  columns: DataCompareColumn[];
  rows: DataDiffRow[];
  sourceLabel: string;
  targetLabel: string;
}

export function ClassBadge({ cls }: { cls: DataDiffRow['class'] }) {
  return <span className={`dc-badge dc-badge-${cls}`}>{CLASS_LABEL[cls]}</span>;
}

export function DiffGrid({ columns, rows, sourceLabel, targetLabel }: DiffGridProps) {
  return (
    <div className="dc-grid-wrap">
      <table className="dc-grid" aria-label="Differences">
        <thead>
          <tr>
            <th scope="col" className="dc-col-class">Difference</th>
            {columns.map((c) => (
              <th key={c.name} scope="col" className={c.isKey ? 'dc-col-key' : c.compared ? undefined : 'dc-col-ignored'}
                title={`${c.name}\nsource: ${c.sourceType ?? '?'}\ntarget: ${c.targetType ?? '?'}${c.isKey ? '\nkey column' : c.compared ? '' : '\nnot compared'}`}>
                {c.isKey && <KeyRound size={11} aria-label="key" className="dc-key-icon" />}
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const values = shownRow(r.source, r.target);
            const changed = new Set(r.changed ?? []);
            return (
              <tr key={i} className={`dc-row dc-row-${r.class}`}>
                <td className="dc-col-class">
                  <ClassBadge cls={r.class} />
                  {r.class === 'duplicate' && <span className="dc-dup-side muted"> ({r.source ? 'source' : 'target'})</span>}
                </td>
                {columns.map((c, ci) => {
                  if (r.class === 'changed' && changed.has(ci)) {
                    const was = cellText(r.target?.[ci]);
                    const now = cellText(r.source?.[ci]);
                    return (
                      <td key={c.name} className="dc-cell dc-cell-changed" title={`${targetLabel}: ${was}\n${sourceLabel}: ${now}`}>
                        <span className="dc-old" aria-label={`target ${was}`}>{was}</span>
                        <span className="dc-new" aria-label={`source ${now}`}>{now}</span>
                      </td>
                    );
                  }
                  const v = values[ci];
                  return <td key={c.name} className={`dc-cell${v === null || v === undefined ? ' dc-null' : ''}${c.isKey ? ' dc-cell-key' : ''}`}>{cellText(v)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
