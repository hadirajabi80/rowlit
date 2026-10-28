// "Import connections…": read a .rowlit-connections.json, ask for the passphrase when it carries encrypted passwords, show
// what each connection would become (new / replace the one with the same name / skip) and import. Lazy chunk (mounted by
// ./PortabilityHost). The file text and the passphrase live in this component's state only.
import { FileUp, KeyRound, LoaderCircle } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { errorMessage } from '../../api/client';
import { getPlatform } from '../../platform';
import { useConnections } from '../../store/connections';
import { toast } from '../../store/ui';
import { ProviderLogo } from '../../theme/brand/ProviderLogo';
import { Dialog } from '../common/Dialog';
import { Select, type SelectOption } from '../common/Select';
import { pluralize } from '../common/text';
import {
  actionsOf, CONNECTIONS_FILE_FILTERS, importSummary, portabilityApi,
  type ImportAction, type ImportPreviewDto, type ImportPreviewItem, type ImportResultDto,
} from './portability';
import './portability.css';

interface Loaded {
  name: string;
  content: string;
}

export function ImportConnectionsDialog({ onClose }: { onClose: () => void }) {
  const saved = useConnections((s) => s.connections);
  const [file, setFile] = useState<Loaded | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [pass, setPass] = useState('');
  /** The passphrase that unlocked the file (what the import sends). */
  const [unlockedWith, setUnlockedWith] = useState<string | undefined>();
  const [choices, setChoices] = useState<Record<string, ImportAction>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passError, setPassError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [dragging, setDragging] = useState(false);

  const nameOf = (id: string | null) => saved.find((c) => c.id === id)?.name ?? '';
  const items = useMemo(() => preview?.items ?? [], [preview]);
  const actions = useMemo(() => actionsOf(items, choices), [items, choices]);
  const importing = actions.filter((a) => a.action !== 'skip').length;

  const load = async (loaded: Loaded) => {
    setBusy(true);
    setError(null);
    setPassError(null);
    try {
      const p = await portabilityApi.previewImport(loaded.content);
      setFile(loaded);
      setPreview(p);
      setChoices({});
      setUnlockedWith(undefined);
      setPass('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const f = await getPlatform().openTextFile({ filters: CONNECTIONS_FILE_FILTERS });
    if (f) await load({ name: f.name, content: f.content });
  };

  const drop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await load({ name: f.name, content: await f.text() });
  };

  const unlock = async () => {
    if (!file || !pass) return;
    setBusy(true);
    setPassError(null);
    try {
      const p = await portabilityApi.previewImport(file.content, pass);
      setPreview(p);
      setUnlockedWith(p.unlocked ? pass : undefined);
    } catch (e) {
      setPassError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await portabilityApi.importConnections(file.content, actions, unlockedWith);
      setResult(r);
      await useConnections.getState().load();
      toast(r.errors.length ? 'warning' : 'success', `Imported connections: ${importSummary(r)}`, r.passwordsImported ? 'Passwords were imported.' : undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const optionsFor = (i: ImportPreviewItem): SelectOption<ImportAction>[] => [
    { value: 'new', label: 'Import as new', disabled: !!i.problem },
    ...(i.existingId ? [{ value: 'update' as const, label: `Replace “${nameOf(i.existingId)}”`, disabled: !!i.problem }] : []),
    { value: 'skip', label: 'Skip' },
  ];

  if (result) {
    return (
      <Dialog title="Import connections" onClose={onClose} width={520} className="cp-dialog" footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <p className="cp-result" role="status">{importSummary(result)}.</p>
        {result.passwordsImported && <p className="cp-hint">Passwords, SSH passwords and key passphrases were imported into the secret store of this machine.</p>}
        {result.errors.length > 0 && (
          <ul className="cp-errors" aria-label="Problems">
            {result.errors.map((e) => <li key={e.ref}><strong>{e.name || e.ref}</strong>: {e.message}</li>)}
          </ul>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Import connections"
      onClose={onClose}
      width={640}
      className="cp-dialog"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={!preview || importing === 0 || busy}>
            {busy && preview ? <LoaderCircle size={14} className="spin" aria-hidden /> : <FileUp size={14} aria-hidden />} Import {importing > 0 ? pluralize(importing, 'connection') : ''}
          </button>
        </>
      }
    >
      <div
        className={`cp-drop${dragging ? ' on' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void drop(e)}
        data-testid="cp-drop"
      >
        <button className="btn" onClick={() => void choose()} disabled={busy}>
          {busy && !preview ? <LoaderCircle size={14} className="spin" aria-hidden /> : <FileUp size={14} aria-hidden />} {file ? 'Choose another file…' : 'Choose file…'}
        </button>
        <span className="cp-file">{file ? file.name : 'or drop a .rowlit-connections.json here'}</span>
      </div>
      {error && <p className="cp-error" role="alert">{error}</p>}

      {preview?.encrypted && (
        <div className="cp-unlock">
          <KeyRound size={14} aria-hidden />
          {unlockedWith ? (
            <span role="status">Unlocked: the passwords in this file will be imported.</span>
          ) : (
            <>
              <label htmlFor="cp-unlock">This file has encrypted passwords. Passphrase</label>
              <input
                id="cp-unlock" className="input" type="password" autoComplete="off" value={pass}
                onChange={(e) => { setPass(e.target.value); setPassError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void unlock(); } }}
                aria-invalid={!!passError}
              />
              <button className="btn" onClick={() => void unlock()} disabled={!pass || busy}>Unlock</button>
            </>
          )}
        </div>
      )}
      {preview?.encrypted && !unlockedWith && !passError && <p className="cp-hint">Without the passphrase the connections are imported without their passwords.</p>}
      {passError && <p className="cp-error" role="alert">{passError}</p>}

      {preview && (
        <table className="details-table cp-table" aria-label="Connections in the file">
          <thead>
            <tr><th>Connection</th><th>Folder</th><th>What to do</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.ref} className={i.problem ? 'cp-bad' : undefined}>
                <td>
                  <span className="cp-conn">
                    <ProviderLogo providerId={i.providerId} size={14} />
                    <span className="cp-name">{i.name || '(no name)'}</span>
                    {i.ssh && <span className="pill">SSH</span>}
                    {i.hasSecrets && <span className="pill" title="The file holds a password for this connection">password</span>}
                  </span>
                  {i.problem && <div className="cp-problem on">{i.problem}</div>}
                </td>
                <td>{i.folder ?? ''}</td>
                <td>
                  <Select
                    size="sm" aria-label={`Action for ${i.name}`} value={i.problem ? 'skip' : choices[i.ref] ?? i.action}
                    options={optionsFor(i)} disabled={!!i.problem} onChange={(v) => setChoices((c) => ({ ...c, [i.ref]: v }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
