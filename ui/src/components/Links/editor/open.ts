// Light entry of the link editor (imported by commands.ts): the request shape and a lazy opener. The dialog itself
// (./LinkEditorDialog.tsx, ./host.tsx) is a lazy chunk.
import type { LinkMember } from '../../../api/links';

/** A source table to mount (explorer "Add to link…", a drop on the editor). */
export interface LinkEditorTable {
  connectionId: string;
  /** Catalog database key (null for providers without a database level). */
  database: string | null;
  schema: string | null;
  name: string;
  type?: string | null;
}

export interface LinkEditorRequest {
  mode: 'new' | 'edit' | 'duplicate';
  /** The link (edit / duplicate). */
  connectionId?: string | null;
  /** Explorer folder of a new link (default "Linked databases"). */
  folder?: string | null;
  /** Open the query builder after saving a new link. */
  connectAfter?: boolean;
  /** Ready-made members to add (WP-D's "Add to link… › New link…" passes one). */
  members?: LinkMember[];
  /** Tables to add to the link when the dialog opens (each becomes / joins a member). */
  addTables?: LinkEditorTable[];
}

/** Opens the link editor dialog (loads its chunk on first use). */
export function openLinkEditor(req: LinkEditorRequest): Promise<void> {
  return import('./host').then((m) => m.showLinkEditor(req));
}
