// QA round (Redis): regressions found by walking the editors, the Workbench and Pub/Sub against the engine.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api/client';
import { engineSocket } from '../../../api/ws';
import { installKeyDispatcher } from '../../../commands/dispatcher';
import { runCommand } from '../../../commands/registry';
import { registerRedisCommands } from '../commands';
import { partialOf } from '../actions';
import { openBrowser, openRedisView, type BrowserState } from '../open';
import { useUi } from '../../../store/ui';
import { clearHistoryForTests } from '../store';
import { installRedisEngine, RedisHost, resetTabs, stubClipboard, until } from './kit';

const env = installRedisEngine();
let clipboard: string[] = [];

beforeAll(() => {
  registerRedisCommands();
  installKeyDispatcher();
});
beforeEach(() => {
  env.reset();
  resetTabs();
  clearHistoryForTests();
  clipboard = stubClipboard();
});

async function showKey(key: string, patch: Partial<BrowserState> = {}) {
  const id = openBrowser('c_redis', { db: 0, tree: false, pattern: key, selected: key, ...patch });
  render(<RedisHost tabId={id} />);
  await until(() => !!document.querySelector('.redis-keyrow'));
  return id;
}

describe('hash and sorted set editors', () => {
  it('a field that is edited and then deleted is only deleted (the edit must not bring it back)', async () => {
    await showKey('user:1001:profile');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Value of tier/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Value of tier/ }));
    const edit = screen.getByRole('textbox', { name: 'Edit Value of tier' });
    fireEvent.change(edit, { target: { value: 'diamond' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    expect(screen.getByText('1 pending change')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tier' }));
    expect(screen.getByText('1 pending change')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(env.hits('/hash', 'POST')).toHaveLength(1));
    expect(env.hits('/hash', 'POST')[0].body).toEqual({ del: ['tier'] });
  });

  it('restoring a deleted field brings its pending edit back', async () => {
    await showKey('user:1001:profile');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Value of tier/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Value of tier/ }));
    const edit = screen.getByRole('textbox', { name: 'Edit Value of tier' });
    fireEvent.change(edit, { target: { value: 'diamond' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete tier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore tier' }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(env.hits('/hash', 'POST')).toHaveLength(1));
    expect(env.hits('/hash', 'POST')[0].body).toEqual({ set: { tier: 'diamond' } });
  });

  it('a sorted-set member that is edited and then deleted is only removed', async () => {
    await showKey('leaderboard:daily');
    await screen.findByText(/of 14 members/);
    fireEvent.click(screen.getByRole('button', { name: /^Score of alice/ }));
    const e = screen.getByRole('textbox', { name: 'Edit Score of alice' });
    fireEvent.change(e, { target: { value: '9999' } });
    fireEvent.keyDown(e, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(env.hits('/zset', 'POST')).toHaveLength(1));
    expect(env.hits('/zset', 'POST')[0].body).toEqual({ remove: ['alice'] });
  });

  it('a blank score is refused, not saved as 0', async () => {
    await showKey('leaderboard:daily');
    await screen.findByText(/of 14 members/);
    fireEvent.click(screen.getByRole('button', { name: /^Score of alice/ }));
    const e = screen.getByRole('textbox', { name: 'Edit Score of alice' });
    fireEvent.change(e, { target: { value: '  ' } });
    fireEvent.keyDown(e, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText('Every score must be a number (or +inf / -inf).')).toBeInTheDocument();
    expect(env.hits('/zset', 'POST')).toHaveLength(0);
  });
});

describe('binary elements', () => {
  it('an edited binary hash value is saved with its bytes, the untouched binary field name travels as bytes', async () => {
    const real = api.redis.getKey.bind(api.redis);
    vi.spyOn(api.redis, 'getKey').mockImplementation(async (cid, key, q) => {
      const v = await real(cid, key, q);
      if (key !== 'user:1001:profile' || v.type !== 'hash') return v;
      return { ...v, fields: [{ field: 'k\\xff', value: 'v\\xfe' }, ...v.fields], bin: { 'k\\xff': '/w==', 'v\\xfe': '/g==' } };
    });
    await showKey('user:1001:profile');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Value of k\\xff/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Value of k\\xff/ }));
    const edit = screen.getByRole('textbox', { name: 'Edit Value of k\\xff' });
    fireEvent.change(edit, { target: { value: 'v\\xfe\\xfd' } });
    fireEvent.keyDown(edit, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(env.hits('/hash', 'POST')).toHaveLength(1));
    expect(env.hits('/hash', 'POST')[0].body).toEqual({
      set: { 'k\\xff': 'v\\xfe\\xfd' },
      // the field name keeps its bytes; the edited value is the new bytes 76 fe fd
      bin: { 'k\\xff': '/w==', 'v\\xfe\\xfd': 'dv79' },
    });
  });
});

