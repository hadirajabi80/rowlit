// Quit / close guard (src/main/quit-core.ts), driven by fake windows whose "renderers" answer (or hang) and a fake
// engine: confirm, cancel, renderer timeout, detached windows, the update restart, and the engine stopped only after
// a confirmed quit has closed the windows.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { desktopRoot } from './helpers.mjs';

const require = createRequire(import.meta.url);
const q = require(join(desktopRoot, 'out', 'lib', 'quit-core.js'));

const WORK = { grids: 2, edits: 5, transactions: [{ sessionId: 's1', connection: 'Prod' }] };
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred, ms = 2000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let nextId = 1;
/**
 * A window whose renderer answers queries with `work` (null: nothing; 'hang': never) and confirmations with what
 * `answers` returns (a promise resolved by the test: `pendingConfirm`).
 */
class FakeWin {
  constructor(requests, { work = null, name = `w${nextId}` } = {}) {
    this.name = name;
    this.work = work;
    this.destroyed = false;
    this.closes = 0;
    this.focused = 0;
    this.confirms = [];
    this.webContents = {
      id: nextId++,
      send: (channel, msg) => {
        if (channel === 'query') {
          if (this.work === 'hang') return;
          setTimeout(() => requests.reply(this.webContents.id, { id: msg.id, value: this.work }), 1);
        } else if (channel === 'confirm') {
          this.confirms.push({ req: msg.payload, answer: (v) => requests.reply(this.webContents.id, { id: msg.id, value: v }) });
        }
      },
    };
  }
  isDestroyed() { return this.destroyed; }
  close() { this.closes++; }
  destroy() { this.destroyed = true; }
  focus() { this.focused++; }
}

function setup({ windows: specs = [{ work: null }], mainWindowQuits = true, graceful = false, timeoutMs = 50 } = {}) {
  const requests = new q.RendererRequests();
  const wins = specs.map((s) => new FakeWin(requests, s));
  const engine = { alive: true, stops: 0, release: null };
  const calls = { quit: 0 };
  let focused = null;
  const flow = new q.QuitFlow({
    windows: () => wins.filter((w) => !w.isDestroyed()),
    primary: () => (wins[0] && !wins[0].isDestroyed() ? wins[0] : null),
    focused: () => focused,
    async query(win, ms) {
      const r = await requests.request(win, 'query', null, ms);
      return { answered: r.answered, work: q.validateUnsavedWork(r.value) };
    },
    async confirm(win, req) {
      const r = await requests.request(win, 'confirm', req, null);
      return !r.answered || r.value === true;
    },
    quit: () => { calls.quit++; },
    stopEngine: () => {
      engine.stops++;
      if (!graceful) { engine.alive = false; return undefined; }
      return new Promise((res) => { engine.release = () => { engine.alive = false; res(); }; });
    },
    mainWindowQuits,
    queryTimeoutMs: timeoutMs,
  });
  const ev = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  return { flow, wins, engine, calls, requests, ev, setFocused: (w) => { focused = w; } };
}

describe('unsaved-work reports', () => {
  it('validates renderer reports: bad input counts as nothing, counts are capped, names cut', () => {
    for (const bad of [null, undefined, 'x', 3, [], { grids: -1 }, { grids: 1.5 }]) {
      assert.equal(q.hasUnsavedWork(q.validateUnsavedWork(bad)), false, JSON.stringify(bad));
    }
    const r = q.validateUnsavedWork({ grids: 1, edits: 0, transactions: [{ sessionId: 's', connection: 'x'.repeat(500) }, { sessionId: '' }, 'junk', { sessionId: 7 }] });
    assert.equal(r.grids, 1);
    assert.equal(r.edits, 1, 'a grid with edits has at least one');
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].connection.length, q.QUIT_LIMITS.nameLength);
    assert.equal(q.validateUnsavedWork({ grids: 1e12 }).grids, q.QUIT_LIMITS.count);
  });

  it('merges windows and counts a shared transaction once', () => {
    const m = q.mergeUnsavedWork([WORK, { grids: 1, edits: 1, transactions: [{ sessionId: 's1', connection: 'Prod' }, { sessionId: 's2', connection: 'Dev' }] }]);
    assert.deepEqual(m, { grids: 3, edits: 6, transactions: [{ sessionId: 's1', connection: 'Prod' }, { sessionId: 's2', connection: 'Dev' }] });
  });
});

describe('RendererRequests', () => {
  it('resolves with the reply of the window asked, ignores other senders, times out, and ends with the window', async () => {
    const requests = new q.RendererRequests();
    const sent = [];
    const win = { isDestroyed: () => false, webContents: { id: 41, send: (ch, msg) => sent.push(msg) } };
    const a = requests.request(win, 'c', { x: 1 }, null);
    assert.deepEqual(sent[0].payload, { x: 1 });
    requests.reply(99, { id: sent[0].id, value: 'spoofed' }); // another renderer: ignored
    requests.reply(41, 'junk');
    assert.equal(requests.size, 1);
    requests.reply(41, { id: sent[0].id, value: 'ok' });
    assert.deepEqual(await a, { answered: true, value: 'ok' });

    const t0 = Date.now();
    assert.deepEqual(await requests.request(win, 'c', null, 30), { answered: false });
    assert.ok(Date.now() - t0 >= 25);

    const b = requests.request(win, 'c', null, null);
    requests.gone(41);
    assert.deepEqual(await b, { answered: false });
    assert.equal(requests.size, 0);
  });
});

