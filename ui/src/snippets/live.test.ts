/// <reference types="node" />
// Live check of the built-in snippets against the Docker sample servers (compose project dbstudio-it, see
// engine/tests/docker/compose.yml). Skipped unless SNIPPETS_LIVE=1, and for a server whose container is not running:
//
//   cd ui && SNIPPETS_LIVE=1 npx vitest run --config vitest.intel.config.ts src/snippets/live.test.ts
//   (SNIPPETS_LIVE_VERBOSE=1 also lists the expected "object not found" errors, SNIPPETS_ONLY=tsql limits the servers)
//
// Every snippet is expanded (placeholders at their defaults), split into the batches Rowlit would send, and executed
// through the server's own command-line client inside a throw-away database/schema. Snippets flagged `run` are read-only
// and must succeed as inserted. All others reference tables that do not exist, so "object not found" style errors are
// expected; only syntax errors (and unknown built-in functions) fail the test.
import { spawn, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dialect } from '../api/types';
import { createIntel } from '../intel';
import { ensureDialect } from '../intel/dialect/registry';
import { ensureBuiltins, snippetPreview, type SnippetDef } from './index';

const LIVE = process.env.SNIPPETS_LIVE === '1';
const ONLY = process.env.SNIPPETS_ONLY;
const SCRATCH = 'snip_scratch';
const PARALLEL = 6;

interface Server {
  name: string;
  dialect: Dialect;
  container: string;
  /** Prepare the scratch database. */
  setup(): void;
  teardown(): void;
  /** Run one batch; resolves to the client's combined output. */
  exec(sql: string): Promise<string>;
  /** Output lines that are errors, as { code, message }. */
  errors(out: string): { code: string; message: string }[];
  /** Errors that mean the SQL itself is wrong (not just that the sample objects are missing). */
  isSyntax(e: { code: string; message: string }): boolean;
  /** Statement that stands in for the cursor position ($0) of a body, when that sits on a line of its own. */
  filler(body: string): string;
  /** Snippets that belong to another engine of the same dialect (MySQL vs MariaDB) and are skipped here. */
  skip?: string[];
  /** Read-only snippets may fail for engine differences (a disabled performance_schema…): only syntax errors count. */
  lenientRun?: boolean;
  /** Runs all batches of a snippet in one session, joined by this text (session state such as PREPARE survives); default: one call per batch. */
  joiner?: string;
}

function docker(container: string, args: string[], input?: string): string {
  const r = spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

/** The same, without blocking: snippets are executed several at a time. */
function dockerAsync(container: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', container, ...args]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => p.kill(), 120_000);
    p.on('close', () => { clearTimeout(timer); resolve(out); });
    p.on('error', () => { clearTimeout(timer); resolve(out); });
    p.stdin.on('error', () => undefined);
    p.stdin.end(input ?? '');
  });
}

