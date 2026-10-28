// "Export connections…": choose connections, optionally include their passwords (sealed with a passphrase), save a
// .rowlit-connections.json. Lazy chunk (mounted by ./PortabilityHost). Passwords are off by default; the passphrase
// lives in this component's state only.
import { Download, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { getPlatform } from '../../platform';
import { useConnections } from '../../store/connections';
import { toast } from '../../store/ui';
import { pluralize } from '../common/text';
import { Dialog } from '../common/Dialog';
import { CONNECTIONS_FILE_FILTERS, exportGroups, passphraseProblem, portabilityApi } from './portability';
import './portability.css';

export function ExportConnectionsDialog({ preselect, onClose }: { preselect?: string[]; onClose: () => void }) {
  const connections = useConnections((s) => s.connections);
  const groups = useMemo(() => exportGroups(connections), [connections]);
  const exportable = useMemo(() => groups.flatMap((g) => g.connections), [groups]);
  const [picked, setPicked] = useState<Set<string>>(() => {
    const wanted = (preselect ?? []).filter((id) => exportable.some((c) => c.id === id));
    return new Set(wanted.length ? wanted : exportable.map((c) => c.id));
  });
  const [withPasswords, setWithPasswords] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = withPasswords ? passphraseProblem(pass, confirm) : null;
  const linked = connections.length - exportable.length;
  const canExport = picked.size > 0 && !problem && !busy;

  const toggle = (ids: string[], on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await portabilityApi.exportConnections({
        ids: exportable.filter((c) => picked.has(c.id)).map((c) => c.id),
        includeSecrets: withPasswords,
        passphrase: withPasswords ? pass : undefined,
      });
      const where = await getPlatform().saveFile({ suggestedName: res.fileName, filters: CONNECTIONS_FILE_FILTERS, content: res.content, mime: 'application/json' });
      if (!where) return; // the save dialog was cancelled: keep this dialog open
      const detail = [
        where,
        res.secretsIncluded ? `${pluralize(res.secretsIncluded, 'connection')} with passwords (encrypted)` : 'no passwords',
        res.skipped.length ? `not exported: ${res.skipped.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      toast('success', `Exported ${pluralize(res.count, 'connection')}`, detail);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Export connections"
      onClose={onClose}
      width={520}
      className="cp-dialog"
      onSubmit={() => canExport && void run()}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={!canExport}>
            {busy ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Download size={14} aria-hidden />} Export…
          </button>
        </>
      }
    >
      <p className="cp-hint">
        Saves the settings of the chosen connections, SSH tunnels included, to a file you can share or import on another
        machine. Key files and SQLite paths are exported as they are.
      </p>

      <div className="cp-list" role="group" aria-label="Connections to export">
        {exportable.length === 0 && <p className="cp-empty">There are no connections to export.</p>}
        {groups.map((g) => {
          const ids = g.connections.map((c) => c.id);
          const on = ids.filter((id) => picked.has(id)).length;
          return (
            <div key={g.folder} className="cp-group">
              {(groups.length > 1 || g.folder) && (
                <label className="check cp-group-head">
                  <input
                    type="checkbox"
                    checked={on === ids.length}
                    ref={(el) => { if (el) el.indeterminate = on > 0 && on < ids.length; }}
                    onChange={(e) => toggle(ids, e.target.checked)}
                    aria-label={`Select all in ${g.folder || 'no folder'}`}
                  />
                  <strong>{g.folder || 'No folder'}</strong>
                  <span className="cp-count">{on}/{ids.length}</span>
                </label>
              )}
              {g.connections.map((c) => (
                <label key={c.id} className="check cp-item">
                  <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} />
                  <span className="cp-name">{c.name}</span>
                  <span className="cp-meta">{c.providerId}{c.props['ssh.enabled'] === true ? ' · SSH' : ''}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="cp-bulk">
        <button type="button" className="link-btn" onClick={() => toggle(exportable.map((c) => c.id), true)}>Select all</button>
        <button type="button" className="link-btn" onClick={() => toggle(exportable.map((c) => c.id), false)}>Select none</button>
        {linked > 0 && <span className="cp-note">{pluralize(linked, 'linked database')} cannot be exported (they point at connections of this machine).</span>}
      </div>

      <label className="check cp-pw-toggle">
        <input type="checkbox" checked={withPasswords} onChange={(e) => setWithPasswords(e.target.checked)} />
        Include passwords (encrypted with a passphrase)
      </label>
      {!withPasswords && <p className="cp-hint">No password, SSH password or key passphrase goes into the file.</p>}
      {withPasswords && (
        <div className="cp-pass">
          <p className="cp-warn">
            <ShieldAlert size={14} aria-hidden /> Passwords, SSH passwords and key passphrases are encrypted (AES-256-GCM, key from
            PBKDF2-SHA256). Whoever has the file and the passphrase can read them. The passphrase cannot be recovered: share it
            separately from the file.
          </p>
          <div className="form-grid">
            <label className="form-label" htmlFor="cp-pass">Passphrase</label>
            <input id="cp-pass" className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={!!problem && !!pass} />
            <label className="form-label" htmlFor="cp-pass2">Repeat</label>
            <input id="cp-pass2" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <p className={`cp-problem${problem && pass ? ' on' : ''}`} role="status">{pass ? problem : ''}</p>
        </div>
      )}
      {error && <p className="cp-error" role="alert">{error}</p>}
    </Dialog>
  );
}
