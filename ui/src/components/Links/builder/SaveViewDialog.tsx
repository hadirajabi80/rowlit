// "Save as linked view": name + description; the view keeps the SQL (values inlined, so it also runs in a console) and
// the builder model, and shows up under the link's Queries in the explorer.
import { useState } from 'react';
import { Dialog } from '../../common/Dialog';

export interface SaveViewValue {
  name: string;
  description: string;
  /** Update the view this tab edits (false: save a copy). */
  replace: boolean;
}

export function SaveViewDialog({ initialName, initialDescription, existing, busy, error, onSave, onClose }: {
  initialName: string;
  initialDescription?: string;
  /** Name of the view this tab already edits. */
  existing: string | null;
  busy: boolean;
  error: string | null;
  onSave(v: SaveViewValue): void;
  onClose(): void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [replace, setReplace] = useState(!!existing);
  const valid = name.trim().length > 0 && name.trim().length <= 128;
  const submit = () => valid && !busy && onSave({ name: name.trim(), description: description.trim(), replace });
  return (
    <Dialog
      title={existing && replace ? `Save linked view “${existing}”` : 'Save as linked view'}
      onClose={onClose}
      width={460}
      onSubmit={submit}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <label className="form-row">
        <span className="form-label">Name</span>
        <input className="input form-control" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!valid} maxLength={128} />
      </label>
      <label className="form-row">
        <span className="form-label">Description</span>
        <textarea className="input form-control lkb-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </label>
      {existing && (
        <label className="check lkb-save-replace">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Update “{existing}” (untick to save a new view)
        </label>
      )}
      <p className="muted lkb-save-hint">Linked views appear under the link’s Queries in the explorer and reopen in the query builder.</p>
      {error && <div className="lkb-plan-note error" role="alert">{error}</div>}
    </Dialog>
  );
}
