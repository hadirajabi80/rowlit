// Go-to-definition that waits for a lazily loaded catalog. Pure (no Monaco): the provider, the "Open definition (DDL)"
// action and the tests share it.
//
// `Sales.Customers` where `Sales` has not been loaded yet (the explorer loads a schema when it is expanded) used to
// find nothing. Here the missing schema / database is requested from the host (the engine does that in
// `pendingDefinition`), the caller shows "Loading Sales…", and the lookup repeats whenever the catalog changes, until
// the name resolves, nothing is on its way any more (the schema does not exist or failed to load) or the wait times out.
import type { DefinitionResult, Intel, PendingDefinition } from '../intel';

/** How long a navigation waits for a schema / database to load. */
export const DEFINITION_WAIT_MS = 15000;

/** The part of a ModelBinding the lookup needs. */
export interface DefinitionHost {
  uri: string;
  intel: Intel;
  /** Listeners to call after the editor handed the intel a new catalog snapshot / foreign catalogs. */
  catalogWaiters?: Set<() => void>;
}

/** Tell everyone waiting on this editor's catalog that it changed. */
export function notifyCatalogChanged(b: { catalogWaiters?: Set<() => void> } | undefined | null): void {
  if (b?.catalogWaiters) for (const w of [...b.catalogWaiters]) w();
}

export type DefinitionOutcome =
  | { kind: 'found'; def: DefinitionResult }
  /** Nothing to open: `waited` is set when we waited for a schema that then did not have the name (or timed out). */
  | { kind: 'none'; waited: PendingDefinition | null; timedOut: boolean }
  | { kind: 'cancelled' };

export interface ResolveOptions {
  /** Called once when the lookup starts waiting (show "Loading Sales…"). */
  onPending?: (p: PendingDefinition) => void;
  isCancelled?: () => boolean;
  timeoutMs?: number;
}

function waitForChange(b: DefinitionHost, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const waiters = (b.catalogWaiters ??= new Set());
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (changed: boolean) => {
      if (timer) clearTimeout(timer);
      waiters.delete(wake);
      off();
      resolve(changed);
    };
    const wake = () => done(true);
    waiters.add(wake);
    off = b.intel.onDidChange(wake);
    timer = setTimeout(() => done(false), ms);
  });
}

export async function resolveDefinition(b: DefinitionHost, offset: number, opts: ResolveOptions = {}): Promise<DefinitionOutcome> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFINITION_WAIT_MS);
  let waited: PendingDefinition | null = null;
  for (;;) {
    if (opts.isCancelled?.()) return { kind: 'cancelled' };
    const def = b.intel.definition(b.uri, offset);
    if (def) return { kind: 'found', def };
    const pending = b.intel.pendingDefinition(b.uri, offset);
    if (!pending) return { kind: 'none', waited, timedOut: false };
    if (!waited) opts.onPending?.(pending);
    waited = pending;
    const left = deadline - Date.now();
    if (left <= 0 || !(await waitForChange(b, left))) {
      if (opts.isCancelled?.()) return { kind: 'cancelled' };
      return { kind: 'none', waited, timedOut: true };
    }
  }
}
