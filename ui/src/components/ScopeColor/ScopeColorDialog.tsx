// Set colour… for a schema or database (lazy chunk, ScopeColorDialogHost): the connection dialog's palette plus "No
// colour". Picking a swatch applies it right away and closes the dialog; the colour shows in the explorer, on the tabs
// of that schema, in the console's switcher and in the Objects tab's breadcrumb.
import { ownScopeColor, scopeColorKey, setScopeColor, useScopeColors, type ScopeRef } from '../../lib/scopeColors';
import { schemaIsDatabase, useConnection } from '../../store/connections';
import { CONNECTION_PALETTE, connColorCss } from '../../theme/connColors';
import { Dialog } from '../common/Dialog';
import { useScopeColorDialog } from './dialogStore';
import './scopeColor.css';

/** "schema main", "database Shop", "keyspace shop". */
function scopeNoun(ref: ScopeRef, providerId: string | undefined): string {
  if (!ref.schema) return 'database';
  return schemaIsDatabase(providerId) ? (providerId === 'cassandra' ? 'keyspace' : providerId === 'oracle' ? 'schema' : 'database') : 'schema';
}

export function ScopeColorDialog({ request }: { request: ScopeRef }) {
  const close = () => useScopeColorDialog.getState().close();
  const conn = useConnection(request.connectionId);
  const map = useScopeColors();
  const current = ownScopeColor(map, request);
  const name = request.schema ?? request.database ?? '';
  const noun = scopeNoun(request, conn?.providerId);
  const pick = (hex: string | null) => {
    setScopeColor(request, hex);
    close();
  };
  return (
    <Dialog title={`Colour of ${noun} ${name}`} onClose={close} width={380} className="sc-dialog" footer={<button className="btn" onClick={close}>Cancel</button>}>
      <p className="sc-hint">
        Marks the {noun} in the explorer, on the tabs that work in it and in the Objects tab.{' '}
        {request.schema ? 'It overrides the database colour.' : 'Its schemas use it unless they have their own.'}
      </p>
      <div className="color-swatches sc-swatches" role="radiogroup" aria-label={`Colour of ${noun} ${name}`} key={scopeColorKey(request.connectionId, request.database, request.schema)}>
        <button
          className={`swatch none${current === null ? ' selected' : ''}`}
          role="radio"
          aria-checked={current === null}
          aria-label="No colour"
          title="No colour"
          data-autofocus={current === null || undefined}
          onClick={() => pick(null)}
        />
        {CONNECTION_PALETTE.map((c) => {
          const on = current?.toLowerCase() === c.hex;
          return (
            <button
              key={c.id}
              className={`swatch${on ? ' selected' : ''}`}
              role="radio"
              aria-checked={on}
              aria-label={c.name.replace(' (production)', '')}
              title={c.name.replace(' (production)', '')}
              data-autofocus={on || undefined}
              style={{ background: connColorCss(c.hex) }}
              onClick={() => pick(c.hex)}
            />
          );
        })}
      </div>
    </Dialog>
  );
}
