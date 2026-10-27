// Sandboxed preload: exposes window.dbstudio (the DbStudioBridge contract from ui/src/platform/bridge.ts).
// Only `electron` may be required at runtime; esbuild inlines ../shared/channels.
import { contextBridge, ipcRenderer, webFrame, webUtils, type IpcRendererEvent } from 'electron';
import type {
  AppMemoryInfo, DbStudioBridge, DiscardRequest, EngineInfo, FileFilter, MenuCommand, NotificationOptions, TitleBarTheme, UnsavedWorkReport, UpdateStatus,
} from '../../../ui/src/platform/bridge';
import { desktopOs, htmlPlatformClasses, htmlPlatformVars, parseChromeArg, type DesktopPlatformInfo } from '../main/platform';
import { APP_VERSION_ARG, IPC, WINDOW_ROLE_ARG } from '../shared/channels';

function readAppVersion(): string {
  const arg = process.argv.find((a) => a.startsWith(APP_VERSION_ARG));
  return arg ? arg.slice(APP_VERSION_ARG.length) : '0.0.0';
}

// ---- windows
function readWindowRole(): 'main' | 'detached' {
  return process.argv.includes(`${WINDOW_ROLE_ARG}detached`) ? 'detached' : 'main';
}

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  if (typeof cb !== 'function') throw new TypeError('callback must be a function');
  const listener = (_e: IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const bridge: DbStudioBridge = {
  platform: 'electron',
  appVersion: readAppVersion(),
  getEngineInfo: () => ipcRenderer.invoke(IPC.getEngineInfo) as Promise<EngineInfo>,
  showSaveDialog: (opts: { title?: string; defaultPath?: string; filters?: FileFilter[] }) =>
    ipcRenderer.invoke(IPC.showSaveDialog, opts) as Promise<string | null>,
  showOpenDialog: (opts: { title?: string; filters?: FileFilter[]; createIfMissing?: boolean }) =>
    ipcRenderer.invoke(IPC.showOpenDialog, opts) as Promise<string | null>,
  readTextFile: (path: string) => ipcRenderer.invoke(IPC.readTextFile, path) as Promise<string>,
  writeTextFile: (path: string, content: string) =>
    ipcRenderer.invoke(IPC.writeTextFile, path, content) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url) as Promise<void>,
  openPath: (path: string) => ipcRenderer.invoke(IPC.openPath, path) as Promise<void>,
  revealInFolder: (path: string) => ipcRenderer.invoke(IPC.revealInFolder, path) as Promise<void>,
  onMenuCommand: (cb: (cmd: MenuCommand) => void) => subscribe<MenuCommand>(IPC.menuCommand, cb),
  onEngineRestarted: (cb: (info: EngineInfo) => void) => subscribe<EngineInfo>(IPC.engineRestarted, cb),
  loadWorkspace: () => ipcRenderer.invoke(IPC.loadWorkspace) as Promise<unknown | null>,
  saveWorkspace: (data: unknown) => ipcRenderer.invoke(IPC.saveWorkspace, data) as Promise<void>,
  setTitle: (title: string) => { ipcRenderer.send(IPC.setTitle, title); },
  // ---- windows: tabs in their own windows (desktop/src/main/windows.ts validates every payload)
  windowRole: readWindowRole(),
  openTabWindow: (opts: { tabs: unknown[]; position?: { x: number; y: number } }) => ipcRenderer.invoke(IPC.openTabWindow, opts) as Promise<boolean>,
  getDetachedTabs: () => ipcRenderer.invoke(IPC.getDetachedTabs) as Promise<unknown[] | null>,
  reportDetachedTabs: (tabs: unknown[]) => { ipcRenderer.send(IPC.reportDetachedTabs, tabs); },
  reattachTabs: (tabs: unknown[]) => ipcRenderer.invoke(IPC.reattachTabs, tabs) as Promise<boolean>,
  closeDetachedWindow: () => { ipcRenderer.send(IPC.closeDetachedWindow); },
  listDetachedTabs: () => ipcRenderer.invoke(IPC.listDetachedTabs) as Promise<unknown[]>,
  onDetachedTabs: (cb: (tabs: unknown[]) => void) => subscribe<unknown[]>(IPC.detachedTabs, cb),
  onTabsReattached: (cb: (e: { tabs: unknown[]; closed: boolean }) => void) => subscribe<{ tabs: unknown[]; closed: boolean }>(IPC.tabsReattached, cb),
  // ---- end windows
  // Page zoom in the renderer itself (no IPC): Chromium scales devicePixelRatio, so canvases stay sharp.
  setZoomFactor: (factor: number) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) return;
    webFrame.setZoomFactor(Math.max(0.6, Math.min(2, factor)));
  },
  // Auto-update (desktop/src/main/updater.ts) and the window chrome (main validates every argument).
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => subscribe<UpdateStatus>(IPC.updateStatus, cb),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.updatesGetStatus) as Promise<UpdateStatus>,
  checkForUpdates: (opts?: { manual?: boolean }) => ipcRenderer.invoke(IPC.updatesCheck, opts ?? {}) as Promise<UpdateStatus>,
  configureUpdates: (opts: { autoCheck: boolean }) => ipcRenderer.invoke(IPC.updatesConfigure, opts) as Promise<void>,
  quitAndInstall: () => ipcRenderer.invoke(IPC.updatesQuitAndInstall) as Promise<boolean>,
  setTitleBarTheme: (theme: TitleBarTheme) => { ipcRenderer.send(IPC.setTitleBarTheme, theme); },
  showAppMenu: (pos: { x: number; y: number }) => { ipcRenderer.send(IPC.showAppMenu, pos); },
  // ---- notifications
  showNotification: (opts: NotificationOptions) => { ipcRenderer.send(IPC.notify, opts); },
  // ---- keyboard shortcuts: the user's keymap reaches the native menu (main validates the map)
  setMenuShortcuts: (shortcuts: Record<string, string | null>) => { ipcRenderer.send(IPC.setMenuShortcuts, shortcuts); },
  // ---- file drops (Import wizard): the path of a dropped File, resolved in the preload (File.path is gone since Electron 32).
  getPathForFile: (file: File) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  // ---- stop the update download
  cancelUpdateDownload: () => ipcRenderer.invoke(IPC.updatesCancelDownload) as Promise<boolean>,
  // ---- resources (docs/resources.md)
  getAppMemory: () => ipcRenderer.invoke(IPC.getAppMemory) as Promise<AppMemoryInfo>,
  // ---- quit guard (desktop/src/main/quit.ts): main asks, the page answers; main validates every answer
  onUnsavedWorkQuery: (cb: () => UnsavedWorkReport | null | Promise<UnsavedWorkReport | null>) => answer(IPC.unsavedWorkQuery, cb),
  onConfirmDiscard: (cb: (req: DiscardRequest) => boolean | Promise<boolean>) => answer(IPC.confirmDiscard, cb),
};

