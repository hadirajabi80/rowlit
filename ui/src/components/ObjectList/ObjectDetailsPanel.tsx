// Details side panel of the Objects tab: the selected object's dependencies (Uses / Used by, grouped, with kind badges
// and FK column mappings, the rows of the object tab's Dependencies section) under a small header with quick actions.
// A lazy chunk of the Objects tab. The request waits DETAILS_DEBOUNCE_MS after the selection settles (arrowing through
// the list does not request every row); answers are cached per object (detailsModel) so coming back is instant.
import { Network, PencilRuler, FolderOpen, MousePointerClick, Play, RefreshCw, TriangleAlert, Waypoints, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../api/client';
import { objectsApi } from '../../api/objectsClient';
import type { ObjectRef } from '../../api/types';
import type { DependencyGraph, ObjectDependency, ObjectListItem } from '../../api/types.objects';
import type { ObjectTarget } from '../../commands/types';
import { commandView, useCommandsVersion } from '../../commands/useCommands';
import { ObjectIcon } from '../common/icons';
import { DepColumn, type ColumnProps } from '../Dependencies/DependenciesPanel';
import { dependencyKey, summaryChips } from '../Dependencies/model';
import { EmptyState } from '../EmptyState/EmptyState';
import { cachedDetails, DETAILS_DEBOUNCE_MS, forgetDetails, rememberDetails } from './detailsModel';
import { groupOf, itemTypeLabel } from './model';
import './objectDetails.css';

export interface ObjectDetailsPanelProps {
  connectionId: string;
  database: string | null;
  /** The selected object; null shows the "select an object" hint. */
  item: ObjectListItem | null;
  /** Catalog version of the scope: a DDL change makes cached answers miss. */
  version: number;
  /** Bumped by the list's Refresh: forces a new request. */
  refreshNonce: number;
  onClose(): void;
  onOpen(): void;
  /** A dependency was clicked: the list selects it when it is in the scope, else opens it. */
  onPick(d: ObjectDependency): void;
  onMenu: ColumnProps['onMenu'];
}

type View = { key: string; status: 'loading' } | { key: string; status: 'ready'; graph: DependencyGraph } | { key: string; status: 'error'; error: string };

/** "Procedure", "User-defined table type". */
function kindLabel(item: ObjectListItem): string {
  const t = itemTypeLabel(item);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function initialView(key: string): View {
  const graph = cachedDetails(key);
  return graph ? { key, status: 'ready', graph } : { key, status: 'loading' };
}

export default function ObjectDetailsPanel({ connectionId, database, item, version, refreshNonce, onClose, onOpen, onPick, onMenu }: ObjectDetailsPanelProps) {
  useCommandsVersion(); // enablement of the quick actions (registry changes only)
  const ref = useMemo<ObjectRef | null>(
    () => (item ? { database, schema: item.schema, name: item.name, type: item.type } : null),
    [database, item],
  );
  const key = ref ? `${dependencyKey(connectionId, database, ref)}|${version}` : '';
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<View>(() => initialView(key));
  const handled = useRef({ nonce: 0, refresh: refreshNonce });

  useEffect(() => {
    if (!ref) return;
    // Reload / the list's Refresh: forget the cached answer and ask again right away.
    const forced = nonce !== handled.current.nonce || refreshNonce !== handled.current.refresh;
    handled.current = { nonce, refresh: refreshNonce };
    if (forced) forgetDetails(key);
    const cached = forced ? null : cachedDetails(key);
    if (cached) {
      setView({ key, status: 'ready', graph: cached });
      return;
    }
    setView((v) => (v.key === key && v.status === 'loading' ? v : { key, status: 'loading' }));
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      objectsApi.dependencies(connectionId, database, ref, ctl.signal)
        .then((graph) => {
          if (ctl.signal.aborted) return;
          rememberDetails(key, graph);
          setView({ key, status: 'ready', graph });
        })
        .catch((e) => {
          if (!ctl.signal.aborted) setView({ key, status: 'error', error: errorMessage(e) });
        });
    }, forced ? 0 : DETAILS_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [key, nonce, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const target: ObjectTarget | null = ref ? { kind: 'object', connectionId, database, ref } : null;
  const isRoutine = !!ref && ['proc', 'func', 'tablefunc', 'package'].includes(ref.type);
  const edit = target ? commandView('designer.edit', target, ref!.type === 'table' ? 'Design' : 'Edit') : null;
  const exec = target && isRoutine ? commandView('routine.execute', target, 'Execute…') : null;
  const er = target && ref!.type === 'table' ? commandView('er.openRelated', target, 'ER diagram') : null;
  const label = item ? `${item.schema ? `${item.schema}.` : ''}${item.name}` : '';

  // The first render after a selection change already shows a cached answer (no skeleton flash).
  const current: View = view.key === key ? view : initialView(key);

  return (
    <aside className="od" aria-label={item ? `Details of ${label}` : 'Details'} onKeyDown={onKeyDown} data-testid="object-details">
      <header className="od-head">
        {item ? (
          <>
            <span className={`od-tile ol-tint-${groupOf(item.type)}`} aria-hidden="true">
              <ObjectIcon type={item.type} kind={item.kind} size={18} />
            </span>
            <div className="od-title">
              <div className="od-name" title={label}>{item.name}</div>
              <div className="od-sub">
                {item.schema && <span className="od-schema">{item.schema}</span>}
                <span className="od-kind">{kindLabel(item)}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="od-title">
            <div className="od-name">Details</div>
          </div>
        )}
        <button className="icon-btn sm" onClick={onClose} aria-label="Close details" title="Close (Esc)">
          <X size={14} />
        </button>
      </header>

      {item && (
        <div className="od-actions" role="toolbar" aria-label={`Actions for ${label}`}>
          <button className="btn btn-xs" onClick={onOpen} title="Open (Enter)">
            <FolderOpen size={13} /> Open
          </button>
          {edit?.enabled && (
            <button className="btn btn-xs" onClick={edit.run} title={edit.tooltip}>
              <PencilRuler size={13} /> {edit.title}
              {edit.shortcut && <span className="od-key">{edit.shortcut}</span>}
            </button>
          )}
          {exec?.enabled && (
            <button className="btn btn-xs od-execute" onClick={exec.run} title="Execute with a parameter form">
              <Play size={12} fill="currentColor" /> Execute…
            </button>
          )}
          {er?.enabled && (
            <button className="btn btn-xs" onClick={er.run} title="Open this table and what it is related to in an ER diagram">
              <Network size={13} /> ER diagram
            </button>
          )}
        </div>
      )}

      <div className="od-body">
        {!item ? (
          <EmptyState
            compact
            icon={<MousePointerClick size={24} strokeWidth={1.5} />}
            title="Select an object"
            hint="Its dependencies show here: what it uses and what uses it."
          />
        ) : current.status === 'loading' ? (
          <div className="od-skel" role="status" aria-label="Loading dependencies">
            {[64, 48, 72, 40, 58].map((w, i) => (
              <div key={i} className="od-skel-row">
                <span className="od-skel-icon" />
                <span className="od-skel-bar" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : current.status === 'error' ? (
          <EmptyState
            compact
            icon={<TriangleAlert size={24} strokeWidth={1.5} />}
            title="Could not read the dependencies"
            hint={current.error}
            action={{ label: 'Try again', onClick: () => setNonce((n) => n + 1) }}
          />
        ) : (
          <Ready graph={current.graph} name={item.name} onPick={onPick} onMenu={onMenu} onReload={() => setNonce((n) => n + 1)} />
        )}
      </div>
    </aside>
  );
}

function Ready({ graph, name, onPick, onMenu, onReload }: { graph: DependencyGraph; name: string; onPick(d: ObjectDependency): void; onMenu: ColumnProps['onMenu']; onReload(): void }) {
  const empty = graph.uses.length + graph.usedBy.length === 0;
  const chips = summaryChips(graph);
  return (
    <>
      <div className="od-summary">
        <span className="od-chips">{chips.length ? chips.join(' · ') : 'Dependencies'}</span>
        <span className="flex-1" />
        <button className="icon-btn xs" onClick={onReload} aria-label="Reload dependencies" title="Reload">
          <RefreshCw size={12} />
        </button>
      </div>
      {empty ? (
        <EmptyState
          compact
          icon={<Waypoints size={24} strokeWidth={1.5} />}
          title="No dependencies found"
          hint={`Nothing references ${name}, and it references no other object.`}
        />
      ) : (
        <>
          <div className="od-cols">
            <DepColumn title="Uses" subtitle={`What ${name} depends on`} direction="uses" items={graph.uses} emptyText={`${name} does not reference other objects.`} rootSchema={graph.root.schema} onOpen={onPick} onMenu={onMenu} />
            <DepColumn title="Used by" subtitle={`What depends on ${name}`} direction="used" items={graph.usedBy} emptyText={`Nothing references ${name}.`} rootSchema={graph.root.schema} onOpen={onPick} onMenu={onMenu} />
          </div>
        </>
      )}
    </>
  );
}
