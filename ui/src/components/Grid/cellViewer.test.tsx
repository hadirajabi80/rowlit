// The value viewer as an editor: modes, edit/apply into the pending buffer, image preview, files.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { bytesToBase64 } from '../../lib/format';
import { setPlatform, type Platform } from '../../platform';
import { useEdits } from '../../store/edits';
import { CellViewer } from './CellViewer';
import { viewerCanWrite } from './editability';
import { setCellFromViewer } from './viewerWrite';

const col = (name: string, kind: ColumnKind, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 't', schema: 'main', isKey: false, ...extra,
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_B64 = bytesToBase64(PNG);

function view(column: ColumnInfo, value: CellValue, extra: Partial<Parameters<typeof CellViewer>[0]> = {}) {
  const onApply = vi.fn();
  const utils = render(
    <CellViewer executionId={null} resultSetId={0} sourceRow={0} col={0} column={column} value={value} onClose={() => {}} onApply={onApply} {...extra} />,
  );
  return { onApply, ...utils };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => setPlatform(null));

describe('CellViewer modes', () => {
  it('JSON text opens in JSON mode, pretty printed; the pills switch the view', () => {
    view(col('profile', 'json'), '{"a":1,"b":[1,2]}', { onApply: undefined });
    const pre = () => screen.getByLabelText('Value viewer').querySelector('pre.cell-viewer-text')!;
    expect(screen.getByRole('button', { name: 'JSON' }).getAttribute('aria-pressed')).toBe('true');
    expect(pre().textContent).toContain('\n  "a": 1');
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    expect(pre().textContent).toBe('{"a":1,"b":[1,2]}');
    fireEvent.click(screen.getByRole('button', { name: 'Hex' }));
    expect(pre().className).toContain('lang-hex');
    expect(pre().textContent).toContain('7B 22 61 22');
  });

  it('a binary value with PNG bytes opens as an image from a data URL', () => {
    view(col('thumbnail', 'binary'), { $bin: PNG_B64, len: PNG.length }, { onApply: undefined });
    const img = screen.getByRole('img', { name: 'thumbnail' }) as HTMLImageElement;
    expect(img.src).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(screen.getByText(/PNG image/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hex' }));
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('a partial binary value is fetched whole before the image is drawn', async () => {
    const cell = vi.spyOn(api, 'cell').mockResolvedValue({ kind: 'binary', value: PNG_B64, len: PNG.length });
    view(col('thumbnail', 'binary'), { $bin: bytesToBase64(PNG.subarray(0, 8)), len: PNG.length }, { executionId: 'x1', onApply: undefined });
    expect(await screen.findByRole('img', { name: 'thumbnail' })).toBeTruthy();
    expect(cell).toHaveBeenCalledWith('x1', 0, 0, 0);
  });
});

describe('CellViewer editing', () => {
  it('Edit opens the editor on the text; Apply hands the new value to onApply', () => {
    const { onApply } = view(col('notes', 'string'), 'hello');
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    const ta = screen.getByLabelText('Edit notes') as HTMLTextAreaElement;
    expect(ta.value).toBe('hello');
    const apply = screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true); // nothing changed
    fireEvent.change(ta, { target: { value: 'hello world' } });
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith('hello world');
    expect(screen.queryByLabelText('Edit notes')).toBeNull();
  });

  it('invalid JSON in a json column blocks Apply and says why', () => {
    const { onApply } = view(col('profile', 'json'), '{"a":1}');
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    fireEvent.change(screen.getByLabelText('Edit profile'), { target: { value: '{"a":' } });
    expect((screen.getByRole('button', { name: /Apply/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/^Invalid JSON/);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Edit profile'), { target: { value: '{"a":2}' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith('{"a":2}');
  });

  it('Format indents JSON and XML drafts', () => {
    view(col('spec', 'xml'), '<a><b>1</b></a>');
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    // the viewer shows the pretty text, so that is what the editor starts with
    expect((screen.getByLabelText('Edit spec') as HTMLTextAreaElement).value).toBe('<a>\n  <b>1</b>\n</a>');
    fireEvent.change(screen.getByLabelText('Edit spec'), { target: { value: '<a><b>2</b></a>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect((screen.getByLabelText('Edit spec') as HTMLTextAreaElement).value).toBe('<a>\n  <b>2</b>\n</a>');
  });

  it('Set NULL applies null on a nullable column; Cancel leaves the cell alone', () => {
    const { onApply } = view(col('notes', 'string'), 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set NULL' }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('a non-text binary value cannot be edited as text', () => {
    view(col('thumbnail', 'binary'), { $bin: PNG_B64, len: PNG.length });
    expect((screen.getByRole('button', { name: 'Edit value' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('read-only cells have no Edit button', () => {
    view(col('notes', 'string'), 'x', { onApply: undefined });
    expect(screen.queryByRole('button', { name: 'Edit value' })).toBeNull();
  });

  it('a truncated text is fetched whole before editing; too large is refused', async () => {
    vi.spyOn(api, 'cell').mockResolvedValue({ kind: 'string', value: 'the whole text', len: 14 });
    view(col('notes', 'string'), { $trunc: 'the wh', len: 14 }, { executionId: 'x1' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    await waitFor(() => expect((screen.getByLabelText('Edit notes') as HTMLTextAreaElement).value).toBe('the whole text'));
  });

  it('refuses values over the edit limit', () => {
    view(col('notes', 'string'), { $trunc: 'abc', len: 9 * 1024 * 1024 }, { executionId: 'x1' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit value' }));
    expect(screen.getByRole('alert').textContent).toMatch(/too large to edit/);
    expect(screen.queryByLabelText('Edit notes')).toBeNull();
  });

  it('a request (Shift+Enter) opens the editor once and is reported done', () => {
    const done = vi.fn();
    view(col('notes', 'string'), 'abc', { request: { kind: 'edit', nonce: 1 }, onRequestDone: done });
    expect(screen.getByLabelText('Edit notes')).toBeTruthy();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('shows the Edited badge for a pending value', () => {
    view(col('notes', 'string'), 'x', { edited: true });
    expect(screen.getByText('Edited')).toBeTruthy();
  });
});

describe('CellViewer files', () => {
  const file = (bytes: Uint8Array | string, name: string) => new File([bytes as BlobPart], name);

  it('loading a file into a binary column applies its bytes as base64', async () => {
    const { onApply } = view(col('thumbnail', 'binary'), null);
    fireEvent.change(screen.getByLabelText('Value file'), { target: { files: [file(PNG, 'a.png')] } });
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ $bin: PNG_B64, len: PNG.length }));
  });

  it('loading a text file puts it into the editor; Apply decides', async () => {
    const { onApply } = view(col('notes', 'string'), 'old');
    fireEvent.change(screen.getByLabelText('Value file'), { target: { files: [file('from file', 'n.txt')] } });
    expect(((await screen.findByLabelText('Edit notes')) as HTMLTextAreaElement).value).toBe('from file');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    expect(onApply).toHaveBeenCalledWith('from file');
  });

  it('a binary file is refused for a text column', async () => {
    const { onApply } = view(col('notes', 'string'), 'old');
    fireEvent.change(screen.getByLabelText('Value file'), { target: { files: [file(new Uint8Array([1, 0, 2]), 'x.bin')] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a text file/);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a file over the limit is refused', async () => {
    const { onApply } = view(col('thumbnail', 'binary'), null);
    const big = new File([new Uint8Array(1)], 'big.bin');
    Object.defineProperty(big, 'size', { value: 17 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Value file'), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/the limit is 16\.0 MB/);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Save to file writes the bytes of an image through the platform', async () => {
    const saveFile = vi.fn().mockResolvedValue('C:\\x\\thumbnail.png');
    setPlatform({ saveFile } as unknown as Platform);
    view(col('thumbnail', 'binary'), { $bin: PNG_B64, len: PNG.length });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to file' }));
    });
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    const arg = saveFile.mock.calls[0][0] as { suggestedName: string; mime: string; content: Blob };
    expect(arg.suggestedName).toBe('thumbnail.png');
    expect(arg.mime).toBe('image/png');
    expect(arg.content.size).toBe(PNG.length);
  });

  it('Save to file writes JSON text as .json', async () => {
    const saveFile = vi.fn().mockResolvedValue('p');
    setPlatform({ saveFile } as unknown as Platform);
    view(col('profile', 'json'), '{"a":1}', { onApply: undefined });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to file' }));
    });
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect((saveFile.mock.calls[0][0] as { suggestedName: string }).suggestedName).toBe('profile.json');
  });
});

describe('writing from the viewer', () => {
  const K = 'viewer-grid';
  beforeEach(() => useEdits.getState().reset(K));

  it('setCellFromViewer lands in the pending buffer like a typed edit, and Discard undoes it', () => {
    setCellFromViewer(K, { src: 3 }, 2, '{"a":2}', '{"a":1}');
    expect(useEdits.getState().get(K).pending.updates[3]).toEqual({ 2: '{"a":2}' });
    setCellFromViewer(K, { src: 3 }, 2, '{"a":1}', '{"a":1}'); // back to the original: the edit drops
    expect(useEdits.getState().get(K).pending.updates[3]).toBeUndefined();
    setCellFromViewer(K, { src: 4 }, 1, { $bin: 'AQID', len: 3 }, null);
    expect(useEdits.getState().get(K).pending.updates[4][1]).toEqual({ $bin: 'AQID', len: 3 });
    useEdits.getState().revertAll(K);
    expect(useEdits.getState().get(K).pending.updates).toEqual({});
  });

  it('binary columns are writable only through the viewer', () => {
    const e = { editable: true, editableColumns: new Set([0]), binaryColumns: new Set([1]), updateLocked: new Set([1]) };
    expect(viewerCanWrite(e, 0, false)).toBe(true);
    expect(viewerCanWrite(e, 1, false)).toBe(false); // locked on an existing row (ClickHouse key)
    expect(viewerCanWrite(e, 1, true)).toBe(true); // but fine on a new row
    expect(viewerCanWrite(e, 2, false)).toBe(false);
    expect(viewerCanWrite({ ...e, editable: false }, 0, false)).toBe(false);
  });
});
