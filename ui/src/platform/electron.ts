import type { DbStudioBridge, DiscardRequest, NotificationOptions, TitleBarTheme, UnsavedWorkReport } from './bridge';
import type { Platform } from './types';

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function createElectronPlatform(b: DbStudioBridge): Platform {
  return {
    kind: 'electron',
    appVersion: b.appVersion,
    hasFileSystem: true,
    getEngineInfo: () => b.getEngineInfo(),
    showSaveDialog: (o) => b.showSaveDialog(o),
    showOpenDialog: (o) => b.showOpenDialog(o),
    async saveFile({ suggestedName, filters, content }) {
      const path = await b.showSaveDialog({ defaultPath: suggestedName, filters });
      if (!path) return null;
      // A Blob is written byte for byte (an .xlsx is binary; Blob.text() would corrupt it). The main process accepts a
      // Uint8Array on the same channel (desktop/src/main/validate.ts validateFileContent).
      const data = typeof content === 'string' ? content : new Uint8Array(await content.arrayBuffer());
      await b.writeTextFile(path, data as unknown as string);
      return path;
    },
    async openTextFile({ filters, maxBytes }) {
      const path = await b.showOpenDialog({ filters });
      if (!path) return null;
      // a caller that only previews the file (the engine reads it by path) asks for the head; older preloads read it all
      if (maxBytes && typeof b.readTextFileHead === 'function') return { name: baseName(path), path, ...(await b.readTextFileHead(path, maxBytes)) };
      return { name: baseName(path), path, content: await b.readTextFile(path) };
    },
    writeTextFile: (p, c) => b.writeTextFile(p, c),
    openExternal: (u) => b.openExternal(u),
    onMenuCommand: (cb) => b.onMenuCommand(cb),
    onEngineRestarted: (cb) => b.onEngineRestarted(cb),
    loadWorkspace: () => b.loadWorkspace(),
    saveWorkspace: (d) => b.saveWorkspace(d),
    setTitle: (t) => b.setTitle(t),
    ...(typeof b.setZoomFactor === 'function' ? { setZoomFactor: (f: number) => b.setZoomFactor!(f) } : {}),
    // Additive bridge members: only present when this preload has them.
    ...(typeof b.openPath === 'function' ? { openPath: (p: string) => b.openPath!(p) } : {}),
    ...(typeof b.revealInFolder === 'function' ? { revealInFolder: (p: string) => b.revealInFolder!(p) } : {}),
    ...(typeof b.onUpdateStatus === 'function' ? { onUpdateStatus: (cb: Parameters<NonNullable<DbStudioBridge['onUpdateStatus']>>[0]) => b.onUpdateStatus!(cb) } : {}),
    ...(typeof b.getUpdateStatus === 'function' ? { getUpdateStatus: () => b.getUpdateStatus!() } : {}),
    ...(typeof b.checkForUpdates === 'function' ? { checkForUpdates: (o?: { manual?: boolean }) => b.checkForUpdates!(o) } : {}),
    ...(typeof b.configureUpdates === 'function' ? { configureUpdates: (o: { autoCheck: boolean }) => b.configureUpdates!(o) } : {}),
    ...(typeof b.quitAndInstall === 'function' ? { quitAndInstall: () => b.quitAndInstall!() } : {}),
    ...(typeof b.setTitleBarTheme === 'function' ? { setTitleBarTheme: (t: TitleBarTheme) => b.setTitleBarTheme!(t) } : {}),
    ...(typeof b.showAppMenu === 'function' ? { showAppMenu: (pos: { x: number; y: number }) => b.showAppMenu!(pos) } : {}),
    // ---- notifications
    ...(typeof b.showNotification === 'function' ? { showNotification: (o: NotificationOptions) => b.showNotification!(o) } : {}),
    // ---- keyboard shortcuts
    ...(typeof b.setMenuShortcuts === 'function' ? { setMenuShortcuts: (m: Record<string, string | null>) => b.setMenuShortcuts!(m) } : {}),
    // ---- file drops
    ...(typeof b.getPathForFile === 'function' ? { getFilePath: (f: File) => b.getPathForFile!(f) || null } : {}),
    // ---- stop the update download
    ...(typeof b.cancelUpdateDownload === 'function' ? { cancelUpdateDownload: () => b.cancelUpdateDownload!() } : {}),
    // ---- resources
    ...(typeof b.getAppMemory === 'function' ? { getAppMemory: () => b.getAppMemory!() } : {}),
    // ---- quit guard
    ...(typeof b.onUnsavedWorkQuery === 'function' ? { onUnsavedWorkQuery: (cb: () => UnsavedWorkReport | null | Promise<UnsavedWorkReport | null>) => b.onUnsavedWorkQuery!(cb) } : {}),
    ...(typeof b.onConfirmDiscard === 'function' ? { onConfirmDiscard: (cb: (req: DiscardRequest) => boolean | Promise<boolean>) => b.onConfirmDiscard!(cb) } : {}),
  };
}
