import { ChevronUp, Gauge, LoaderCircle } from 'lucide-react';
import { lazy, Suspense, useId, useRef } from 'react';
import { formatBytes, useResources } from '../../store/resources';
import { pluralize } from '../common/text';
import './resourcesItem.css';

// The popover (connection list, Close buttons, Free memory now) loads on first open: the initial bundle stays small.
const ResourcesPopover = lazy(() => import('./ResourcesPopover'));

/**
 * Resources (docs/resources.md): memory in use (engine + this app's windows) and the connections that hold server
 * resources; amber above 85% of the memory limit, red above it. A click opens the Resources popover.
 */
export function ResourcesItem() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const snapshot = useResources((s) => s.snapshot);
  const level = useResources((s) => s.level);
  const open = useResources((s) => s.open);
  const trimming = useResources((s) => s.trimming);
  const setOpen = useResources((s) => s.setOpen);
  const used = snapshot?.memory.usedBytes ?? null;
  const limit = snapshot?.memory.limitBytes ?? null;
  const conns = snapshot?.totals.openConnections ?? null;
  const title = snapshot
    ? `Memory: ${formatBytes(used)} of ${formatBytes(limit)}${snapshot.memory.autoLimit ? ' (auto limit)' : ''} · ${pluralize(conns ?? 0, 'connection')} holding server resources. Click for details.`
    : 'Resources and memory';
  return (
    <span className="sb-resources-anchor">
      <button
        type="button"
        ref={anchorRef}
        className={`sb-item sb-button sb-resources level-${level}${open ? ' on' : ''}`}
        onClick={() => setOpen(!open)}
        title={title}
        aria-label={`Resources: ${snapshot ? `${formatBytes(used)} memory, ${pluralize(conns ?? 0, 'open connection')}` : 'memory and connections'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
      >
        {trimming ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : <Gauge size={12} aria-hidden="true" />}
        <span className="tabular">{snapshot ? formatBytes(used) : 'Memory'}</span>
        <ChevronUp size={10} className="sb-resources-chevron" aria-hidden="true" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <ResourcesPopover id={popoverId} anchorRef={anchorRef} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </span>
  );
}
