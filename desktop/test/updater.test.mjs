// Auto-update state machine (src/main/updater-core.ts) driven by a fake electron-updater and fake timers:
// scheduling (10 s, then every 6 h, only once the renderer reports the setting), the Windows/signed-macOS install flow,
// the ad-hoc macOS notify flow, error handling, and the macOS signature detection.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { desktopRoot } from './helpers.mjs';

const require = createRequire(import.meta.url);
const u = require(join(desktopRoot, 'out', 'lib', 'updater-core.js'));

/** electron-updater's AppUpdater, as far as the controller uses it. `script` decides what each check does. */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  checks = 0;
  installs = [];
  script = (self) => { self.emit('update-not-available', { version: '0.2.0' }); return { isUpdateAvailable: false, updateInfo: { version: '0.2.0' } }; };
  async checkForUpdates() {
    this.checks++;
    this.emit('checking-for-update');
    return this.script(this);
  }
  quitAndInstall(...args) { this.installs.push(args); }
  /** One entry per download (resolve / reject end it), a cancelled token rejects it like electron-updater's CancellationError. */
  downloads = [];
  downloadUpdate(token) {
    const d = { token, settled: false };
    d.promise = new Promise((resolve, reject) => {
      d.resolve = (v) => { d.settled = true; resolve(v); };
      d.reject = (e) => { d.settled = true; reject(e); };
      token.onCancel = () => d.reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' }));
    });
    this.downloads.push(d);
    return d.promise;
  }
}

/** builder-util-runtime's CancellationToken, as far as the controller uses it. */
class FakeToken {
  cancelled = false;
  cancel() { this.cancelled = true; this.onCancel?.(); }
}

function fakeTimers() {
  let now = 0, seq = 0;
  const timeouts = new Map(), intervals = new Map();
  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => { const id = ++seq; timeouts.set(id, { fn, at: now + ms }); return id; },
      clearTimeout: (id) => timeouts.delete(id),
      setInterval: (fn, ms) => { const id = ++seq; intervals.set(id, { fn, ms, next: now + ms }); return id; },
      clearInterval: (id) => intervals.delete(id),
    },
    pending: () => timeouts.size + intervals.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timeouts.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        const tick = [...intervals.values()].filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due && !tick) break;
        if (due && (!tick || due[1].at <= tick.next)) { now = due[1].at; timeouts.delete(due[0]); due[1].fn(); }
        else { now = tick.next; tick.next += tick.ms; tick.fn(); }
        await new Promise((r) => setImmediate(r));
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    },
  };
}

function setup({ mode = 'install', updater = new FakeUpdater(), silentInstall = mode === 'install' } = {}) {
  const t = fakeTimers();
  const sent = [], logs = [];
  const c = new u.UpdateController({
    updater, mode, currentVersion: '0.2.0', silentInstall,
    send: (s) => sent.push(s), log: (m) => logs.push(m), timers: t.timers, now: t.now,
    createCancellationToken: () => new FakeToken(),
  });
  return { c, t, sent, logs, updater, states: () => sent.map((s) => s.state) };
}

const available = (version) => (self) => {
  self.emit('update-available', { version });
  return { isUpdateAvailable: true, updateInfo: { version } };
};

describe('update scheduling', () => {
  it('checks nothing until the renderer reports the setting, then 10 s after start and every 6 h', async () => {
    const { c, t, updater } = setup();
    await t.advance(60_000);
    assert.equal(updater.checks, 0, 'no automatic check before configure()');
    c.configure({ autoCheck: true });
    await t.advance(0);
    assert.equal(updater.checks, 1, 'the 10 s start delay already passed: check right away');
    await t.advance(u.CHECK_INTERVAL_MS - 1);
    assert.equal(updater.checks, 1);
    await t.advance(1);
    assert.equal(updater.checks, 2, 'every 6 hours');
    await t.advance(u.CHECK_INTERVAL_MS);
    assert.equal(updater.checks, 3);
    assert.equal(u.INITIAL_CHECK_DELAY_MS, 10_000);
    assert.equal(u.CHECK_INTERVAL_MS, 6 * 3600_000);
  });

  it('the first check waits for the rest of the 10 s start delay', async () => {
    const { c, t, updater } = setup();
    await t.advance(3_000);
    c.configure({ autoCheck: true });
    await t.advance(6_999);
    assert.equal(updater.checks, 0);
    await t.advance(1);
    assert.equal(updater.checks, 1);
  });

  it('turning the setting off cancels the timers; repeating the same value is a no-op', async () => {
    const { c, t, updater } = setup();
    c.configure({ autoCheck: true });
    c.configure({ autoCheck: true });
    assert.equal(t.pending(), 2);
    c.configure({ autoCheck: false });
    assert.equal(t.pending(), 0);
    await t.advance(2 * u.CHECK_INTERVAL_MS);
    assert.equal(updater.checks, 0);
    c.configure({ autoCheck: true });
    c.dispose();
    assert.equal(t.pending(), 0);
  });
});

