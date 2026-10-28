import { useMemo, useState } from 'react';
import type { SecurityChangeRequest, SecurityKind } from '../../api/types.security';
import { Dialog } from '../common/Dialog';
import { securityApi } from './api';
import { blankChange } from './model';

const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'USAGE', 'CREATE', 'ALTER', 'CONTROL'];
export function ChangeDialog({ connectionId, initial, onClose, onApplied }: { connectionId: string; initial: SecurityChangeRequest; onClose: () => void; onApplied: () => void }) {
  const [r, setR] = useState(initial); const [preview, setPreview] = useState<string[] | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const needsPassword = r.action === 'password' || (r.action === 'create' && r.kind !== 'role');
  const needsGrant = r.action === 'grant' || r.action === 'revoke';
  const needsRole = r.action === 'membership';
  const valid = useMemo(() => !!r.name.trim() && (!needsPassword || !!r.password) && (!needsRole || !!r.role?.trim()) && (!needsGrant || !!r.privileges?.length), [r, needsPassword, needsRole, needsGrant]);
  const patch = (p: Partial<SecurityChangeRequest>) => { setR((x) => ({ ...x, ...p })); setPreview(null); setError(null); };
  const showPreview = async () => { setBusy(true); try { setPreview((await securityApi.script(connectionId, r)).previewStatements); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); try { await securityApi.apply(connectionId, initial.database ?? null, r); onApplied(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <Dialog title="Security change" ariaLabel="Security change" onClose={onClose} width={640} onSubmit={() => void (preview ? apply() : showPreview())}
    footer={<><button className="btn" onClick={onClose}>Cancel</button>{preview ? <><button className="btn" onClick={() => setPreview(null)}>Back</button><button className="btn btn-danger" disabled={busy} onClick={() => void apply()}>Confirm and apply</button></> : <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void showPreview()}>Preview SQL</button>}</>}>
    {!preview ? <div className="security-form">
      <label>Action<select value={r.action} onChange={(e) => patch(blankChange(e.target.value as SecurityChangeRequest['action'], r.kind, r.name))}><option value="create">Create</option><option value="password">Change password</option><option value="grant">Grant</option><option value="revoke">Revoke</option><option value="membership">Role membership</option><option value="drop">Drop</option></select></label>
      <label>Kind<select value={r.kind} onChange={(e) => patch({ kind: e.target.value as SecurityKind })}><option value="user">User</option><option value="login">Login</option><option value="role">Role</option></select></label>
      <label>Name<input value={r.name} onChange={(e) => patch({ name: e.target.value })}/></label>
      {(r.action === 'create' || r.host) && <label>Host (MySQL/MariaDB)<input value={r.host ?? '%'} onChange={(e) => patch({ host: e.target.value })}/></label>}
      {needsPassword && <label>Password<input type="password" autoComplete="new-password" value={r.password ?? ''} onChange={(e) => patch({ password: e.target.value })}/></label>}
      {needsRole && <><label>Role<input value={r.role ?? ''} onChange={(e) => patch({ role: e.target.value })}/></label><label className="check"><input type="checkbox" checked={!!r.remove} onChange={(e) => patch({ remove: e.target.checked })}/> Remove membership</label></>}
      {needsGrant && <><label>Scope<select value={r.objectType ?? 'table'} onChange={(e) => patch({ objectType: e.target.value as SecurityChangeRequest['objectType'] })}><option value="global">Global</option><option value="database">Database</option><option value="schema">Schema</option><option value="table">Table/object</option></select></label>
        {(r.objectType === 'global' ? false : true) && <label>Database<input value={r.database ?? ''} onChange={(e) => patch({ database: e.target.value })}/></label>}
        {(r.objectType === 'schema' || r.objectType === 'table') && <label>Schema<input value={r.schema ?? ''} onChange={(e) => patch({ schema: e.target.value })}/></label>}
        {r.objectType === 'table' && <label>Table/object<input value={r.object ?? ''} onChange={(e) => patch({ object: e.target.value })}/></label>}
        <fieldset><legend>Privileges</legend>{PRIVILEGES.map((p) => <label className="check" key={p}><input type="checkbox" checked={r.privileges?.includes(p) ?? false} onChange={(e) => patch({ privileges: e.target.checked ? [...(r.privileges ?? []), p] : (r.privileges ?? []).filter((x) => x !== p) })}/>{p}</label>)}</fieldset>
        {r.action === 'grant' && <label className="check"><input type="checkbox" checked={!!r.grantable} onChange={(e) => patch({ grantable: e.target.checked })}/> With grant option</label>}</>}
    </div> : <div><p>Review the exact SQL. Passwords are masked in this preview.</p><pre className="security-sql">{preview.join('\n\n')}</pre><p className="text-warning">This changes server security immediately and requires confirmation.</p></div>}
    {error && <div className="error-banner">{error}</div>}
  </Dialog>;
}