describe('quit flow', () => {
  it('nothing unsaved: the quit goes on without a question; the engine stops only at will-quit', async () => {
    const { flow, wins, engine, calls, ev } = setup({ windows: [{ work: null }, { work: null }] });
    const e = ev();
    flow.onBeforeQuit(e);
    assert.equal(e.prevented, true, 'held until the windows answered');
    assert.equal(engine.stops, 0);
    await until(() => calls.quit === 1);
    assert.equal(flow.quitting, true);
    assert.equal(wins[0].confirms.length, 0);
    // app.quit() again: before-quit passes, the windows close freely, then will-quit stops the engine.
    const again = ev();
    flow.onBeforeQuit(again);
    assert.equal(again.prevented, false);
    const close = ev();
    flow.onWindowClose(wins[0], close, 'main');
    assert.equal(close.prevented, false);
    assert.equal(engine.alive, true, 'engine alive until the windows have closed');
    assert.equal(flow.onWillQuit(ev()), true);
    assert.equal(engine.alive, false);
  });

  it('cancel: nothing closes, the engine is not stopped, and the next quit asks again', async () => {
    const { flow, wins, engine, calls, ev } = setup({ windows: [{ work: WORK }] });
    flow.onBeforeQuit(ev());
    await until(() => wins[0].confirms.length === 1);
    assert.deepEqual(wins[0].confirms[0].req, { reason: 'quit', work: WORK, windows: 1 });
    wins[0].confirms[0].answer(false);
    await tick(); await tick();
    assert.equal(calls.quit, 0);
    assert.equal(flow.quitting, false);
    assert.equal(engine.stops, 0);
    assert.equal(engine.alive, true);
    assert.equal(wins[0].closes, 0);
    assert.equal(wins[0].destroyed, false);
    // asks again
    const e = ev();
    flow.onBeforeQuit(e);
    assert.equal(e.prevented, true);
    await until(() => wins[0].confirms.length === 2);
  });

  it('confirm: quits for real; windows close without asking again; the engine stops after them', async () => {
    const { flow, wins, engine, calls, ev } = setup({ windows: [{ work: WORK }, { work: { grids: 1, edits: 1, transactions: [] } }] });
    flow.onBeforeQuit(ev());
    await until(() => wins[0].confirms.length === 1);
    assert.deepEqual(wins[0].confirms[0].req.work, { grids: 3, edits: 6, transactions: WORK.transactions });
    assert.equal(wins[0].confirms[0].req.windows, 2);
    assert.equal(wins[1].confirms.length, 0, 'one question for all windows');
    wins[0].confirms[0].answer(true);
    await until(() => calls.quit === 1);
    for (const w of wins) {
      const e = ev();
      flow.onWindowClose(w, e, w === wins[0] ? 'main' : 'detached');
      assert.equal(e.prevented, false);
    }
    assert.equal(engine.stops, 0);
    flow.onWillQuit(ev());
    assert.equal(engine.stops, 1);
    assert.equal(engine.alive, false);
  });

  it('a renderer that does not answer within the deadline does not block the quit (and its window is destroyed)', async () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: 'hang' }], timeoutMs: 40 });
    const t0 = Date.now();
    flow.onBeforeQuit(ev());
    await until(() => calls.quit === 1);
    assert.ok(Date.now() - t0 >= 35, 'waited for the deadline');
    assert.equal(wins[0].destroyed, true);
    assert.equal(wins[0].confirms.length, 0);
  });

  it('a hung window does not hide the work of a window that answers', async () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: 'hang' }, { work: WORK }], timeoutMs: 40 });
    flow.onBeforeQuit(ev());
    await until(() => wins[1].confirms.length === 1);
    wins[1].confirms[0].answer(false);
    await tick(); await tick();
    assert.equal(calls.quit, 0);
    assert.equal(wins[0].destroyed, false, 'cancelled: the hung window stays');
  });

  it('a window that goes away while its question is open lets the quit go on', async () => {
    const { flow, wins, calls, requests, ev } = setup({ windows: [{ work: WORK }] });
    flow.onBeforeQuit(ev());
    await until(() => wins[0].confirms.length === 1);
    requests.gone(wins[0].webContents.id);
    await until(() => calls.quit === 1);
  });

  it('asks once while a question is open (a second Ctrl+Q is dropped)', async () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: WORK }] });
    flow.onBeforeQuit(ev());
    await until(() => wins[0].confirms.length === 1);
    const second = ev();
    flow.onBeforeQuit(second);
    assert.equal(second.prevented, true);
    const close = ev();
    flow.onWindowClose(wins[0], close, 'main');
    assert.equal(close.prevented, true);
    await tick();
    assert.equal(wins[0].confirms.length, 1);
    wins[0].confirms[0].answer(true);
    await until(() => calls.quit === 1);
    await tick();
    assert.equal(calls.quit, 1);
  });

  it('the question goes to the focused window', async () => {
    const { flow, wins, setFocused, ev } = setup({ windows: [{ work: WORK }, { work: WORK }] });
    setFocused(wins[1]);
    flow.onBeforeQuit(ev());
    await until(() => wins[1].confirms.length === 1);
    assert.equal(wins[0].confirms.length, 0);
  });

  it('closing the main window (Windows/Linux) asks for every window, then quits', async () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: null }, { work: WORK }] });
    const e = ev();
    flow.onWindowClose(wins[0], e, 'main');
    assert.equal(e.prevented, true);
    await until(() => wins[0].confirms.length === 1);
    assert.equal(wins[0].confirms[0].req.reason, 'quit');
    wins[0].confirms[0].answer(true);
    await until(() => calls.quit === 1);
    assert.equal(flow.quitting, true);
  });

  it('closing the main window on macOS closes it (and its detached windows) without quitting', async () => {
    const { flow, wins, calls, engine, ev } = setup({ windows: [{ work: WORK }, { work: null }], mainWindowQuits: false });
    flow.onWindowClose(wins[0], ev(), 'main');
    await until(() => wins[0].confirms.length === 1);
    assert.equal(wins[0].confirms[0].req.reason, 'close-window');
    wins[0].confirms[0].answer(true);
    await until(() => wins[0].closes === 1);
    assert.equal(calls.quit, 0);
    assert.equal(flow.quitting, false);
    assert.equal(engine.stops, 0);
    for (const w of wins) {
      const e = ev();
      flow.onWindowClose(w, e, w === wins[0] ? 'main' : 'detached');
      assert.equal(e.prevented, false, 'already agreed');
    }
  });

  it('a detached window asks about its own work only; cancel keeps it open', async () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: WORK }, { work: { grids: 1, edits: 3, transactions: [] } }] });
    const e = ev();
    flow.onWindowClose(wins[1], e, 'detached');
    assert.equal(e.prevented, true);
    await until(() => wins[1].confirms.length === 1);
    assert.deepEqual(wins[1].confirms[0].req, { reason: 'close-window', work: { grids: 1, edits: 3, transactions: [] }, windows: 1 });
    assert.equal(wins[0].confirms.length, 0);
    wins[1].confirms[0].answer(false);
    await tick(); await tick();
    assert.equal(wins[1].closes, 0);
    flow.onWindowClose(wins[1], ev(), 'detached');
    await until(() => wins[1].confirms.length === 2);
    wins[1].confirms[1].answer(true);
    await until(() => wins[1].closes === 1);
    const again = ev();
    flow.onWindowClose(wins[1], again, 'detached');
    assert.equal(again.prevented, false);
    assert.equal(calls.quit, 0);
  });

  it('windows the registry closes itself (emptied, or with the main window) do not ask', () => {
    const { flow, wins, ev } = setup({ windows: [{ work: WORK }, { work: WORK }] });
    flow.allowClose(wins[1]);
    const e = ev();
    flow.onWindowClose(wins[1], e, 'detached');
    assert.equal(e.prevented, false);
  });

  it('Restart to update (already confirmed in the renderer) does not ask again; a failed restart re-arms the guard', async () => {
    const { flow, wins, ev } = setup({ windows: [{ work: WORK }] });
    flow.confirmQuit();
    const e = ev();
    flow.onBeforeQuit(e);
    assert.equal(e.prevented, false);
    flow.cancelConfirmedQuit();
    const again = ev();
    flow.onBeforeQuit(again);
    assert.equal(again.prevented, true);
    await until(() => wins[0].confirms.length === 1);
  });

  it('quitNow (engine crash "Quit", start failure) quits without asking', () => {
    const { flow, wins, calls, ev } = setup({ windows: [{ work: WORK }] });
    flow.quitNow();
    assert.equal(calls.quit, 1);
    const e = ev();
    flow.onWindowClose(wins[0], e, 'main');
    assert.equal(e.prevented, false);
  });

  it('POSIX graceful stop: will-quit waits for the engine, then quits again', async () => {
    const { flow, engine, calls, ev } = setup({ windows: [], graceful: true });
    flow.quitNow();
    const e = ev();
    assert.equal(flow.onWillQuit(e), false);
    assert.equal(e.prevented, true);
    assert.equal(engine.stops, 1);
    const during = ev();
    assert.equal(flow.onWillQuit(during), false);
    assert.equal(during.prevented, true);
    assert.equal(engine.stops, 1);
    engine.release();
    await until(() => calls.quit === 2);
    const last = ev();
    assert.equal(flow.onWillQuit(last), true);
    assert.equal(last.prevented, false);
    assert.equal(engine.stops, 1);
  });
});
