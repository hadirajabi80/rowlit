// Quit / close guard, electron-free (unit tested in test/quit.test.mjs with fake windows and a fake engine):
//  - RendererRequests: request/reply over IPC (main sends { id, payload }, the preload answers { id, value }), with a
//    deadline, and resolution when the window goes away;
//  - validation and merging of the renderers' unsaved-work reports;
//  - QuitFlow: the quit sequence. Closing a window or quitting first asks the renderers what would be lost (unsaved
//    grid edits, open transactions); when something would, one window shows the app's own confirmation. Only a
//    confirmed quit lets the windows close, and the engine is stopped after they have closed (will-quit), so a
//    cancelled quit leaves every window with a live engine. A renderer that does not answer in time counts as having
//    nothing to lose (a hung window never blocks the quit).

/** How long main waits for a window to say what it would lose. */
export const QUERY_TIMEOUT_MS = 3_000;

export const QUIT_LIMITS = {
  count: 1_000_000,
  transactions: 100,
  idLength: 128,
  nameLength: 200,
} as const;

// ---------------------------------------------------------------------------------------------- reports

/** What one window (or, merged, every window asked) would lose. Mirrors ui/src/platform/bridge.ts UnsavedWorkReport. */
export interface UnsavedWorkReport {
  /** Grids with edits that were not submitted. */
  grids: number;
  /** Rows changed, inserted or deleted in those grids. */
  edits: number;
  /** Sessions with an open transaction, and the name of their connection. */
  transactions: { sessionId: string; connection: string }[];
}

export type CloseReason = 'quit' | 'close-window';

/** What the window that asks the user is told. Mirrors ui/src/platform/bridge.ts DiscardRequest. */
export interface DiscardRequest {
  /** 'quit': the app quits; 'close-window': the window closes, the app keeps running. */
  reason: CloseReason;
  work: UnsavedWorkReport;
  /** How many windows contributed to `work` (more than 1: the message says "in all windows"). */
  windows: number;
}

export const EMPTY_WORK: UnsavedWorkReport = Object.freeze({ grids: 0, edits: 0, transactions: [] }) as UnsavedWorkReport;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, QUIT_LIMITS.count) : 0);

/** A renderer's report; anything malformed counts as nothing (null and undefined: a page without the guard). */
export function validateUnsavedWork(v: unknown): UnsavedWorkReport {
  if (!isPlainObject(v)) return { grids: 0, edits: 0, transactions: [] };
  const transactions: UnsavedWorkReport['transactions'] = [];
  if (Array.isArray(v.transactions)) {
    for (const t of v.transactions.slice(0, QUIT_LIMITS.transactions)) {
      if (!isPlainObject(t) || typeof t.sessionId !== 'string' || !t.sessionId || t.sessionId.length > QUIT_LIMITS.idLength) continue;
      const connection = typeof t.connection === 'string' ? t.connection.slice(0, QUIT_LIMITS.nameLength) : '';
      transactions.push({ sessionId: t.sessionId, connection });
    }
  }
  const grids = count(v.grids);
  return { grids, edits: grids ? Math.max(count(v.edits), grids) : 0, transactions };
}

export function hasUnsavedWork(w: UnsavedWorkReport): boolean {
  return w.grids > 0 || w.transactions.length > 0;
}