describe('list editor', () => {
  it('removes the element at the clicked position (duplicates elsewhere stay)', async () => {
    await showKey('queue:jobs');
    await screen.findByText(/Items 0–3 of 4/);
    await api.redis.editList('c_redis', 0, 'queue:jobs', { push: { side: 'right', values: ['job:2'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText(/Items 0–4 of 5/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove element 4' }));
    await waitFor(() => expect(env.hits('/list', 'POST').length).toBeGreaterThan(1));
    expect(env.hits('/list', 'POST').at(-1)!.body).toEqual({ remove: { value: 'job:2', count: 1, index: 4 } });
    await screen.findByText(/Items 0–3 of 4/);
    // the first job:2 (index 1) is still there
    expect([...document.querySelectorAll('.redis-table tbody tr')].map((r) => r.textContent)).toEqual(['0job:1', '1job:2', '2job:3', '3job:4']);
  });

  it('stays on the page being edited after the list reloads', async () => {
    await showKey('queue:emails');
    expect(await screen.findByText(/Items 0–199 of 640/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(await screen.findByText(/Items 200–399 of 640/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'LPUSH' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New element' }), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: /Push/ }));
    await waitFor(() => expect(env.hits('/list', 'POST')).toHaveLength(1));
    await screen.findByText(/of 641/);
    // the reload fetched page 0, but the view went back to where the user was
    expect(await screen.findByText(/Items 200–399 of 641/)).toBeInTheDocument();
  }, 60_000);
});

describe('delete by pattern', () => {
  // The flaky "delete by pattern requires the typed count and reports progress": the mock job (15 ms) could finish
  // before the 202 reached the dialog, whose job.done subscription then never fired. Made deterministic here.
  it('reports the result of a job that finished before the 202 reached the dialog', async () => {
    const id = openBrowser('c_redis', { db: 0, tree: false, pattern: 'tags:post:1*' });
    render(<RedisHost tabId={id} />);
    await until(() => !!document.querySelector('.redis-keyrow'));
    vi.spyOn(api.redis, 'deletePattern').mockImplementation(async () => {
      engineSocket.dispatch({ type: 'job.done', ts: new Date().toISOString(), jobId: 'j_early', kind: 'redis.deletePattern', status: 'ok', error: null, result: { scanned: 111, deleted: 111 } });
      return { jobId: 'j_early' };
    });
    try {
      runCommand('redis.deletePattern');
      const dlg = await screen.findByRole('dialog', { name: 'Delete keys matching a pattern' });
      await waitFor(() => expect(within(dlg).getByRole('status')).toHaveTextContent(/permanently deletes 111 keys/));
      fireEvent.change(within(dlg).getByLabelText('Type the number of keys to confirm'), { target: { value: '111' } });
      fireEvent.click(within(dlg).getByRole('button', { name: /Delete 111 keys/ }));
      await waitFor(() => expect(within(dlg).getByText('Deleted 111 keys.')).toBeInTheDocument());
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('delete by pattern (cancelled)', () => {
  it('refreshes the lists when the job is cancelled: the keys already deleted must leave them', async () => {
    const id = openBrowser('c_redis', { db: 0, tree: false, pattern: 'tags:post:1*' });
    render(<RedisHost tabId={id} />);
    await until(() => !!document.querySelector('.redis-keyrow'));
    vi.spyOn(api.redis, 'deletePattern').mockResolvedValue({ jobId: 'j_cancel' });
    try {
      runCommand('redis.deletePattern');
      const dlg = await screen.findByRole('dialog', { name: 'Delete keys matching a pattern' });
      await waitFor(() => expect(within(dlg).getByRole('status')).toHaveTextContent(/permanently deletes 111 keys/));
      fireEvent.change(within(dlg).getByLabelText('Type the number of keys to confirm'), { target: { value: '111' } });
      const scans = env.hits('/keys/scan', 'POST').length;
      fireEvent.click(within(dlg).getByRole('button', { name: /Delete 111 keys/ }));
      await within(dlg).findByRole('progressbar');
      act(() => engineSocket.dispatch({ type: 'job.done', ts: new Date().toISOString(), jobId: 'j_cancel', kind: 'redis.deletePattern', status: 'cancelled', error: null, result: null }));
      expect(await within(dlg).findByText(/Cancelled: keys deleted so far stay deleted/)).toBeInTheDocument();
      await waitFor(() => expect(env.hits('/keys/scan', 'POST').length).toBeGreaterThan(scans));
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('slowlog threshold', () => {
  it('-1 reads as "logging disabled", not "-1 µs"', async () => {
    const id = openRedisView('c_redis', 'redis.slowlog', {});
    render(<RedisHost tabId={id} />);
    const input = await screen.findByLabelText('Slower than (µs)');
    await waitFor(() => expect(input).toHaveValue('10000'));
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('Stop logging slow commands');
    fireEvent.click(within(dlg).getByRole('button', { name: 'CONFIG SET' }));
    await waitFor(() => expect(env.hits('/config', 'PUT')).toHaveLength(1));
    expect(await screen.findByText('logging disabled')).toBeInTheDocument();
  });
});

describe('copy as JSON', () => {
  it('says so when a big value was only partly copied', async () => {
    await showKey('leaderboard:weekly');
    await screen.findByText(/of 450 members/);
    expect(partialOf({ type: 'zset', members: new Array(200).fill({ member: 'a', score: 1 }), cursor: '1', length: 450 } as never)).toEqual({ loaded: 200, total: 450 });
    expect(partialOf({ type: 'hash', fields: [], cursor: '0', length: 0 } as never)).toBeNull();
    expect(partialOf({ type: 'string', value: { $trunc: 'abc', len: 9 } } as never)).toEqual({ loaded: 3, total: 9 });
    fireEvent.click(screen.getByRole('button', { name: /Copy JSON/ }));
    await waitFor(() => expect(clipboard).toHaveLength(1));
    expect(JSON.parse(clipboard[0])).toHaveLength(450); // count 1000 per request: all 450 fit, so no warning
  });
});

describe('workbench Run button', () => {
  it('runs the line under the caret now, not the last Ctrl+Enter selection', async () => {
    const id = openRedisView('c_redis', 'redis.workbench', { db: 0, text: 'PING\nDBSIZE' });
    render(<RedisHost tabId={id} />);
    const ed = (await screen.findByRole('textbox', { name: 'Redis commands' })) as HTMLTextAreaElement;
    ed.setSelectionRange(1, 1);
    fireEvent.keyDown(ed, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(document.querySelectorAll('.redis-card')).toHaveLength(1));
    ed.setSelectionRange(7, 7);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Run$/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(env.hits('/commands', 'POST')).toHaveLength(2));
    expect((env.hits('/commands', 'POST')[0].body as { raw: string[] }).raw).toEqual(['PING']);
    expect((env.hits('/commands', 'POST')[1].body as { raw: string[] }).raw).toEqual(['DBSIZE']);
  });

  it('tells the user when the line is a comment instead of doing nothing', async () => {
    const id = openRedisView('c_redis', 'redis.workbench', { db: 0, text: '# just a note\nPING' });
    render(<RedisHost tabId={id} />);
    const ed = (await screen.findByRole('textbox', { name: 'Redis commands' })) as HTMLTextAreaElement;
    ed.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.text === 'Nothing to run')).toBe(true));
    expect(env.hits('/commands', 'POST')).toHaveLength(0);
  });
});

describe('pub/sub message list', () => {
  it('keeps the expanded message open when newer messages arrive', async () => {
    const id = openRedisView('c_redis', 'redis.pubsub', { channels: ['news'], patterns: [] });
    render(<RedisHost tabId={id} />);
    fireEvent.click(await screen.findByRole('button', { name: /Subscribe/ }));
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    await act(async () => {
      await api.redis.publish('c_redis', { channel: 'news', message: '{"a":1}' });
      await api.redis.publish('c_redis', { channel: 'news', message: 'plain' });
    });
    await waitFor(() => expect(document.querySelectorAll('.redis-msg')).toHaveLength(2));
    fireEvent.click(document.querySelectorAll<HTMLElement>('.redis-msg-row')[1]);
    expect(document.querySelector('.redis-msg-detail')?.textContent).toBe('{\n  "a": 1\n}');
    await act(async () => {
      await api.redis.publish('c_redis', { channel: 'news', message: 'newest' });
    });
    await waitFor(() => expect(document.querySelectorAll('.redis-msg')).toHaveLength(3));
    // the detail still belongs to the {"a":1} message, which is now the third row
    expect(document.querySelector('.redis-msg-detail')?.textContent).toBe('{\n  "a": 1\n}');
    expect(document.querySelectorAll('.redis-msg')[2].classList.contains('open')).toBe(true);
  });
});
