// Step 1: choose the file (native dialog, a typed path, or a drop).
import { FolderOpen, Upload } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { hasFiles, pathOfFile } from './fileDrop';
import { fileNameOf, formatBytes, formatOfPath, IMPORT_FILE_FILTERS, isImportable } from './model';
import type { Wizard } from './useWizard';

const FORMAT_LABEL: Record<string, string> = { csv: 'CSV', tsv: 'TSV', xlsx: 'Excel workbook', json: 'JSON', ndjson: 'NDJSON (one JSON object per line)' };

export function SourceStep({ w }: { w: Wizard }) {
  const { s, patch } = w;
  const platform = getPlatform();
  const [over, setOver] = useState(false);

  const setPath = (path: string) => patch({ path, userOpts: {}, step: 0 });

  const browse = async () => {
    const path = await platform.showOpenDialog({ title: 'Choose the file to import', filters: IMPORT_FILE_FILTERS });
    if (path) setPath(path);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isImportable(file.name)) {
      toast('info', `Cannot import "${file.name}"`, 'Supported files: CSV, TSV, TXT, XLSX, JSON, NDJSON.');
      return;
    }
    const path = pathOfFile(file);
    if (path) setPath(path);
    else toast('info', 'Type the path of the file', 'This browser does not tell the location of dropped files.');
  };

  const format = s.path.trim() ? formatOfPath(s.path.trim()) : null;
  const p = s.preview;

  return (
    <section className="iw-step" aria-labelledby="iw-src-title">
      <h2 id="iw-src-title" className="iw-h">Choose the file to import</h2>
      <p className="iw-hint">CSV, TSV, Excel (.xlsx), JSON and NDJSON files. The file is read by the Rowlit engine on this computer and streamed, so large files are fine.</p>
      <div className="iw-row">
        <label className="iw-field iw-grow">
          <span>File path</span>
          <input
            className="input"
            data-primary-focus
            aria-label="File path"
            value={s.path}
            placeholder={platform.hasFileSystem ? 'Choose a file or paste its path' : 'Paste the full path of the file on this computer'}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
        {platform.hasFileSystem && (
          <button type="button" className="btn iw-browse" onClick={() => void browse()}>
            <FolderOpen size={14} /> Browse…
          </button>
        )}
      </div>
      <div
        className={`iw-drop${over ? ' over' : ''}`}
        data-testid="iw-dropzone"
        onDragOver={(e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Upload size={20} aria-hidden="true" />
        <span>Drop a file here</span>
      </div>
      {s.path.trim() && (
        <dl className="iw-facts" aria-label="File">
          <dt>File</dt>
          <dd dir="auto">{fileNameOf(s.path.trim())}</dd>
          <dt>Format</dt>
          <dd>{FORMAT_LABEL[p?.options.format ?? format ?? ''] ?? 'Unknown (choose the format in the next step)'}</dd>
          {p && (
            <>
              <dt>Size</dt>
              <dd>{formatBytes(p.fileSize)}</dd>
              <dt>Columns</dt>
              <dd>{p.columns.length}</dd>
            </>
          )}
        </dl>
      )}
      {s.previewError && <div className="iw-msg iw-error" role="alert">{s.previewError}</div>}
      {s.previewLoading && !s.previewError && <div className="iw-hint" role="status">Reading the file…</div>}
    </section>
  );
}