/** Sum of the windows' reports; a transaction two windows report (a session one window shows for another) counts once. */
export function mergeUnsavedWork(reports: readonly UnsavedWorkReport[]): UnsavedWorkReport {
  const seen = new Set<string>();
  const out: UnsavedWorkReport = { grids: 0, edits: 0, transactions: [] };
  for (const r of reports) {
    out.grids += r.grids;
    out.edits += r.edits;
    for (const t of r.transactions) {
      if (seen.has(t.sessionId)) continue;
      seen.add(t.sessionId);
      out.transactions.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- requests

/** What the guard needs from a BrowserWindow. */
export interface GuardWindow {
  isDestroyed(): boolean;
  close(): void;
  /** Closes without asking the page (a renderer that did not answer). */
  destroy(): void;
  focus(): void;
  webContents: { id: number; send(channel: string, ...args: unknown[]): void };
}

interface Pending {
  webContentsId: number;
  resolve(r: { answered: boolean; value?: unknown }): void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Requests to renderers: `request` sends `{ id, payload }` on a channel; the preload's reply (`{ id, value }`, any
 * channel) goes to `reply`. Resolves `{ answered: false }` after the deadline, or when the window goes away (`gone`).
 */
export class RendererRequests {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  request(win: GuardWindow, channel: string, payload: unknown, timeoutMs: number | null): Promise<{ answered: boolean; value?: unknown }> {
    if (win.isDestroyed()) return Promise.resolve({ answered: false });
    const id = ++this.seq;
    const webContentsId = win.webContents.id;
    return new Promise((resolve) => {
      const p: Pending = { webContentsId, resolve };
      this.pending.set(id, p);
      if (timeoutMs !== null) p.timer = setTimeout(() => this.settle(id, { answered: false }), timeoutMs);
      try {
        win.webContents.send(channel, { id, payload });
      } catch {
        this.settle(id, { answered: false });
      }
    });
  }

  /** A reply from the renderer of `webContentsId`; ignored unless it answers a request made to that renderer. */
  reply(webContentsId: number, msg: unknown): void {
    if (!isPlainObject(msg) || typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p || p.webContentsId !== webContentsId) return;
    this.settle(msg.id, { answered: true, value: msg.value });
  }

  /** The renderer is gone (window closed, crashed, navigated away): its requests resolve unanswered. */
  gone(webContentsId: number): void {
    for (const [id, p] of [...this.pending]) if (p.webContentsId === webContentsId) this.settle(id, { answered: false });
  }

  get size(): number {
    return this.pending.size;
  }

  private settle(id: number, r: { answered: boolean; value?: unknown }): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    p.resolve(r);
  }
}

// ---------------------------------------------------------------------------------------------- the quit sequence

export interface QuitFlowDeps<W extends GuardWindow> {
  /** Every open window (main and detached). */
  windows(): W[];
  /** The main window, if open. */
  primary(): W | null;
  /** The focused window, if it is one of ours. */
  focused(): W | null;
  /** What a window would lose; `answered: false` when it did not say within `timeoutMs`. */
  query(win: W, timeoutMs: number): Promise<{ answered: boolean; work: UnsavedWorkReport }>;
  /** Shows the confirmation in `win`; true = discard and go on. A window that goes away meanwhile counts as true. */
  confirm(win: W, req: DiscardRequest): Promise<boolean>;
  /** app.quit(). */
  quit(): void;
  /**
   * Stops the engine once the windows have closed. A promise (graceful POSIX stop) makes will-quit wait for it and
   * quit again afterwards; undefined (synchronous kill) lets the quit go on.
   */
  stopEngine(): Promise<void> | void;
  /** Windows / Linux: closing the main window quits the app. macOS: the app keeps running. */
  mainWindowQuits: boolean;
  log?(message: string): void;
  /** Tests: the query deadline. */
  queryTimeoutMs?: number;
}

interface Prevented {
  preventDefault(): void;
}

export class QuitFlow<W extends GuardWindow> {
  private confirmed = false;
  private engineStopped = false;
  private engineStopping = false;
  private guarding: Promise<boolean> | null = null;
  /** Windows whose close the user already agreed to (or that close without asking). */
  private readonly allowed = new WeakSet<W>();

  constructor(private readonly deps: QuitFlowDeps<W>) {}

  /** True once a quit is confirmed: windows close freely, the engine is stopped once they have. */
  get quitting(): boolean {
    return this.confirmed;
  }

  /** A question is on screen (or the windows are being asked). */
  get asking(): boolean {
    return this.guarding !== null;
  }

  /** Quit without asking: the user already chose to (engine crash dialog "Quit", start failure, update restart). */
  quitNow(): void {
    this.confirmed = true;
    this.deps.quit();
  }

  /** The update restart confirmed in the renderer: the quit it starts must not ask again. */
  confirmQuit(): void {
    this.confirmed = true;
  }

  /** The update restart did not happen after all: quitting asks again. */
  cancelConfirmedQuit(): void {
    if (!this.engineStopping && !this.engineStopped) this.confirmed = false;
  }

  /** A window that may close without asking (a detached window that emptied itself, or closing with the main window). */
  allowClose(win: W): void {
    this.allowed.add(win);
  }

  /** app 'before-quit' (Ctrl+Q, Cmd+Q, the Dock, window-all-closed). */
  onBeforeQuit(e: Prevented): void {
    if (this.confirmed) return;
    e.preventDefault();
    void this.guard('quit', this.deps.windows()).then((r) => {
      if (r.ok) this.proceed(r.silent, () => this.quitNow());
    });
  }

  /** BrowserWindow 'close' of the main window (`main`) or a detached window. */
  onWindowClose(win: W, e: Prevented, kind: 'main' | 'detached'): void {
    if (this.confirmed || this.allowed.has(win)) return;
    e.preventDefault();
    // The detached windows close with the main window.
    const scope = kind === 'main' ? this.deps.windows() : [win];
    const quits = kind === 'main' && this.deps.mainWindowQuits;
    void this.guard(quits ? 'quit' : 'close-window', scope).then((r) => {
      if (!r.ok) return;
      if (quits) {
        this.proceed(r.silent, () => this.quitNow());
        return;
      }
      for (const w of scope) this.allowed.add(w);
      this.proceed(r.silent, () => { if (!win.isDestroyed()) win.close(); });
    });
  }

  /** app 'will-quit': every window has closed; now the engine goes. True when the quit goes on now. */
  onWillQuit(e: Prevented): boolean {
    if (this.engineStopped) return true;
    if (this.engineStopping) {
      e.preventDefault();
      return false;
    }
    this.confirmed = true;
    let stopping: Promise<void> | void = undefined;
    try {
      stopping = this.deps.stopEngine();
    } catch (err) {
      this.deps.log?.(`engine stop failed: ${(err as Error).message}`);
    }
    if (!stopping) {
      this.engineStopped = true;
      return true;
    }
    e.preventDefault();
    this.engineStopping = true;
    void stopping.catch(() => undefined).finally(() => {
      this.engineStopping = false;
      this.engineStopped = true;
      this.deps.quit();
    });
    return false;
  }

  /** Renderers that did not answer cannot run their unload handlers either: those windows are destroyed. */
  private proceed(silent: W[], then: () => void): void {
    for (const w of silent) {
      this.allowed.add(w);
      if (!w.isDestroyed()) {
        this.deps.log?.(`window ${w.webContents.id} did not answer: closing it without asking`);
        w.destroy();
      }
    }
    then();
  }

  /** Asks the windows of `scope`; ok = nothing would be lost, or the user chose to discard it. */
  private async guard(reason: CloseReason, scope: W[]): Promise<{ ok: boolean; silent: W[] }> {
    if (this.guarding) {
      // A question is already on screen: this request is dropped (the user answers the one shown).
      this.deps.focused()?.focus();
      return { ok: false, silent: [] };
    }
    const run = this.ask(reason, scope);
    this.guarding = run.then((r) => r.ok);
    try {
      return await run;
    } finally {
      this.guarding = null;
    }
  }

  private async ask(reason: CloseReason, scope: W[]): Promise<{ ok: boolean; silent: W[] }> {
    const live = scope.filter((w) => !w.isDestroyed());
    const timeout = this.deps.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
    const answers = await Promise.all(live.map(async (win) => ({ win, ...(await this.deps.query(win, timeout)) })));
    const silent = answers.filter((a) => !a.answered && !a.win.isDestroyed()).map((a) => a.win);
    const losing = answers.filter((a) => a.answered && hasUnsavedWork(a.work));
    if (losing.length === 0) return { ok: true, silent };
    const work = mergeUnsavedWork(losing.map((a) => a.work));
    // The question goes to the focused window when it answered, else the main window, else one that has work.
    const responders = answers.filter((a) => a.answered && !a.win.isDestroyed()).map((a) => a.win);
    const focused = this.deps.focused();
    const primary = this.deps.primary();
    const target = (focused && responders.includes(focused) ? focused : null)
      ?? (primary && responders.includes(primary) ? primary : null)
      ?? losing[0].win;
    this.deps.log?.(`asking before ${reason}: ${work.grids} grid(s), ${work.edits} edit(s), ${work.transactions.length} open transaction(s)`);
    const ok = await this.deps.confirm(target, { reason, work, windows: losing.length });
    this.deps.log?.(ok ? `${reason} confirmed` : `${reason} cancelled`);
    return { ok, silent };
  }
}
