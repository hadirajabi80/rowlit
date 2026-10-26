// Join editor popover (opens on a join badge and after a column → column drag): join type with Venn icons and a plain
// explanation, the ON conditions (column, operator, column, ignore case, trim), suggestions, remove.
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BuilderJoin, BuilderJoinCondition, BuilderTable, SourceColumn } from '../../../api/links';
import { kindClass } from '../../../filter/model';
import { Select } from '../../common/Select';
import { JOIN_SHORT, JOIN_TYPES, joinHelp, VennIcon } from './joinTypes';

const OPS: NonNullable<BuilderJoinCondition['op']>[] = ['=', '<>', '<', '>', '<=', '>='];

interface Props {
  join: BuilderJoin;
  left: BuilderTable;
  right: BuilderTable;
  leftColumns: readonly SourceColumn[];
  rightColumns: readonly SourceColumn[];
  /** Screen rect to anchor at. */
  anchor: DOMRect | null;
  onType(type: BuilderJoin['type']): void;
  onCondition(index: number, patch: Partial<BuilderJoinCondition>): void;
  onAddCondition(): void;
  onRemoveCondition(index: number): void;
  onRemove(): void;
  onClose(): void;
}

export function JoinPopover(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = p.anchor;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = a ? a.left + a.width / 2 - w / 2 : vw / 2 - w / 2;
    let top = a ? a.bottom + 10 : vh / 3;
    if (top + h > vh - 8) top = Math.max(8, (a ? a.top - h - 10 : vh - h - 8));
    left = Math.max(8, Math.min(vw - w - 8, left));
    setPos({ left, top });
  }, [p.anchor, p.join.on.length, p.join.type]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.lkb-jtype.on')?.focus();
    const down = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.select-pop, .lkb-join-badge')) p.onClose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { join: j, left, right } = p;
  const colOpts = (cols: readonly SourceColumn[]) => cols.map((c) => ({ value: c.name, label: c.name, hint: c.sourceType }));
  const kindOf = (cols: readonly SourceColumn[], name: string) => kindClass(cols.find((c) => c.name === name)?.kind as never);

  return (
    <div
      ref={ref}
      className="lkb-pop lkb-join-pop"
      role="dialog"
      aria-label={`Join ${left.as} and ${right.as}`}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          p.onClose();
        }
      }}
    >
      <div className="lkb-pop-head">
        <span className="lkb-pop-title">
          <b>{left.as}</b> <span className="muted">joined with</span> <b>{right.as}</b>
        </span>
        <button type="button" className="icon-btn xs" aria-label="Close" title="Close (Esc)" onClick={p.onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="lkb-jtypes" role="radiogroup" aria-label="Join type">
        {JOIN_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={j.type === t}
            className={`lkb-jtype${j.type === t ? ' on' : ''}`}
            title={joinHelp(t, left.as, right.as)}
            onClick={() => p.onType(t)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = JOIN_TYPES.indexOf(j.type);
              const n = JOIN_TYPES[(i + (e.key === 'ArrowRight' ? 1 : JOIN_TYPES.length - 1)) % JOIN_TYPES.length];
              p.onType(n);
              requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.lkb-jtype.on')?.focus());
            }}
          >
            <VennIcon type={t} size={22} />
            <span>{JOIN_SHORT[t]}</span>
          </button>
        ))}
      </div>
      <p className="lkb-pop-help">{joinHelp(j.type, left.as, right.as)}</p>
      {j.type !== 'cross' && (
        <div className="lkb-conds">
          {j.on.length === 0 && <div className="lkb-cond-empty">No condition: every row pairs with every row. Add one below.</div>}
          {j.on.map((c, i) => {
            const mismatch = kindOf(p.leftColumns, c.leftColumn) !== kindOf(p.rightColumns, c.rightColumn);
            return (
              <div className="lkb-cond" key={i} role="group" aria-label={`Condition ${i + 1}`}>
                <span className="lkb-cond-and">{i === 0 ? 'ON' : 'AND'}</span>
                <Select size="xs" mono className="lkb-cond-col" aria-label={`${left.as} column`} value={c.leftColumn} options={colOpts(p.leftColumns)} onChange={(v) => p.onCondition(i, { leftColumn: v })} menuMinWidth={200} />
                <Select size="xs" className="lkb-cond-op" aria-label="Operator" value={c.op ?? '='} options={OPS.map((o) => ({ value: o, label: o }))} searchable={false} onChange={(v) => p.onCondition(i, { op: v as BuilderJoinCondition['op'] })} />
                <Select size="xs" mono className="lkb-cond-col" aria-label={`${right.as} column`} value={c.rightColumn} options={colOpts(p.rightColumns)} onChange={(v) => p.onCondition(i, { rightColumn: v })} menuMinWidth={200} />
                <button type="button" className="icon-btn xs" aria-label={`Remove condition ${i + 1}`} title="Remove this condition" onClick={() => p.onRemoveCondition(i)}>
                  <Trash2 size={12} />
                </button>
                <div className="lkb-cond-opts">
                  <label className="check sm">
                    <input type="checkbox" checked={!!c.ignoreCase} onChange={(e) => p.onCondition(i, { ignoreCase: e.target.checked })} /> Ignore case
                  </label>
                  <label className="check sm">
                    <input type="checkbox" checked={!!c.trim} onChange={(e) => p.onCondition(i, { trim: e.target.checked })} /> Trim spaces
                  </label>
                  {mismatch && (
                    <span className="lkb-warn" title="The two columns have different types: values may not match (e.g. 7 and '7'). Cast one side in SQL mode if needed.">
                      <AlertTriangle size={11} /> Different types
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-xs" onClick={p.onAddCondition}>
            <Plus size={12} /> Add condition
          </button>
        </div>
      )}
      <div className="lkb-pop-foot">
        <button type="button" className="btn btn-xs lkb-danger-ghost" onClick={p.onRemove}>
          <Trash2 size={12} /> Remove join
        </button>
        <span className="flex-1" />
        <button type="button" className="btn btn-xs btn-primary" onClick={p.onClose}>Done</button>
      </div>
    </div>
  );
}