function running(name: string): boolean {
  const r = spawnSync('docker', ['ps', '--filter', `name=^${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
  return (r.stdout ?? '').trim() === name;
}

const MSSQL_PW = 'DbStudio_Dev_2026!';
const SQLCMD = (db: string) => ['/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', 'sa', '-P', MSSQL_PW, '-C', '-W', '-d', db, '-i', '/dev/stdin'];
const ORA = (user: string) => ['sqlplus', '-S', '-L', user === 'system' ? 'system/DbStudioDev2026@//localhost:1521/FREEPDB1' : `${user}/${user}@//localhost:1521/FREEPDB1`];
const mysqlErrors = (out: string) => [...out.matchAll(/ERROR (\d+) \([^)]*\)[^:]*: ([^\n]*)/g)].map((m) => ({ code: m[1], message: m[2] }));
// 1064 syntax, 1303/1235/1286/1193 unknown option or variable, 1305 unknown function
const mysqlSyntax = (e: { code: string; message: string }) => ['1064', '1303', '1235', '1286', '1193'].includes(e.code) || (e.code === '1305' && /FUNCTION/.test(e.message));
const mysqlFiller = (body: string) => (/^EXPLAIN/i.test(body) ? 'SELECT 1;' : 'SET @snip = 1;');

const SERVERS: Server[] = [
  {
    name: 'SQL Server 2022', dialect: 'tsql', container: 'dbstudio-it-mssql-1',
    setup() { docker(this.container, SQLCMD('master'), `DROP DATABASE IF EXISTS ${SCRATCH};\nGO\nCREATE DATABASE ${SCRATCH};\nGO\n`); },
    teardown() { docker(this.container, SQLCMD('master'), `ALTER DATABASE ${SCRATCH} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;\nGO\nDROP DATABASE IF EXISTS ${SCRATCH};\nGO\n`); },
    exec(sql) { return dockerAsync(this.container, SQLCMD(SCRATCH), `${sql}\nGO\n`); },
    // (an undeclared @variable in front of WITH also reports 319: not a syntax problem of the snippet)
    errors: (out) => [...out.matchAll(/Msg (\d+), Level (\d+), State \d+[^\n]*\n([^\n]*)/g)].map((m) => ({ code: m[1], message: m[3] })).filter((e) => !(e.code === '319' && out.includes('Msg 137'))),
    // 102/103/105/111/125/156/170/174/195/319/321: syntax, unknown function, bad option
    isSyntax: (e) => ['102', '103', '105', '111', '125', '156', '170', '174', '195', '319', '321', '1018', '8120', '8121', '137', '4104'].includes(e.code) && !/Must declare the (scalar|table) variable/.test(e.message),
    filler: () => 'SELECT 1;',
  },
  {
    name: 'PostgreSQL 17', dialect: 'pgsql', container: 'dbstudio-it-postgres-1',
    setup() { const p = (q: string) => docker(this.container, ['psql', '-U', 'shop', '-d', 'postgres', '-X', '-q', '-c', q]); p(`DROP DATABASE IF EXISTS ${SCRATCH}`); p(`CREATE DATABASE ${SCRATCH}`); },
    teardown() { docker(this.container, ['psql', '-U', 'shop', '-d', 'postgres', '-X', '-q', '-c', `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`]); },
    exec(sql) { return dockerAsync(this.container, ['psql', '-U', 'shop', '-d', SCRATCH, '-X', '-q'], sql.trimEnd().endsWith(';') ? sql : `${sql};`); },
    errors: (out) => [...out.matchAll(/ERROR:\s+([^\n]*)/g)].map((m) => ({ code: 'ERROR', message: m[1] })),
    isSyntax: (e) => /syntax error|unterminated|function [^\n]* does not exist|unrecognized|invalid (?:reference|value for parameter)|operator does not exist|query has no destination/i.test(e.message),
    // (`$$` is written `\$\$` in a snippet body)
    filler: (body) => (body.includes('\\$\\$') ? 'NULL;' : 'SELECT 1;'),
  },
  {
    name: 'MySQL 8.4', dialect: 'mysql', container: 'dbstudio-it-mysql-1',
    setup() { const m = (q: string) => docker(this.container, ['mysql', '-uroot', '-pshop', '-e', q]); m(`DROP DATABASE IF EXISTS ${SCRATCH}`); m(`CREATE DATABASE ${SCRATCH}`); },
    teardown() { docker(this.container, ['mysql', '-uroot', '-pshop', '-e', `DROP DATABASE IF EXISTS ${SCRATCH}`]); },
    exec(sql) { return dockerAsync(this.container, ['mysql', '-uroot', '-pshop', '--force', '-D', SCRATCH], `DELIMITER ~~\n${sql}\n~~\n`); },
    errors: mysqlErrors, isSyntax: mysqlSyntax, filler: mysqlFiller, skip: ['seq'], joiner: '\n~~\n',
  },
  {
    name: 'MariaDB 11', dialect: 'mysql', container: 'dbstudio-it-mariadb-1',
    setup() { const m = (q: string) => docker(this.container, ['mariadb', '-uroot', '-pshop', '-e', q]); m(`DROP DATABASE IF EXISTS ${SCRATCH}`); m(`CREATE DATABASE ${SCRATCH}`); },
    teardown() { docker(this.container, ['mariadb', '-uroot', '-pshop', '-e', `DROP DATABASE IF EXISTS ${SCRATCH}`]); },
    exec(sql) { return dockerAsync(this.container, ['mariadb', '-uroot', '-pshop', '--force', '-D', SCRATCH], `DELIMITER ~~\n${sql}\n~~\n`); },
    errors: mysqlErrors, isSyntax: mysqlSyntax, filler: mysqlFiller, lenientRun: true, joiner: '\n~~\n',
    // MySQL-only: LATERAL, the sys schema, EXPLAIN ANALYZE
    skip: ['apply', 'idxuse', 'block', 'locks', 'explain'],
  },
  {
    name: 'ClickHouse 24.8', dialect: 'clickhouse', container: 'dbstudio-it-clickhouse-1',
    setup() { const c = (q: string) => docker(this.container, ['clickhouse-client', '--user', 'shop', '--password', 'shop', '--query', q]); c(`DROP DATABASE IF EXISTS ${SCRATCH}`); c(`CREATE DATABASE ${SCRATCH}`); },
    teardown() {
      const c = (q: string) => docker(this.container, ['clickhouse-client', '--user', 'shop', '--password', 'shop', '--query', q]);
      c(`DROP DATABASE IF EXISTS ${SCRATCH} SYNC`);
      c('DROP FUNCTION IF EXISTS fn_name'); // the udf snippet creates a (server-wide) SQL function
    },
    exec(sql) { return dockerAsync(this.container, ['clickhouse-client', '--user', 'shop', '--password', 'shop', '--database', SCRATCH, '--multiquery'], sql.trimEnd().endsWith(';') ? sql : `${sql};`); },
    errors: (out) => [...out.matchAll(/^Code: (\d+)\. DB::Exception: ([^\n]*)/gm)].map((m) => ({ code: m[1], message: m[2] })),
    // 62 SYNTAX_ERROR, 46 UNKNOWN_FUNCTION, 36/42/48 bad arguments; unknown tables/identifiers are expected
    isSyntax: (e) => ['62', '46', '42', '36', '48', '215', '232', '344'].includes(e.code) && !/Unknown (expression|table|identifier)/.test(e.message),
    filler: () => 'SELECT 1',
  },
  {
    name: 'Oracle 23ai', dialect: 'plsql', container: 'dbstudio-it-oracle-1',
    setup() {
      const o = (q: string) => docker(this.container, ORA('system'), `SET SQLBLANKLINES ON\n${q}\nEXIT\n`);
      o(`BEGIN EXECUTE IMMEDIATE 'DROP USER snip CASCADE'; EXCEPTION WHEN OTHERS THEN NULL; END;\n/`);
      o(`CREATE USER snip IDENTIFIED BY snip QUOTA UNLIMITED ON USERS;\nGRANT DBA TO snip;`);
    },
    teardown() { docker(this.container, ORA('system'), `DROP USER snip CASCADE;\nEXIT\n`); },
    exec(sql) { return dockerAsync(this.container, ORA('snip'), `SET SQLBLANKLINES ON\nSET DEFINE OFF\n${sql}\n/\nSHOW ERRORS\nEXIT\n`); },
    errors: (out) => [...out.matchAll(/((?:ORA|PLS|SP2)-\d+): ([^\n]*)/g)].map((m) => ({ code: m[1], message: m[2] })),
    isSyntax: (e) => ['ORA-00900', 'ORA-00902', 'ORA-00905', 'ORA-00906', 'ORA-00907', 'ORA-00908', 'ORA-00909', 'ORA-00911', 'ORA-00917', 'ORA-00920', 'ORA-00921', 'ORA-00923', 'ORA-00928', 'ORA-00933', 'ORA-00934', 'ORA-00935', 'ORA-00936', 'ORA-00937', 'ORA-00938', 'ORA-00939', 'ORA-00977', 'ORA-00979', 'ORA-00987', 'ORA-00998', 'ORA-01747', 'ORA-01756', 'ORA-02253', 'ORA-30483', 'PLS-00103', 'PLS-00113', 'SP2-0734'].includes(e.code),
    filler: (body) => (/\bBEGIN\b|\bLOOP\b/i.test(body) ? 'NULL;' : 'SELECT 1 FROM DUAL;'),
  },
];

/** Snippets that must not run on a shared sample server, or that are clauses/fragments rather than statements. */
const SKIP = new Set(['kill', 'users', 'backup', 'restore', 'nodetool', 'join', 'case', 'daterng', 'ret', 'gs', 'unnest', 'jsonb', 'jsonbagg', 'multiif', 'cur', 'loop', 'forn', 'whil', 'ifx', 'raise', 'raisex', 'putl', 'exc', 'sp', 'while', 'tx', 'txx', 'sav', 'trytx']);
/** …except where the same prefix is a whole statement. */
const KEEP: Record<string, Dialect[]> = { cur: ['tsql', 'mysql'], while: ['tsql'], ifx: ['tsql'], tx: ['tsql', 'pgsql', 'mysql', 'sqlite'], raise: ['tsql'], txx: ['mysql'], trytx: ['tsql'], sav: ['tsql'] };

function skipped(d: Dialect, prefix: string): boolean {
  return SKIP.has(prefix) && !(KEEP[prefix] ?? []).includes(d);
}

/** The body as Rowlit would insert it, with $0 standing in a statement of its own (so empty blocks stay valid). */
function expand(server: Server, s: SnippetDef): string {
  const body = s.body.replace(/(^|\n)([ \t]*)\$0/g, (_m, a: string, b: string) => `${a}${b}${server.filler(s.body)}`);
  return snippetPreview(body);
}

function batchesOf(dialect: Dialect, sql: string): string[] {
  const intel = createIntel(dialect);
  intel.setDocument('x', sql);
  return intel.batchesFor('x').map((b) => b.sql);
}

async function pool<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

describe.skipIf(!LIVE)('built-in snippets against the Docker sample servers', () => {
  for (const server of SERVERS.filter((x) => !ONLY || x.dialect === ONLY || x.container.includes(ONLY))) {
    describe.skipIf(!LIVE || !running(server.container))(`${server.dialect} on ${server.name}`, () => {
      let list: readonly SnippetDef[] = [];
      beforeAll(async () => {
        await ensureDialect(server.dialect);
        list = await ensureBuiltins(server.dialect);
        server.setup();
      }, 180_000);
      afterAll(() => server.teardown(), 180_000);

      it('runs the read-only snippets as inserted and finds no syntax errors in the others', async () => {
        const problems: string[] = [];
        const notes: string[] = [];
        let ran = 0, probed = 0;
        await pool(list.filter((s) => !skipped(server.dialect, s.prefix) && !server.skip?.includes(s.prefix)), async (s) => {
          const all = batchesOf(server.dialect, expand(server, s)).filter((b) => b.trim());
          for (const sql of server.joiner === undefined ? all : all.length ? [all.join(server.joiner)] : []) {
            const errs = server.errors(await server.exec(sql));
            if (s.run) {
              ran++;
              for (const e of errs) {
                if (!server.lenientRun || server.isSyntax(e)) problems.push(`RUN ${s.prefix}: ${e.code} ${e.message}`);
                else notes.push(`${s.prefix}: ${e.code} ${e.message}`);
              }
            } else {
              probed++;
              for (const e of errs) {
                if (server.isSyntax(e)) problems.push(`SYNTAX ${s.prefix}: ${e.code} ${e.message}`);
                else notes.push(`${s.prefix}: ${e.code} ${e.message}`);
              }
            }
          }
        });
        console.log(`${server.name}: ${ran} read-only batches ran, ${probed} batches probed; ${notes.length} semantic errors expected`);
        if (process.env.SNIPPETS_LIVE_VERBOSE) console.log(notes.sort().join('\n'));
        expect(problems.sort()).toEqual([]);
      }, 900_000);
    });
  }
});

it.skipIf(LIVE)('live checks are opt-in (SNIPPETS_LIVE=1)', () => {
  expect(LIVE).toBe(false);
});