describe('install mode (Windows, Developer ID signed macOS)', () => {
  it('configures electron-updater for explicit (stoppable) download and install on quit', () => {
    const { updater } = setup();
    assert.equal(updater.autoDownload, false, 'the controller starts the download itself so it owns the CancellationToken');
    assert.equal(updater.autoInstallOnAppQuit, true, '"Later" installs on quit');
    assert.equal(updater.allowPrerelease, false);
  });

  it('up to date: checking -> up-to-date, reported to a manual check', async () => {
    const { c, states } = setup();
    const r = await c.check({ manual: true });
    assert.equal(r.state, 'up-to-date');
    assert.equal(r.currentVersion, '0.2.0');
    assert.deepEqual(states(), ['checking', 'up-to-date'], 'repeated identical statuses are not re-sent');
  });

  it('update: downloading with progress, then ready; Restart now runs the installer silently and relaunches', async () => {
    const { c, updater, sent } = setup();
    updater.script = available('0.3.0');
    const r = await c.check();
    assert.equal(r.state, 'downloading');
    assert.equal(r.version, '0.3.0');
    assert.equal(c.quitAndInstall(), false, 'nothing to install while downloading');
    updater.emit('download-progress', { percent: 41.6 });
    assert.equal(c.status.percent, 42);
    updater.emit('update-downloaded', { version: '0.3.0' });
    assert.equal(c.status.state, 'ready');
    assert.equal(c.status.releaseUrl, 'https://github.com/hadirajabi80/rowlit/releases/tag/v0.3.0');
    assert.equal(sent.at(-1).state, 'ready');
    // A downloaded update is not checked again (the 6-hourly timer just reports it).
    assert.equal((await c.check()).state, 'ready');
    assert.equal(updater.checks, 1);
    assert.equal(c.quitAndInstall(), true);
    assert.deepEqual(updater.installs, [[true, true]]);
  });

  it('signed macOS uses the default quitAndInstall()', async () => {
    const { c, updater } = setup({ silentInstall: false });
    updater.emit('update-downloaded', { version: '0.3.0' });
    assert.equal(c.quitAndInstall(), true);
    assert.deepEqual(updater.installs, [[]]);
  });

  it('concurrent checks share one request', async () => {
    const { c, updater } = setup();
    let release;
    updater.script = () => new Promise((r) => { release = r; });
    const a = c.check(), b = c.check({ manual: true });
    assert.equal(a, b);
    release({ isUpdateAvailable: false, updateInfo: { version: '0.2.0' } });
    assert.equal((await a).state, 'up-to-date', 'derived from the result when no event came');
    assert.equal(updater.checks, 1);
  });
});

