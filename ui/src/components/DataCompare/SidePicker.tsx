// One side of a data comparison: the shared connection › database › schema picker, then the table (tables and views of
// the schema from the catalog store) or a query, and an optional filter.
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { dbKey, useCatalog } from '../../store/catalog';
import { ConnectionScopePicker } from '../common/ConnectionScopePicker';
import { scopeCatalogDatabase } from '../common/connectionScope';
import type { DataSideState } from './open';

/** Tables and views of the schema a side points at (loads the schema when needed). */
function useObjects(s: DataSideState): { name: string; view: boolean }[] {
  const cid = s.connectionId ?? '';
  const db = scopeCatalogDatabase(s.connectionId, s.database);
  const dbCat = useCatalog((c) => (cid ? c.dbs[dbKey(cid, db)] : undefined));
  const schema = s.schema ?? dbCat?.schemasResp?.defaultSchema ?? dbCat?.defaultSchema ?? null;
  const loaded = schema ? dbCat?.loaded[schema] : undefined;
  useEffect(() => {
    if (cid && schema && !loaded) void useCatalog.getState().loadSchema(cid, db, schema);
  }, [cid, db, schema, loaded]);
  return useMemo(
    () => (loaded?.objects ?? [])
      .filter((o) => o.t === 'table' || o.t === 'view')
      .map((o) => ({ name: o.n, view: o.t === 'view' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [loaded],
  );
}

export interface SidePickerProps {
  label: 'Source' | 'Target';
  value: DataSideState;
  onChange: (next: DataSideState) => void;
  disabled?: boolean;
  /** Pre-select the table of this name (case-insensitive) once the schema lists one and none is chosen. */
  suggestTable?: string | null;
}

export function SidePicker({ label, value, onChange, disabled, suggestTable }: SidePickerProps) {
  const objects = useObjects(value);
  const lower = label.toLowerCase();
  // once per connection › database › schema: a table the user cleared stays cleared
  const suggestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (value.mode !== 'table' || value.table || !suggestTable || !value.connectionId) return;
    const scope = `${value.connectionId}\u0001${value.database ?? ''}\u0001${value.schema ?? ''}`;
    if (suggestedFor.current === scope) return;
    const match = objects.find((o) => o.name === suggestTable) ?? objects.find((o) => o.name.toLowerCase() === suggestTable.toLowerCase());
    if (!match) return;
    suggestedFor.current = scope;
    onChange({ ...value, table: match.name });
  }, [objects, suggestTable, value, onChange]);
  const names = useMemo(() => {
    const list = objects.map((o) => o.name);
    if (value.table && !list.includes(value.table)) list.unshift(value.table);
    return list;
  }, [objects, value.table]);

  return (
    <div className="dc-side" role="group" aria-label={`${label} side`}>
      <div className="dc-side-row">
        <ConnectionScopePicker label={label} value={value} disabled={disabled}
          onChange={(v) => onChange({ ...value, ...v, table: v.connectionId === value.connectionId && v.schema === value.schema && v.database === value.database ? value.table : null })} />
        <ChevronRight size={14} className="scope-crumb" aria-hidden="true" />
        {value.mode === 'table' ? (
          <label className="scope-field">
            <span className="scope-label">Table</span>
            <select className="input" aria-label={`${label} table`} value={value.table ?? ''} disabled={disabled || !value.connectionId}
              onChange={(e) => onChange({ ...value, table: e.target.value || null })}>
              <option value="">Choose a table…</option>
              {names.map((n) => <option key={n} value={n}>{n}{objects.find((o) => o.name === n)?.view ? ' (view)' : ''}</option>)}
            </select>
          </label>
        ) : (
          <span className="scope-field dc-query-flag"><span className="scope-label">Rows of</span><span>a query</span></span>
        )}
        <button type="button" className="btn btn-xs dc-mode" disabled={disabled} aria-pressed={value.mode === 'query'}
          title={value.mode === 'query' ? 'Compare a table instead' : 'Compare the rows of a query instead of a table'}
          onClick={() => onChange({ ...value, mode: value.mode === 'query' ? 'table' : 'query' })}>
          {value.mode === 'query' ? 'Table' : 'Query'}
        </button>
      </div>
      {value.mode === 'query' ? (
        <textarea className="input dc-query" aria-label={`${label} query`} rows={3} spellCheck={false} disabled={disabled}
          placeholder={`SELECT … (the ${lower} rows; never written by a sync)`} value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })} />
      ) : (
        <input className="input dc-where" aria-label={`${label} filter`} spellCheck={false} disabled={disabled}
          placeholder="Filter (optional): a condition without WHERE" value={value.where}
          onChange={(e) => onChange({ ...value, where: e.target.value })} />
      )}
    </div>
  );
}
