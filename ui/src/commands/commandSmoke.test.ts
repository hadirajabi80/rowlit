// QA (feature coverage round): every registered command is well formed and its enablement predicate (`when`) is
// safe to evaluate in any state. The palette, the menus and the toolbars call `when()` for every command on each
// render, with no arguments or with whatever target a context menu hands over; a predicate that throws takes the
// whole menu (or the palette) down with it.
import { beforeAll, describe, expect, it } from 'vitest';
import { initCommands } from '.';
import { getCommand, listCommands } from './registry';

beforeAll(() => initCommands(), 60_000);

/** Arguments a caller might hand a command: nothing, junk, and every target shape of commands/types.ts. */
const ARGS: unknown[] = [
  undefined,
  null,
  {},
  'x',
  42,
  { kind: 'connection', connectionId: 'c1' },
  { kind: 'tab', tabId: 't1' },
  { kind: 'object', connectionId: 'c1', database: null, ref: { database: null, schema: 'main', name: 'T', type: 'table' } },
  { kind: 'container', connectionId: 'c1', database: null, schema: 'main' },
  { kind: 'savedQuery', connectionId: 'c1', database: null, schema: null, id: 'q1', name: 'Q' },
  { kind: 'source', connectionId: 'c1', providerId: 'redis', nodeType: 'key', path: [] },
];

describe('command smoke', () => {
  it('registers every command with a unique id, a title and a category', () => {
    const cmds = listCommands();
    expect(cmds.length).toBeGreaterThan(300);
    const ids = new Set<string>();
    for (const c of cmds) {
      expect(c.id, 'id').toMatch(/^[a-zA-Z][\w.:-]*$/);
      expect(c.title.trim(), `${c.id} title`).not.toBe('');
      expect(c.category.trim(), `${c.id} category`).not.toBe('');
      expect(typeof c.run, `${c.id} run`).toBe('function');
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
    }
  });

  it('every `when` predicate returns a boolean (or nothing) for any argument without throwing', () => {
    const failures: string[] = [];
    for (const c of listCommands()) {
      const cmd = getCommand(c.id);
      if (!cmd?.when) continue;
      for (const arg of ARGS) {
        try {
          const r = (cmd.when as (a?: unknown) => unknown)(arg);
          if (r !== undefined && typeof r !== 'boolean') failures.push(`${c.id}(${JSON.stringify(arg)}) returned ${typeof r}`);
        } catch (e) {
          failures.push(`${c.id}(${JSON.stringify(arg)}) threw ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
