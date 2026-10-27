// "Add to link…" (explorer table / view menus, Objects tab, Ctrl+P): pick the link the table is mounted into, or start a
// new one. The table joins the link's member for its connection and schema (a new member when there is none). Lazy chunk.
import { CircleAlert, Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { linkDefinitionOf } from '../../../api/links';
import { runCommand } from '../../../commands/registry';
import { useCatalog } from '../../../store/catalog';
import { getConnection, useConnections } from '../../../store/connections';
import { toast } from '../../../store/ui';
import { Dialog } from '../../common/Dialog';
import { addTableToDefinition, initialMember, isLink, profileInput, type TableSource } from './addToLink';
import './wizard.css';

const NEW = '\u0000new';

export function AddToLinkDialog({ source, onClose }: { source: TableSource; onClose: () => void }) {
  const connections = useConnections((c) => c.connections);
  const links = useMemo(() => connections.filter(isLink), [connections]);
  const origin = getConnection(source.connectionId);
  const [choice, setChoice] = useState<string>(links[0]?.id ?? NEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `${source.schema ? `${source.schema}.` : ''}${source.name}`;

  const submit = async () => {
    setError(null);
    if (choice === NEW) {
      onClose();
      // WP-C's editor starts with this member (docs/wp-notes/links/WP-D.md)
      void runCommand('links.new', { members: [initialMember(source, origin?.name ?? 'db')], connectAfter: false });
      return;
    }
    const profile = links.find((l) => l.id === choice);
    if (!profile) return;
    const result = addTableToDefinition(linkDefinitionOf(profile), source, origin?.name ?? 'db', useCatalog.getState().conns[source.connectionId]?.databases?.current ?? null);
    if (result.already) {
      toast('info', `${label} is already in ${profile.name}`, `Query it as ${result.alias}.${result.table}.`);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await useConnections.getState().save(profileInput(profile, result.definition), profile.id);
      toast('success', `Added ${label} to ${profile.name}`, `Query it as ${result.alias}.${result.table}${result.newMember ? ` (new member "${result.alias}")` : ''}.`, {
        label: 'Open query builder',
        run: () => void runCommand('links.builder', { connectionId: profile.id }),
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add to link"
      onClose={onClose}
      width={460}
      className="lw-dialog"
      onSubmit={() => void submit()}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{choice === NEW ? 'Continue' : 'Add'}</button>
        </>
      }
    >
      <div className="lw-body">
        <p className="lw-lede">
          Mount <strong>{label}</strong>{origin ? <> of <strong>{origin.name}</strong></> : null} in a linked database to join it with tables of other connections.
        </p>
        <ul className="lw-list" role="radiogroup" aria-label="Link">
          {links.map((l) => {
            const members = linkDefinitionOf(l).members.length;
            return (
              <li key={l.id}>
                <button type="button" role="radio" aria-checked={choice === l.id} className="lw-list-item" onClick={() => setChoice(l.id)} data-autofocus={choice === l.id || undefined}>
                  <Link2 size={14} aria-hidden="true" />
                  <span>{l.name}</span>
                  <span className="lw-list-sub">{members} {members === 1 ? 'member' : 'members'}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" role="radio" aria-checked={choice === NEW} className="lw-list-item" onClick={() => setChoice(NEW)}>
              <Plus size={14} aria-hidden="true" />
              <span>New link…</span>
              <span className="lw-list-sub">starts with this table</span>
            </button>
          </li>
        </ul>
        {error && <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{error}</span></div>}
      </div>
    </Dialog>
  );
}
