// Linked databases, WP-D: links.nativeLink ("Create native link…"), the secondary way to query across servers: the engine writes a
// script (linked server, foreign data wrapper, DB link, FEDERATED table, ClickHouse engine) with placeholders for secrets and
// the wizard opens it in a console on the target server. Rowlit never runs it. The dialog is a lazy chunk.
import { objectTargetOf, targetOf } from '../../../commands/core';
import { extendContextMenu } from '../../../commands/menuModel';
import { registerCommands, type Command } from '../../../commands/registry';
import { isConnectionTarget } from '../../../commands/types';
import { LINK_PROVIDER_ID } from '../../../api/links';
import { useConnections } from '../../../store/connections';
import { getActiveConsole } from '../../../store/tabs';
import { isLinkId } from '../materialize/args';
import type { NativeLinkRequest } from './NativeLinkDialog';

const anyLink = () => useConnections.getState().connections.some((c) => c.providerId === LINK_PROVIDER_ID);

/** The link a command acts on: explicit `{linkId | connectionId}`, the explorer target, the active console, else none (the dialog asks). */
export function nativeRequestOf(args?: unknown): NativeLinkRequest | null {
  const r = args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const explicit = str(r?.linkId) ?? str(r?.connectionId);
  if (explicit && !(r && 'kind' in r)) {
    return isLinkId(explicit) ? { linkId: explicit, memberAlias: str(r?.memberAlias), targetConnectionId: str(r?.targetConnectionId) } : null;
  }
  const t = targetOf(args);
  if (isConnectionTarget(t)) return isLinkId(t.connectionId) ? { linkId: t.connectionId } : null;
  const o = objectTargetOf(args);
  if (o) return isLinkId(o.connectionId) ? { linkId: o.connectionId, memberAlias: o.ref.schema } : null;
  // a target of another kind (a database of a normal connection …) is not ours
  if (r && 'kind' in r) return null;
  const active = getActiveConsole();
  if (active && isLinkId(active.connectionId)) return { linkId: active.connectionId };
  return anyLink() ? { linkId: null } : null;
}

export async function openNativeLink(request: NativeLinkRequest): Promise<void> {
  const [{ mountDialog }, { NativeLinkDialog }] = await Promise.all([import('../materialize/mount'), import('./NativeLinkDialog')]);
  mountDialog('links.nativeLink', 'the native link wizard', (close) => <NativeLinkDialog request={request} onClose={close} />);
}

const COMMANDS: Command[] = [
  {
    id: 'links.nativeLink', title: 'Create native link…', category: 'Database', icon: 'Plug',
    keywords: 'link linked server fdw foreign data wrapper database link federated native script postgres_fdw sp_addlinkedserver',
    when: (a) => !!nativeRequestOf(a),
    run: async (a) => {
      const request = nativeRequestOf(a);
      if (request) await openNativeLink(request);
    },
  },
];

let registered = false;

/** Called from components/Links/commands.ts (block LINKS-WPD). */
export function registerNativeLinkCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands(COMMANDS);
  // the connection menu: only a link's row shows it (the command's `when` needs a link target); WP-C's own explorer.link menu too
  for (const id of ['explorer.connection', 'explorer.link']) extendContextMenu(id, [{ command: 'links.nativeLink', optional: true, hideDisabled: true }]);
}
