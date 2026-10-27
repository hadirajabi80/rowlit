// Quit / close guard: wires the electron-free QuitFlow (quit-core.ts) to the app, the windows and IPC. The renderer
// answers through the preload (onUnsavedWorkQuery / onConfirmDiscard in ui/src/platform/bridge.ts).
import { app, BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { IPC } from '../shared/channels';
import { QuitFlow, RendererRequests, validateUnsavedWork, type QuitFlowDeps } from './quit-core';
import { isAllowedUrl } from './window';

export interface QuitGuardDeps {
  devUrl?: string;
  primary(): BrowserWindow | null;
  stopEngine: QuitFlowDeps<BrowserWindow>['stopEngine'];
  mainWindowQuits: boolean;
  log(message: string): void;
  /** false: the window that asks is not shown (smoke test, hidden windows). */
  show?: boolean;
}

export interface QuitGuard {
  flow: QuitFlow<BrowserWindow>;
  /** Every window (main and detached) is watched with this: its close asks first; its requests end with it. */
  watch(win: BrowserWindow, kind: 'main' | 'detached'): void;
}

export function createQuitGuard(deps: QuitGuardDeps): QuitGuard {
  const requests = new RendererRequests();
  const ours = (w: BrowserWindow | null | undefined): w is BrowserWindow => !!w && !w.isDestroyed();
  /** Only our UI answers (the engine error page is a data: URL without the guard: nothing to lose there). */
  const runsUi = (w: BrowserWindow) => isAllowedUrl(w.webContents.getURL(), deps.devUrl);

  const flow = new QuitFlow<BrowserWindow>({
    windows: () => BrowserWindow.getAllWindows().filter(ours),
    primary: () => (ours(deps.primary()) ? deps.primary() : null),
    focused: () => { const f = BrowserWindow.getFocusedWindow(); return ours(f) ? f : null; },
    async query(win, timeoutMs) {
      if (!runsUi(win)) return { answered: true, work: validateUnsavedWork(null) };
      const r = await requests.request(win, IPC.unsavedWorkQuery, null, timeoutMs);
      return { answered: r.answered, work: validateUnsavedWork(r.value) };
    },
    async confirm(win, req) {
      if (deps.show !== false) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      // No deadline: the user is reading the question. A window that goes away meanwhile resolves unanswered.
      const r = await requests.request(win, IPC.confirmDiscard, req, null);
      return !r.answered || r.value === true;
    },
    quit: () => app.quit(),
    stopEngine: deps.stopEngine,
    mainWindowQuits: deps.mainWindowQuits,
    log: (m) => deps.log(m),
  });

  ipcMain.removeAllListeners(IPC.rendererReply);
  ipcMain.on(IPC.rendererReply, (e: IpcMainEvent, msg: unknown) => {
    try {
      const url = e.senderFrame?.url ?? '';
      if (!isAllowedUrl(url, deps.devUrl)) return;
      requests.reply(e.sender.id, msg);
    } catch {
      /* fire-and-forget channel: bad input is ignored */
    }
  });

  return {
    flow,
    watch(win, kind) {
      const id = win.webContents.id;
      win.on('close', (e) => flow.onWindowClose(win, e, kind));
      win.webContents.on('render-process-gone', () => requests.gone(id));
      // A renderer that hangs while its question is open does not keep the app from quitting.
      win.on('unresponsive', () => requests.gone(id));
      win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) requests.gone(id); });
      win.on('closed', () => requests.gone(id));
      // Windows log off / shutdown: nothing may hold the windows open any more.
      win.on('session-end', () => flow.confirmQuit());
    },
  };
}
