import { LoaderCircle, Unplug } from 'lucide-react';
import { useState } from 'react';
import '../ResultsPane/results.css';

/**
 * A tab whose connection was closed (Close connection / Close database, docs/resources.md): it keeps its rows and
 * text, and nothing reconnects until the user runs, refreshes, pages or presses Reconnect here.
 */
export function DisconnectedBanner({ what, onReconnect }: { what: string; onReconnect: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rs-rolledback rs-disconnected" role="status">
      <Unplug size={13} aria-hidden="true" />
      <span className="rs-rolledback-text">Disconnected — {what}</span>
      <button
        className="link-btn"
        disabled={busy}
        title="Open the connection again"
        onClick={() => {
          setBusy(true);
          void onReconnect().finally(() => setBusy(false));
        }}
      >
        {busy ? <LoaderCircle size={11} className="spin" /> : null} Reconnect
      </button>
    </div>
  );
}
