// Join types as the builder shows them: Venn icons, labels and a one-line explanation in plain words.
import { useId } from 'react';
import type { BuilderJoinType } from '../../../api/links';

export const JOIN_TYPES: readonly BuilderJoinType[] = ['inner', 'left', 'right', 'full', 'cross'];

export const JOIN_LABEL: Record<BuilderJoinType, string> = {
  inner: 'Inner join', left: 'Left join', right: 'Right join', full: 'Full join', cross: 'Cross join',
};

export const JOIN_SHORT: Record<BuilderJoinType, string> = { inner: 'Inner', left: 'Left', right: 'Right', full: 'Full', cross: 'Cross' };

/** What the join keeps, with the two table names. */
export function joinHelp(type: BuilderJoinType, left: string, right: string): string {
  switch (type) {
    case 'inner': return `Only rows that match in both ${left} and ${right}.`;
    case 'left': return `Every row of ${left}; ${right} values where they match (empty otherwise).`;
    case 'right': return `Every row of ${right}; ${left} values where they match (empty otherwise).`;
    case 'full': return `Every row of both tables, matched where possible.`;
    case 'cross': return `Every row of ${left} combined with every row of ${right} (no condition).`;
  }
}

/** Two overlapping circles; the filled parts are the rows the join keeps. */
export function VennIcon({ type, size = 16 }: { type: BuilderJoinType; size?: number }) {
  const l = type === 'left' || type === 'full';
  const r = type === 'right' || type === 'full';
  const mid = type !== 'cross';
  const id = `lkbv${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className={`lkb-venn ${type}`} width={size} height={size * 0.7} viewBox="0 0 24 16" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-l`}><circle cx="9" cy="8" r="6.5" /></clipPath>
      </defs>
      {type === 'cross' ? (
        <>
          <rect x="2" y="2.5" width="8" height="11" rx="2" className="venn-fill" />
          <rect x="14" y="2.5" width="8" height="11" rx="2" className="venn-fill" />
          <path d="M10.5 5.5l3 5M13.5 5.5l-3 5" className="venn-line" />
        </>
      ) : (
        <>
          {l && <circle cx="9" cy="8" r="6.5" className="venn-fill" />}
          {r && <circle cx="15" cy="8" r="6.5" className="venn-fill" />}
          {mid && <circle cx="15" cy="8" r="6.5" className="venn-fill" clipPath={`url(#${id}-l)`} />}
          <circle cx="9" cy="8" r="6.5" className="venn-line" />
          <circle cx="15" cy="8" r="6.5" className="venn-line" />
        </>
      )}
    </svg>
  );
}
