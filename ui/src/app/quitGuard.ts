// Quit / close guard, renderer side (desktop only). Before Rowlit quits or a window closes, the main process
// (desktop/src/main/quit-core.ts) asks every window it affects what would be lost; this window answers with its unsaved
// grid edits and open transactions. When anything would be lost, main asks one window to confirm for all of them: a
// danger confirmation (Cancel has the focus) naming what goes. Consoles are kept (workspace file), so they are not
// listed. Main goes ahead without a window that does not answer within about 3 s.
import { getPlatform } from '../platform';
import type { DiscardRequest } from '../platform/bridge';
import { useUi } from '../store/ui';
import { describeUnsavedWork, hasUnsavedWork, unsavedWorkReport } from './unsavedWork';

/** The confirmation main asked for; true = discard and go on. */
export async function confirmDiscard(req: DiscardRequest): Promise<boolean> {
  const lost = describeUnsavedWork(req.work);
  if (!lost || !hasUnsavedWork(req.work)) return true;
  const quit = req.reason === 'quit';
  const where = req.windows > 1 ? ' (in all windows)' : '';
  const consequence = [
    req.work.grids ? 'the edits are discarded' : '',
    req.work.transactions.length ? `the ${req.work.transactions.length === 1 ? 'transaction is' : 'transactions are'} rolled back` : '',
  ].filter(Boolean).join(' and ');
  return useUi.getState().askConfirm({
    title: quit ? 'Quit Rowlit?' : 'Close this window?',
    message: `You have ${lost}${where}. If you ${quit ? 'quit' : 'close the window'} now, ${consequence}.${quit ? ' Your consoles are kept.' : ''}`,
    confirmLabel: quit ? 'Discard and quit' : 'Discard and close',
    cancelLabel: 'Cancel',
    danger: true,
  });
}

let wired = false;

/** Answers the main process's questions for this window. Idempotent; returns the unsubscribe. */
export function wireQuitGuard(): () => void {
  const p = getPlatform();
  if (wired || !p.onUnsavedWorkQuery || !p.onConfirmDiscard) return () => {};
  wired = true;
  // Sessions another live window uses are its to report (main merges every window's report).
  const offQuery = p.onUnsavedWorkQuery(() => unsavedWorkReport({ foreign: false }));
  const offConfirm = p.onConfirmDiscard((req) => confirmDiscard(req));
  return () => {
    offQuery();
    offConfirm();
    wired = false;
  };
}