describe('stopping the download (install mode)', () => {
  const flush = () => new Promise((r) => setImmediate(r));

  it('starts the download explicitly with a cancellation token', async () => {
    const { c, updater } = setup();
    updater.script = available('0.3.0');
    assert.equal((await c.check()).state, 'downloading');
    await flush();
    assert.equal(updater.downloads.length, 1);
    assert.ok(updater.downloads[0].token instanceof FakeToken);
  });

  it('stop cancels the token and reports "available" with downloadStopped; the cancel rejection is not an error', async () => {
    const { c, updater, sent, logs } = setup();
    updater.script = available('0.3.0');
    await c.check();
    await flush();
    updater.emit('download-progress', { percent: 30 });
    assert.equal(c.stopDownload(), true);
    assert.equal(updater.downloads[0].token.cancelled, true);
    assert.equal(c.status.state, 'available');
    assert.equal(c.status.downloadStopped, true);
    assert.equal(c.status.version, '0.3.0');
    assert.equal(c.status.percent, undefined);
    assert.equal(c.status.releaseUrl, 'https://github.com/hadirajabi80/rowlit/releases/tag/v0.3.0');
    await flush();
    assert.equal(c.status.state, 'available', 'the CancellationError did not become an error status');
    assert.ok(!sent.some((s) => s.state === 'error'));
    assert.ok(logs.some((l) => l.includes('stopped')));
    // late progress of the cancelled download is ignored
    updater.emit('download-progress', { percent: 31 });
    assert.equal(c.status.state, 'available');
    assert.equal(c.stopDownload(), false, 'nothing left to stop');
    assert.equal(c.quitAndInstall(), false);
  });

  it('stop does nothing unless a download is in progress', () => {
    const { c, updater } = setup();
    assert.equal(c.stopDownload(), false);
    updater.emit('update-downloaded', { version: '0.3.0' });
    assert.equal(c.stopDownload(), false, 'a finished download stays');
    assert.equal(c.status.state, 'ready');
    const off = new u.UpdateController({ updater: null, mode: 'disabled', currentVersion: '0.2.0', send: () => {}, log: () => {} });
    assert.equal(off.stopDownload(), false);
  });

  it('automatic checks (timer) do not restart a stopped download; a manual check does', async () => {
    const { c, t, updater } = setup();
    updater.script = available('0.3.0');
    c.configure({ autoCheck: true });
    await t.advance(u.INITIAL_CHECK_DELAY_MS);
    await flush();
    assert.equal(c.status.state, 'downloading');
    assert.equal(updater.downloads.length, 1);
    c.stopDownload();
    await flush();
    await t.advance(u.CHECK_INTERVAL_MS);
    await t.advance(u.CHECK_INTERVAL_MS);
    assert.ok(updater.checks >= 3, 'the timer still checks');
    assert.equal(updater.downloads.length, 1, 'but never downloads the stopped version again');
    assert.equal(c.status.state, 'available');
    assert.equal(c.status.downloadStopped, true);
    assert.equal((await c.check()).state, 'available', 'an explicit automatic check also leaves it');
    assert.equal(updater.downloads.length, 1);
    // manual "Download / Resume": a fresh token, a fresh download
    const r = await c.check({ manual: true });
    assert.equal(r.state, 'downloading');
    assert.equal(r.downloadStopped, undefined);
    assert.equal(r.percent, 0);
    await flush();
    assert.equal(updater.downloads.length, 2);
    assert.notEqual(updater.downloads[1].token, updater.downloads[0].token);
    assert.equal(updater.downloads[1].token.cancelled, false);
    updater.emit('update-downloaded', { version: '0.3.0' });
    assert.equal(c.status.state, 'ready');
  });

  it('a newer version than the stopped one downloads automatically', async () => {
    const { c, updater } = setup();
    updater.script = available('0.3.0');
    await c.check();
    await flush();
    c.stopDownload();
    await flush();
    updater.script = available('0.4.0');
    assert.equal((await c.check()).state, 'downloading');
    assert.equal(c.status.version, '0.4.0');
  });

  it('resuming while the cancelled download is still unwinding waits for it', async () => {
    const { c, updater } = setup();
    updater.script = available('0.3.0');
    await c.check();
    await flush();
    const first = updater.downloads[0];
    first.token.onCancel = () => undefined; // electron-updater is still removing the partial file
    c.stopDownload();
    await c.check({ manual: true });
    await flush();
    assert.equal(updater.downloads.length, 1, 'electron-updater would join the old download: wait until it has settled');
    first.reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' }));
    await flush();
    assert.equal(updater.downloads.length, 2);
    assert.equal(c.status.state, 'downloading');
  });

  it('a real download failure is still an error', async () => {
    const { c, updater } = setup();
    updater.script = available('0.3.0');
    await c.check();
    await flush();
    updater.downloads[0].reject(new Error('net::ERR_CONNECTION_RESET'));
    await flush();
    assert.equal(c.status.state, 'error');
    assert.equal(c.status.message, 'net::ERR_CONNECTION_RESET');
  });

  it('notify mode never downloads, so there is nothing to stop', async () => {
    const { c, updater } = setup({ mode: 'notify' });
    updater.script = available('0.3.1');
    await c.check({ manual: true });
    await flush();
    assert.equal(updater.downloads.length, 0);
    assert.equal(c.stopDownload(), false);
  });
});

describe('notify mode (ad-hoc signed macOS)', () => {
  it('never downloads: announces the version with its release page', async () => {
    const { c, updater } = setup({ mode: 'notify' });
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    updater.script = available('0.3.1');
    const r = await c.check({ manual: true });
    assert.equal(r.state, 'available');
    assert.equal(r.mode, 'notify');
    assert.equal(r.version, '0.3.1');
    assert.equal(r.releaseUrl, 'https://github.com/hadirajabi80/rowlit/releases/tag/v0.3.1');
    assert.equal(c.quitAndInstall(), false, 'Squirrel.Mac would refuse an ad-hoc signed app');
    assert.deepEqual(updater.installs, []);
  });
});

