// File helpers used by IPC and workspace persistence. Electron-free (unit tested in plain Node).
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Atomic write: temp file in the same directory, fsync, then rename over the target.
 * On Windows a rename can briefly fail with EPERM/EBUSY/EACCES while an indexer or antivirus
 * holds the target open, so the rename is retried for ~1 s.
 */
export async function atomicWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(target);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fh = await fs.promises.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmp, target);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt < 10 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await sleep(100);
        continue;
      }
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }
}

/** Reads a text file, honouring UTF-8 and UTF-16 LE/BE BOMs (SSMS saves .sql files as UTF-16 LE). */
export async function readTextFileDecoded(file: string, maxBytes: number): Promise<string> {
  const st = await fs.promises.stat(file);
  if (!st.isFile()) throw new Error(`Not a file: ${file}`);
  if (st.size > maxBytes) throw new Error(`File is too large to open (${st.size} bytes; limit ${maxBytes})`);
  const buf = await fs.promises.readFile(file);
  return decodeText(buf);
}

/**
 * The first `maxBytes` bytes of a text file, decoded like `readTextFileDecoded`, without
 * reading the rest: a preview of a file that may be gigabytes (the engine reads it by path). A multi-byte character cut at the
 * end is dropped; `size` is the whole file.
 */
export async function readTextFileHead(file: string, maxBytes: number): Promise<{ content: string; size: number; truncated: boolean }> {
  const st = await fs.promises.stat(file);
  if (!st.isFile()) throw new Error(`Not a file: ${file}`);
  const want = Math.min(st.size, maxBytes);
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buf, 0, want, 0);
    const truncated = st.size > bytesRead;
    // UTF-16 reads whole code units; UTF-8 may end inside a character, which decodes to U+FFFD: cut that off
    const head = bytesRead % 2 === 1 && buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(0, bytesRead - 1) : buf.subarray(0, bytesRead);
    let content = decodeText(head);
    if (truncated) content = content.replace(/�$/, '');
    return { content, size: st.size, truncated };
  } finally {
    await handle.close();
  }
}

export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

/** Serializes async operations (e.g. workspace saves) so that writes never interleave. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.tail.then(op, op);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Append-only log file with a single-generation size rotation (file -> file.1). */
export class RotatingLog {
  private stream: fs.WriteStream | null = null;
  constructor(readonly file: string, private readonly maxBytes = 5 * 1024 * 1024) {}

  private open(): fs.WriteStream {
    if (this.stream) return this.stream;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      if (fs.statSync(this.file).size > this.maxBytes) fs.renameSync(this.file, `${this.file}.1`);
    } catch {
      /* no file yet */
    }
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    this.stream.on('error', () => { this.stream = null; });
    return this.stream;
  }

  write(source: string, line: string): void {
    try {
      this.open().write(`${new Date().toISOString()} [${source}] ${line}\n`);
    } catch {
      /* logging must never take the app down */
    }
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
