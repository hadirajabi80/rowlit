// Snapshot triggers of the local history: new console baseline, Run, Save, close, the 2-minute autosave, the settings gate.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useResults } from '../../../store/results';
import { DEFAULT_SETTINGS, useSettings } from '../../../store/settings';
import { useTabs, type ConsoleTab } from '../../../store/tabs';
import type { SnapshotInput } from '../api';
import { AUTO_INTERVAL_MS, startLocalHistoryCapture, stopLocalHistoryCapture } from '../capture';

let sent: SnapshotInput[];
let prune: Mock<(days: number) => Promise<unknown>>;

const consoleOf = (id: string) => useTabs.getState().tabs.find((t) => t.id === id) as ConsoleTab;

function newConsole(text: string): string {
  const id = useTabs.getState().newConsole({ connectionId: 'c1', database: null });
  useTabs.getState().updateText(id, text);
  return id;
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  prune = vi.fn<(days: number) => Promise<unknown>>().mockResolvedValue({ removed: 0, bytes: 0 });
  useTabs.setState({ tabs: [], activeId: null, mru: [], closed: [] });
  useResults.setState({ byTab: {}, executions: {}, views: {}, activeView: {} });
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  startLocalHistoryCapture({ send: (i) => { sent.push(i); return Promise.resolve({ id: sent.length, added: true }); }, prune });
});
afterEach(() => {
  stopLocalHistoryCapture();
  vi.useRealTimers();
});

describe('local history capture', () => {
  it('takes a baseline snapshot of an opened console that has text, and none of an empty one', () => {
    useTabs.getState().newConsole({ connectionId: 'c1', database: null });
    expect(sent).toEqual([]);
    const id = useTabs.getState().newConsole({ connectionId: 'c1', database: null, text: 'select 1' });
    expect(sent).toEqual([{ key: `t:${id}`, text: 'select 1', reason: 'auto', title: consoleOf(id).title }]);
    // a workspace restored at startup brings its consoles back all at once
    const restored = consoleOf(id);
    useTabs.getState().restore({ version: 1, tabs: [{ ...restored, id: 't_restored', text: 'select 2', savedText: 'select 2' }], activeId: 't_restored', seq: 5 });
    expect(sent.find((s) => s.text === 'select 2')).toMatchObject({ reason: 'auto', key: 't:t_restored' });
  });

  it('snapshots on Run, with the editor text and the tab key', () => {
    const id = newConsole('select * from orders');
    sent.length = 0;
    useResults.setState({ byTab: { [id]: 'x_1' } });
    expect(sent).toEqual([{ key: `t:${id}`, text: 'select * from orders', reason: 'run', title: consoleOf(id).title }]);
  });

  it('does not store the same text twice for a key, and skips blank text', () => {
    const id = newConsole('select 1');
    sent.length = 0;
    useResults.setState({ byTab: { [id]: 'x_1' } });
    useResults.setState({ byTab: { [id]: 'x_2' } });
    expect(sent.filter((s) => s.text === 'select 1')).toHaveLength(1);
    useTabs.getState().updateText(id, '   \n');
    useResults.setState({ byTab: { [id]: 'x_3' } });
    expect(sent.some((s) => s.text.trim() === '')).toBe(false);
  });

  it('snapshots on Save, keyed by the file once the console is a file', () => {
    const id = newConsole('select 1');
    sent.length = 0;
    useTabs.getState().updateText(id, 'select 2');
    useTabs.getState().markSaved(id, 'C:\\sql\\report.sql', 'report.sql');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ key: 'f:C:\\sql\\report.sql', text: 'select 2', reason: 'save', title: 'report.sql' });
  });

  it('snapshots the last text when the console closes', () => {
    const id = newConsole('select 1');
    useTabs.getState().updateText(id, 'select 1 -- last words');
    sent.length = 0;
    useTabs.getState().close(id);
    expect(sent).toEqual([expect.objectContaining({ key: `t:${id}`, text: 'select 1 -- last words', reason: 'close' })]);
  });

  it('autosaves at most once per interval while the text changes, and only when it changed', () => {
    const id = newConsole('a');
    sent.length = 0;
    useTabs.getState().updateText(id, 'ab');
    vi.advanceTimersByTime(AUTO_INTERVAL_MS - 1000);
    useTabs.getState().updateText(id, 'abc');
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([expect.objectContaining({ text: 'abc', reason: 'auto' })]);
    // typing again starts a new interval
    useTabs.getState().updateText(id, 'abcd');
    vi.advanceTimersByTime(AUTO_INTERVAL_MS);
    expect(sent.map((s) => s.text)).toEqual(['abc', 'abcd']);
    // no change, no timer
    vi.advanceTimersByTime(AUTO_INTERVAL_MS * 3);
    expect(sent).toHaveLength(2);
  });

  it('a Run cancels the pending autosave (its snapshot covers the text)', () => {
    const id = newConsole('a');
    sent.length = 0;
    useTabs.getState().updateText(id, 'ab');
    useResults.setState({ byTab: { [id]: 'x_1' } });
    vi.advanceTimersByTime(AUTO_INTERVAL_MS * 2);
    expect(sent.map((s) => s.reason)).toEqual(['run']);
  });

  it('uses the saved query as the key of a bound console', () => {
    const id = newConsole('select 1');
    useTabs.getState().bindSavedQuery(id, { id: 'q_9', connectionId: 'c1', database: null, schema: null, name: 'Top' });
    sent.length = 0;
    useTabs.getState().updateText(id, 'select 2');
    useResults.setState({ byTab: { [id]: 'x_1' } });
    expect(sent[0]).toMatchObject({ key: 'q:q_9', text: 'select 2' });
  });

  it('takes nothing while "Keep local history" is off, and resumes when it is turned on', () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: { localHistory: false } } });
    const id = newConsole('select 1');
    useResults.setState({ byTab: { [id]: 'x_1' } });
    useTabs.getState().close(id);
    expect(sent).toEqual([]);
    useSettings.setState({ settings: DEFAULT_SETTINGS });
    const id2 = newConsole('select 2');
    useResults.setState({ byTab: { [id2]: 'x_2' } });
    expect(sent.some((s) => s.text === 'select 2')).toBe(true);
  });

  it('prunes by the retention setting once, after the first stored snapshot', async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: { localHistoryDays: 7 } } });
    const id = newConsole('select 1');
    useResults.setState({ byTab: { [id]: 'x_1' } });
    useResults.setState({ byTab: { [id]: 'x_2' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledWith(7);
  });

  it('retries a failed snapshot with the next trigger', async () => {
    stopLocalHistoryCapture();
    let fail = true;
    const calls: SnapshotInput[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    startLocalHistoryCapture({ send: (i) => { calls.push(i); return fail ? Promise.reject(new Error('down')) : Promise.resolve({ id: 1, added: true }); }, prune });
    const id = newConsole('select 1');
    useResults.setState({ byTab: { [id]: 'x_1' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    fail = false;
    useResults.setState({ byTab: { [id]: 'x_2' } });
    expect(calls).toHaveLength(2); // not suppressed as "already sent"
    useResults.setState({ byTab: { [id]: 'x_3' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2); // now it is
  });
});