describe('errors', () => {
  it('are logged and reported as a status, never thrown; the first line only', async () => {
    const { c, updater, logs } = setup();
    updater.script = () => { throw new Error('net::ERR_INTERNET_DISCONNECTED\n<html>...'); };
    const r = await c.check({ manual: true });
    assert.equal(r.state, 'error');
    assert.equal(r.message, 'net::ERR_INTERNET_DISCONNECTED');
    assert.ok(logs.some((l) => l.includes('update error: net::ERR_INTERNET_DISCONNECTED')));
    updater.script = available('0.3.0');
    assert.equal((await c.check()).state, 'downloading', 'the next check recovers');
  });

  it('an error event after the download keeps the update installable', () => {
    const { c, updater } = setup();
    updater.emit('update-downloaded', { version: '0.3.0' });
    updater.emit('error', new Error('later check failed'));
    assert.equal(c.status.state, 'ready');
  });

  it('a renderer that cannot be reached does not break the controller', async () => {
    const updater = new FakeUpdater();
    const logs = [];
    const c = new u.UpdateController({ updater, mode: 'install', currentVersion: '0.2.0', send: () => { throw new Error('gone'); }, log: (m) => logs.push(m) });
    assert.equal((await c.check()).state, 'up-to-date');
    assert.ok(logs.some((l) => l.includes('not delivered')));
  });
});

describe('disabled (dev, unpackaged, Linux, smoke)', () => {
  it('reports the reason and does nothing', async () => {
    const sent = [];
    const c = new u.UpdateController({ updater: null, mode: 'install', disabledReason: 'dev build', currentVersion: '0.2.0', send: (s) => sent.push(s), log: () => {} });
    assert.deepEqual(c.status, { state: 'disabled', mode: 'disabled', currentVersion: '0.2.0', message: 'dev build' });
    c.configure({ autoCheck: true });
    assert.equal((await c.check({ manual: true })).state, 'disabled');
    assert.equal(c.quitAndInstall(), false);
    assert.deepEqual(sent, []);
  });
});

describe('mode per OS and macOS signature', () => {
  it('Windows installs, macOS installs only with a Developer ID signature, Linux is disabled', () => {
    assert.equal(u.updateModeFor('win32'), 'install');
    assert.equal(u.updateModeFor('darwin', 'developer-id'), 'install');
    for (const s of ['adhoc', 'unsigned', 'unknown', undefined]) assert.equal(u.updateModeFor('darwin', s), 'notify', String(s));
    assert.equal(u.updateModeFor('linux'), 'disabled');
  });

  it('parses codesign -dv output', () => {
    const adhoc = 'Executable=/Applications/DbStudio.app/Contents/MacOS/DbStudio\nIdentifier=com.dbstudio.desktop\nCodeDirectory v=20400 size=500 flags=0x20002(adhoc,linker-signed) hashes=4+7\nSignature=adhoc\nTeamIdentifier=not set\n';
    const devId = 'Executable=/Applications/DbStudio.app/Contents/MacOS/DbStudio\nCodeDirectory v=20500 size=500 flags=0x10000(runtime) hashes=4+7\nAuthority=Developer ID Application: Example Ltd (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=ABCDE12345\n';
    assert.equal(u.parseCodesignOutput(adhoc), 'adhoc');
    assert.equal(u.parseCodesignOutput(devId), 'developer-id');
    assert.equal(u.parseCodesignOutput('/Applications/DbStudio.app: code object is not signed at all'), 'unsigned');
    assert.equal(u.parseCodesignOutput(''), 'unknown');
    assert.equal(u.parseCodesignOutput('Authority=Apple Development: me (X)\nTeamIdentifier=X\n'), 'unknown', 'a development certificate is not enough');
  });

  it('release page URLs only for plain versions', () => {
    assert.equal(u.releasePageUrl('1.2.3'), 'https://github.com/hadirajabi80/rowlit/releases/tag/v1.2.3');
    assert.equal(u.releasePageUrl('1.2.3-beta.1'), 'https://github.com/hadirajabi80/rowlit/releases/tag/v1.2.3-beta.1');
    assert.equal(u.releasePageUrl('../../evil'), 'https://github.com/hadirajabi80/rowlit/releases');
    assert.equal(u.releasePageUrl(undefined), u.RELEASES_URL);
  });
});
