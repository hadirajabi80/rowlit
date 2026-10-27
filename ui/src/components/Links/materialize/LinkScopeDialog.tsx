// "Link database…" / "Link schema…" (explorer database and schema nodes, MongoDB databases): pick the link that mounts the
// whole database / schema as a new member, or start a new one with it. Lazy chunk.
import { CircleAlert, Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { runCommand } from '../../../commands/registry';
import { getConnection, useConnections } from '../../../store/connections';
import { toast } from '../../../store/ui';
import { Dialog } from '../../common/Dialog';
import { isLink, profileInput } from './addToLink';
import { addScopeToDefinition, howToQuery, linkDefinitionOf, scopeMember, type ScopeSource } from './linkScope';
import './wizard.css';

const NEW = '\u0000new';

export function LinkScopeDialog({ source, onClose }: { source: ScopeSource; onClose: () => void }) {
  const connections = useConnections((c) => c.connections);
  const links = useMemo(() => connections.filter(isLink), [connections]);
  const origin = getConnection(source.connectionId);
  const [choice, setChoice] = useState<string>(links[0]?.id ?? NEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = source.scope === 'database' ? 'database' : 'schema';
  const label = source.scope === 'schema' && source.database ? `${source.database}.${source.name}` : source.name;
  const connName = origin?.name ?? 'db';

  const submit = async () => {
    setError(null);
    if (choice === NEW) {
      onClose();
      void runCommand('links.new', { members: [scopeMember(source, connName)], connectAfter: false });
      return;
    }
    const profile = links.find((l) => l.id === choice);
    if (!profile) return;
    const r = addScopeToDefinition(linkDefinitionOf(profile), source, connName);
    if (r.already) {
      toast('info', `${label} is already in ${profile.name}`, `Source “${r.member.alias}” mounts it. ${howToQuery(r.member, source.providerId)}`);
      onClose();
      return;
    }
    setBusy(true);
    try {
      await useConnections.getState().save(profileInput(profile, r.definition), profile.id);
      toast('success', `Linked the ${what} ${label} into ${profile.name}`, `New source “${r.member.alias}”. ${howToQuery(r.member, source.providerId)}`, {
        label: 'Open query builder',
        run: () => void runCommand('links.builder', { connectionId: profile.id }),
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const title = source.scope === 'database' ? 'Link database' : 'Link schema';
  return (
    <Dialog
      title={title}
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
          Mount every table of the {what} <strong>{label}</strong>{origin ? <> of <strong>{origin.name}</strong></> : null} in a linked database
          to join them with tables of other connections. Its tables load when a query or the builder uses them.
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
              <span className="lw-list-sub">starts with this {what}</span>
            </button>
          </li>
        </ul>
        {error && <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{error}</span></div>}
      </div>
    </Dialog>
  );
}
