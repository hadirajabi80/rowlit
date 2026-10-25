import { Gauge } from 'lucide-react';
import { lazy, Suspense } from 'react';
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
  const snapshot = useResources((s) => s.snapshot);
  const level = useResources((s) => s.level);
  const open = useResources((s) => s.open);
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
        className={`sb-item sb-button sb-resources level-${level}`}
        onClick={() => setOpen(!open)}
        title={title}
        aria-label={`Resources: ${snapshot ? `${formatBytes(used)} memory, ${pluralize(conns ?? 0, 'open connection')}` : 'memory and connections'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Gauge size={12} aria-hidden="true" />
        {snapshot ? <span className="tabular">{formatBytes(used)}</span> : null}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ResourcesPopover onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </span>
  );
}
