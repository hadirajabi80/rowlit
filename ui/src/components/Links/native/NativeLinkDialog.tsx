// Native link wizard (plan-links 3): the other way to query across servers. Pick a link member and a target server; the
// engine writes the script (linked server / foreign data wrapper / DB link / FEDERATED / ClickHouse engine) with
// <password>-style placeholders, and "Open in console" puts it in a console on the target. Rowlit never runs it. Lazy chunk.
import { ClipboardCopy, CircleAlert, Info, LoaderCircle, SquareTerminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { linksApi, type NativeLinkKind, type NativeScriptResult } from '../../../api/links';
import { useConnections } from '../../../store/connections';
import { useTabs } from '../../../store/tabs';
import { toast } from '../../../store/ui';
import { Dialog } from '../../common/Dialog';
import '../materialize/wizard.css';
import { connectionMembers, kindLabel, nativeTargets, scriptParts, scriptTitle } from './model';

export interface NativeLinkRequest {
  /** The link; empty: the dialog asks. */
  linkId?: string | null;
  memberAlias?: string | null;
  targetConnectionId?: string | null;
}

export const SCRIPT_DEBOUNCE_MS = 250;

async function copyScript(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', 'Script copied');
  } catch {
    toast('error', 'Could not copy the script', 'Select the script in the box and copy it from there.');
  }
}

export function NativeLinkDialog({ request, onClose }: { request: NativeLinkRequest; onClose: () => void }) {
  const connections = useConnections((c) => c.connections);
  const links = useMemo(() => connections.filter((c) => c.providerId === 'linked'), [connections]);
  const [linkId, setLinkId] = useState(request.linkId && links.some((l) => l.id === request.linkId) ? request.linkId : links[0]?.id ?? '');
  const link = links.find((l) => l.id === linkId);
  const members = useMemo(() => connectionMembers(link), [link]);
  const [alias, setAlias] = useState(request.memberAlias ?? '');
  const member = members.find((m) => m.alias === alias) ?? members[0];
  const targets = useMemo(() => nativeTargets(connections, member), [connections, member]);
  const [targetId, setTargetId] = useState(request.targetConnectionId ?? '');
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const [kind, setKind] = useState<NativeLinkKind | ''>('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<NativeScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const memberAlias = member?.alias;
  const targetCid = target?.id;
  useEffect(() => {
    if (!linkId || !memberAlias || !targetCid) {
      seq.current++;
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const mine = ++seq.current;
      linksApi.nativeScript(linkId, { targetConnectionId: targetCid, memberAlias, ...(kind ? { kind } : {}), ...(name.trim() ? { name: name.trim() } : {}) }).then(
        (r) => {
          if (mine !== seq.current || !alive.current) return;
          setResult(r);
          setError(null);
          setLoading(false);
        },
        (e) => {
          if (mine !== seq.current || !alive.current) return;
          setResult(null);
          setError(errorMessage(e));
          setLoading(false);
        },
      );
    }, SCRIPT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [linkId, memberAlias, targetCid, kind, name]);

  const parts = useMemo(() => (result ? scriptParts(result.script, result.placeholders) : []), [result]);
  const kinds = result?.availableKinds ?? [];

  const openInConsole = () => {
    if (!result || !target) return;
    useTabs.getState().newConsole({ connectionId: target.id, database: null, text: result.script, title: scriptTitle(member?.alias ?? 'link') });
    onClose();
  };

  return (
    <Dialog
      title="Create native link"
      onClose={onClose}
      width="min(760px, calc(100vw - 32px))"
      className="lw-dialog"
      ariaLabel="Create native link"
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" disabled={!result} onClick={() => result && void copyScript(result.script)}>
            <ClipboardCopy size={14} aria-hidden="true" /> Copy script
          </button>
          <button className="btn btn-primary" disabled={!result || !target} onClick={openInConsole}>
            <SquareTerminal size={14} aria-hidden="true" /> Open in console
          </button>
        </>
      }
    >
      <div className="lw-body">
        <p className="lw-lede">
          A native link lets one server query another by itself, with no Rowlit in between. This writes the script for the server that should reach the member; you review it, fill in the placeholders and run it. Rowlit never executes it.
        </p>

        <fieldset className="lw-group">
          <legend className="lw-legend">Reach</legend>
          <div className="lw-where">
            {links.length > 1 && (
              <label className="lw-field">
                <span className="lw-label">Link</span>
                <select className="input" aria-label="Link" value={linkId} onChange={(e) => { setLinkId(e.target.value); setAlias(''); }}>
                  {links.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
            <label className="lw-field">
              <span className="lw-label">Member database</span>
              <select className="input" aria-label="Member" value={member?.alias ?? ''} onChange={(e) => setAlias(e.target.value)} disabled={members.length === 0}>
                {members.length === 0 && <option value="">No member to reach</option>}
                {members.map((m) => <option key={m.alias} value={m.alias}>{m.label || m.alias}{m.label && m.label !== m.alias ? ` (${m.alias})` : ''}</option>)}
              </select>
            </label>
            <label className="lw-field">
              <span className="lw-label">From server</span>
              <select className="input" aria-label="Target connection" value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)} disabled={targets.length === 0}>
                {targets.length === 0 && <option value="">No connection can host a native link</option>}
                {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          <div className="lw-where">
            <label className="lw-field">
              <span className="lw-label">Kind</span>
              <select className="input" aria-label="Kind" value={result?.kind ?? kind} onChange={(e) => setKind(e.target.value as NativeLinkKind)} disabled={kinds.length < 2}>
                {kinds.length === 0 && <option value="">{kind ? kindLabel(kind) : 'Default for this pair'}</option>}
                {kinds.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </label>
            <label className="lw-field">
              <span className="lw-label">Name of the native link</span>
              <input className="input" aria-label="Name" value={name} placeholder="derived from the alias" spellCheck={false} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          {links.length === 0 && <div className="lw-msg lw-info" role="status"><Info size={14} aria-hidden="true" /><span>There is no linked database yet. Create one first; its members are what the script reaches.</span></div>}
          {link && members.length === 0 && <div className="lw-msg lw-info" role="status"><Info size={14} aria-hidden="true" /><span>This link has no member that lives in a database server.</span></div>}
        </fieldset>

        <section className="lw-preview" aria-label="Script" aria-busy={loading}>
          <header className="lw-preview-head">
            <h3 className="lw-h">Script{target ? <> for {target.name}</> : null}</h3>
            {loading && <LoaderCircle size={14} className="lw-spin" aria-label="Writing the script" />}
          </header>
          {error ? (
            <div className="lw-msg lw-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{error}</span></div>
          ) : result ? (
            <>
              <pre className="lw-script" tabIndex={0} aria-label="Native link script">{parts.map((p, i) => (p.placeholder ? <mark key={i}>{p.text}</mark> : p.text))}</pre>
              {result.placeholders.length > 0 && (
                <div className="lw-chips" aria-label="Placeholders to replace">
                  <span className="lw-note">Replace before running:</span>
                  {result.placeholders.map((p) => <code key={p} className="lw-chip">{p}</code>)}
                </div>
              )}
              {result.notes.length > 0 && <ul className="lw-notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </>
          ) : (
            <p className="lw-help">{member && target ? 'Writing the script…' : 'Choose a member and a server to see the script.'}</p>
          )}
        </section>
      </div>
    </Dialog>
  );
}