// ---- quit guard
/** Requests from main ({ id, payload }) answered on IPC.rendererReply ({ id, value }); the latest handler answers. */
const answerers = new Map<string, (payload: unknown) => unknown>();

function answer<Q, A>(channel: string, cb: (payload: Q) => A | Promise<A>): () => void {
  if (typeof cb !== 'function') throw new TypeError('callback must be a function');
  const fn = cb as (payload: unknown) => unknown;
  answerers.set(channel, fn);
  return () => { if (answerers.get(channel) === fn) answerers.delete(channel); };
}

/**
 * `fallback` is the answer without a handler, or when the handler fails: "nothing to lose" for the query, "go on"
 * for the confirmation (a broken page never keeps the app from quitting).
 */
function listen(channel: string, fallback: unknown): void {
  ipcRenderer.on(channel, (_e: IpcRendererEvent, msg: { id?: unknown; payload?: unknown }) => {
    const id = msg?.id;
    if (typeof id !== 'number') return;
    const reply = (value: unknown) => ipcRenderer.send(IPC.rendererReply, { id, value });
    const fn = answerers.get(channel);
    // No handler yet (the page is still booting, or it is not the Rowlit UI): nothing can be lost there.
    if (!fn) { reply(fallback); return; }
    Promise.resolve()
      .then(() => fn(msg.payload))
      .then(reply, () => reply(fallback));
  });
}
listen(IPC.unsavedWorkQuery, null);
listen(IPC.confirmDiscard, true);

contextBridge.exposeInMainWorld('dbstudio', bridge);

// OS information outside the frozen DbStudioBridge contract (ui/src/platform/bridge.ts):
//  - window.dbstudioPlatform = { platform: 'win32' | 'darwin' | 'linux', arch, titleBar, nativeMaterial }
//  - <html class="platform-<os> [titlebar-inset | titlebar-overlay] [native-material]"> and the CSS variables
//    --titlebar-inset-left (78px on macOS: room for the traffic lights), --titlebar-overlay-fallback (Windows caption
//    buttons, until env(titlebar-area-*) is known) and --titlebar-drag, set before the UI runs.
const os = desktopOs(process.platform);
const chrome = parseChromeArg(process.argv);
const platformInfo: DesktopPlatformInfo = Object.freeze({
  platform: os,
  arch: process.arch,
  titleBar: chrome.titleBar,
  nativeMaterial: chrome.material !== 'none',
});
contextBridge.exposeInMainWorld('dbstudioPlatform', platformInfo);

function applyPlatformToDocument(): boolean {
  const html = document.documentElement;
  if (!html) return false;
  html.classList.add(...htmlPlatformClasses(os, chrome));
  for (const [name, value] of Object.entries(htmlPlatformVars(os, chrome))) html.style.setProperty(name, value);
  return true;
}
if (!applyPlatformToDocument()) document.addEventListener('DOMContentLoaded', () => { applyPlatformToDocument(); }, { once: true });
