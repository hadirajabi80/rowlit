// Window-wide drop target: while files are dragged over the window a translucent overlay says where a drop would go
// ("Drop to import into public.orders"); the drop opens an Import Wizard per data file, or a console for a .sql file.
// A drop on something that handles it itself (an explorer node, the wizard's drop zone) keeps working: those call
// preventDefault, and this layer only acts on drops nobody handled. The overlay never takes pointer events.
import { FileCode, FileJson, FileSpreadsheet, FileText, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { hasFiles } from '../ImportWizard/fileDrop';
import { dropDetail, dropHeadline, handleWindowDrop, resolveDropTarget, type DropTarget } from './dropTarget';
import './dropOverlay.css';

/** dragover repeats while the pointer is over the window; silence this long means the drag ended without an event. */
export const DRAG_IDLE_MS = 1200;

/** Code editors handle (or swallow) drops themselves: the window takes the file drops over them. */
const OWN_DROP = '.monaco-editor';

interface Shown {
  target: DropTarget;
  count: number;
  /** The pointer is over something that takes the drop itself. */
  onNode: boolean;
}

export function DropOverlay() {
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    let depth = 0;
    let dismissed = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let current: DropTarget | null = null;

    const hide = () => {
      depth = 0;
      current = null;
      clearTimeout(idle);
      setShown(null);
    };
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        dismissed = false;
        hide();
      }, DRAG_IDLE_MS);
    };
    const show = (e: DragEvent, onNode: boolean) => {
      if (dismissed) return;
      if (!current) current = resolveDropTarget();
      const count = e.dataTransfer?.items?.length ?? 0;
      setShown((prev) => (prev && prev.onNode === onNode && prev.count === count && prev.target === current ? prev : { target: current as DropTarget, count, onNode }));
      arm();
    };
    const endSession = () => {
      dismissed = false;
      hide();
    };

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth++;
      show(e, false);
    };
    // Over a code editor the window takes the drag before the editor sees it.
    const onOverCapture = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer) || !(e.target as Element | null)?.closest?.(OWN_DROP)) return;
      e.stopPropagation();
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      show(e, false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      const claimed = e.defaultPrevented; // an explorer node or the wizard's drop zone accepts the drop itself
      if (!claimed) e.preventDefault(); // nobody else does: the window does
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      show(e, claimed);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) endSession();
    };
    const drop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const target = shownRef.current?.target ?? resolveDropTarget();
      const wasDismissed = dismissed;
      endSession();
      e.preventDefault(); // never let the browser navigate to the dropped file
      if (!wasDismissed && files.length > 0) handleWindowDrop(files, target);
    };
    const onDropCapture = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer) || !(e.target as Element | null)?.closest?.(OWN_DROP)) return;
      e.stopPropagation();
      drop(e);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      if (e.defaultPrevented) {
        endSession(); // an explorer node or the wizard's drop zone took it
        return;
      }
      drop(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !shownRef.current) return;
      // Hidden for the rest of this drag: the enter / leave counter keeps running and the next drag starts afresh.
      dismissed = true;
      current = null;
      clearTimeout(idle);
      setShown(null);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOverCapture, true);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropCapture, true);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', endSession);
    window.addEventListener('blur', endSession);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOverCapture, true);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropCapture, true);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', endSession);
      window.removeEventListener('blur', endSession);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  if (!shown) return null;
  const { target, count, onNode } = shown;
  const files = count > 1 ? `${count} files` : 'the file';
  return (
    <div className={`drop-overlay${onNode ? ' node' : ''}`} role="status" aria-live="polite" data-testid="drop-overlay">
      <div className="drop-frame" aria-hidden="true" />
      <div className="drop-card">
        <span className="drop-icon" aria-hidden="true"><Upload size={28} /></span>
        <p className="drop-title">{onNode ? 'Release to import into this item' : dropHeadline(target)}</p>
        <p className="drop-detail">
          {onNode ? `Drop anywhere else to import into ${target.kind === 'ask' ? 'a database of your choice' : target.label}.` : dropDetail(target)}
        </p>
        <ul className="drop-types" aria-label="Files you can drop">
          <li><FileText size={14} aria-hidden="true" /> CSV · TSV · TXT</li>
          <li><FileSpreadsheet size={14} aria-hidden="true" /> XLSX</li>
          <li><FileJson size={14} aria-hidden="true" /> JSON · NDJSON</li>
          <li><FileCode size={14} aria-hidden="true" /> SQL opens in a console</li>
        </ul>
        <p className="drop-foot">Press Esc to cancel · {count > 1 ? `one wizard per file (up to 5)` : `import ${files}`}</p>
      </div>
    </div>
  );
}
