// Step 1: choose the file (drop zone, native dialog, a typed path or a recent file) and, when the wizard was opened
// without a connection, where it should go.
import { FolderOpen, History, LoaderCircle, Upload, X } from 'lucide-react';
import { useState, type DragEvent, type Ref } from 'react';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { hasFiles, pathOfFile, toastUnsupported } from './fileDrop';
import { FORMAT_BADGE, FORMAT_LABEL, IMPORT_FILE_FILTERS, cleanPastedPath, fileNameOf, formatOfPath, isImportable } from './files';
import { formatBytes, formatCount } from './model';
import { Callout, ConnectionPicker, Field, FileTypeIcon, StepHeader } from './parts';
import { forgetRecent, readRecent, type RecentFile } from './recent';
import type { Wizard } from './useWizard';

const TYPE_CHIPS = ['CSV', 'TSV', 'XLSX', 'JSON', 'NDJSON'];

function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i > 0 ? path.slice(0, i) : '';
}

export function SourceStep({ w, headingRef }: { w: Wizard; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = w;
  const platform = getPlatform();
  const [over, setOver] = useState(false);
  // The card replaces the drop zone once a file was chosen on purpose (browse / drop / recent) or the engine read the typed path.
  const [committed, setCommitted] = useState(() => s.path.trim().length > 0);
  const [recent, setRecent] = useState<RecentFile[]>(() => readRecent());
  // Opened without a connection (a file dropped where none is in use): this step asks, and keeps asking so the choice can change.
  const [askConnection] = useState(() => !w.cid);

  const path = s.path.trim();
  const p = s.preview;
  const setPath = (next: string, commit = false) => {
    if (commit) setCommitted(true);
    patch({ path: next, userOpts: {}, step: 0, previewPage: 0 });
  };

  const browse = async () => {
    const chosen = await platform.showOpenDialog({ title: 'Choose the file to import', filters: IMPORT_FILE_FILTERS });
    if (chosen) setPath(chosen, true);
  };

  const change = () => {
    if (platform.hasFileSystem) void browse();
    else {
      setCommitted(false);
      setPath('');
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isImportable(file.name)) {
      toastUnsupported([file.name]);
      return;
    }
    const dropped = pathOfFile(file);
    if (dropped) setPath(dropped, true);
    else toast('info', 'Type the path of the file', 'This browser does not tell the location of dropped files.');
  };

  const showCard = path.length > 0 && (committed || (!!p && p.path === path));
  const format = p?.options.format ?? (path ? formatOfPath(path) : null);

  return (
    <section className="iw-step" aria-labelledby="iw-src-title">
      <StepHeader
        ref={headingRef}
        id="iw-src-title"
        title="Choose the file to import"
        help="CSV, TSV, Excel (.xlsx), JSON and NDJSON files. The Rowlit engine reads the file on this computer and streams it, so large files are fine."
      />

      {showCard ? (
        <div className="iw-filecard" data-testid="iw-filecard">
          <span className={`iw-fileicon iw-fileicon-${format ?? 'csv'}`}><FileTypeIcon path={path} size={24} /></span>
          <div className="iw-filemain">
            <div className="iw-filename" dir="auto">{fileNameOf(path)}</div>
            <div className="iw-filepath" dir="ltr" title={path}>{folderOf(path) || path}</div>
            <div className="iw-filemeta">
              {format && <span className="iw-pill iw-pill-accent">{FORMAT_BADGE[format]}</span>}
              {p && <span className="iw-pill">{formatBytes(p.fileSize)}</span>}
              {p?.options.encoding && (format === 'csv' || format === 'tsv' || format === 'ndjson' || format === 'json') && <span className="iw-pill">{p.options.encoding}</span>}
              {p && <span className="iw-pill">{formatCount(p.columns.length)} {p.columns.length === 1 ? 'column' : 'columns'}</span>}
              {format && !p && <span className="iw-pill">{FORMAT_LABEL[format]}</span>}
            </div>
            {s.previewLoading && !s.previewError && (
              <div className="iw-filestatus" role="status"><LoaderCircle size={13} className="spin" aria-hidden="true" /> Reading the file…</div>
            )}
          </div>
          <button type="button" className="btn" onClick={change}>Change…</button>
        </div>
      ) : (
        <div
          className={`iw-drop${over ? ' over' : ''}`}
          data-testid="iw-dropzone"
          onDragOver={(e) => {
            if (!hasFiles(e.dataTransfer)) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={onDrop}
        >
          <span className="iw-drop-icon"><Upload size={26} aria-hidden="true" /></span>
          <div className="iw-drop-title">Drop a file here</div>
          <div className="iw-drop-sub">{platform.hasFileSystem ? 'or choose one from your computer' : 'or paste the full path of the file below'}</div>
          {platform.hasFileSystem && (
            <button type="button" className="btn btn-primary" data-primary-focus onClick={() => void browse()}>
              <FolderOpen size={14} aria-hidden="true" /> Browse…
            </button>
          )}
          <ul className="iw-drop-types" aria-label="Supported files">
            {TYPE_CHIPS.map((c) => <li key={c} className="iw-pill">{c}</li>)}
          </ul>
        </div>
      )}

      {s.previewError && <Callout tone="error">{s.previewError}</Callout>}

      <Field label="File path" className="iw-pathfield">
        <input
          className="input"
          aria-label="File path"
          value={s.path}
          placeholder={platform.hasFileSystem ? 'Or paste the path of the file' : 'Paste the full path of the file on this computer'}
          spellCheck={false}
          dir="ltr"
          data-primary-focus={platform.hasFileSystem ? undefined : ''}
          onChange={(e) => setPath(cleanPastedPath(e.target.value))}
        />
      </Field>

      {!showCard && recent.length > 0 && (
        <section className="iw-recent" aria-label="Recent files">
          <h3 className="iw-sub"><History size={13} aria-hidden="true" /> Recent files</h3>
          <ul>
            {recent.map((r) => (
              <li key={r.path}>
                <button type="button" className="iw-recent-item" onClick={() => setPath(r.path, true)} title={r.path}>
                  <FileTypeIcon path={r.path} size={16} />
                  <span className="iw-recent-name" dir="auto">{fileNameOf(r.path)}</span>
                  <span className="iw-recent-dir" dir="ltr">{folderOf(r.path)}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label={`Remove ${fileNameOf(r.path)} from the recent files`}
                  title="Remove from the list"
                  onClick={() => {
                    forgetRecent(r.path);
                    setRecent(readRecent());
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {askConnection && (
        <section className="iw-card" aria-label="Where to import">
          <h3 className="iw-sub">Where should it go?</h3>
          {w.connections.length === 0
            ? <Callout tone="warn">There is no connection to import into. Add a writable relational connection first.</Callout>
            : (
              <div className="iw-row">
                <div className="iw-grow"><ConnectionPicker w={w} /></div>
              </div>
            )}
        </section>
      )}
    </section>
  );
}
