// Dropping a data file on an explorer node opens the Import Wizard: on a table to load into it, on a schema / database /
// connection to create a new table. `importDropHandlers(target)` returns drag handlers to spread on the row element
// (empty for nodes that cannot take an import).
import type { DragEvent } from 'react';
import type { CommandTarget } from '../../commands/types';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { isImportable, isLegacyExcel } from './files';
import { canImportInto, openImportWizard, type ImportContext } from './open';

/** Where a drop on this explorer node would import, null when the node cannot take one. */
export function dropContext(target: CommandTarget | null): ImportContext | null {
  if (!target || !('connectionId' in target) || !canImportInto(target.connectionId)) return null;
  switch (target.kind) {
    case 'object':
      return target.ref.type === 'table'
        ? { connectionId: target.connectionId, database: target.database, schema: target.ref.schema, table: target.ref.name }
        : null;
    case 'container':
      return target.queries ? null : { connectionId: target.connectionId, database: target.database, schema: target.schema, table: null };
    case 'connection':
      return { connectionId: target.connectionId, database: null, schema: null, table: null };
    default:
      return null;
  }
}

export function hasFiles(dt: DataTransfer | null | undefined): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}

/** The path of a dropped file: the desktop bridge resolves it, the browser has none (null). */
export function pathOfFile(file: File): string | null {
  const viaBridge = getPlatform().getFilePath?.(file);
  if (viaBridge) return viaBridge;
  const legacy = (file as File & { path?: string }).path;
  return legacy || null;
}

/** Wizards opened by one drop (the rest is reported, never silently dropped). */
export const MAX_DROP_WIZARDS = 5;

export const SUPPORTED_FILES_TEXT = 'Supported files: CSV, TSV, TXT, XLSX, JSON, NDJSON.';

/** Tells the user why files cannot be imported (an .xls gets its own advice). */
export function toastUnsupported(names: readonly string[]): void {
  if (names.length === 0) return;
  if (names.length === 1) {
    toast('info', `Unsupported file type: "${names[0]}"`, isLegacyExcel(names[0])
      ? 'Excel 97-2003 (.xls) files are not supported. Save the workbook as .xlsx first.'
      : SUPPORTED_FILES_TEXT);
    return;
  }
  toast('info', `Unsupported file types (${names.length} files)`, `${names.join(', ')}. ${SUPPORTED_FILES_TEXT}`);
}

/**
 * Opens one wizard per dropped data file (at most MAX_DROP_WIZARDS) for an import context; returns true when at least
 * one opened. Files of other types are reported in one toast.
 */
export function handleImportDrop(files: FileList | readonly File[] | null | undefined, ctx: ImportContext): boolean {
  const list = Array.from(files ?? []);
  if (list.length === 0) return false;
  toastUnsupported(list.filter((f) => !isImportable(f.name)).map((f) => f.name));
  const ok = list.filter((f) => isImportable(f.name));
  if (ok.length === 0) return false;
  if (ok.length > MAX_DROP_WIZARDS) toast('info', `Opened ${MAX_DROP_WIZARDS} of ${ok.length} files`, 'Drop the remaining files again to import them.');
  let unknownPath = false;
  for (const file of ok.slice(0, MAX_DROP_WIZARDS)) {
    const path = pathOfFile(file);
    if (!path) unknownPath = true;
    openImportWizard(ctx, path);
  }
  if (unknownPath) toast('info', 'Choose the file in the wizard', 'This browser does not tell the location of dropped files.');
  return true;
}

export interface ImportDropHandlers {
  onDragOver?: (e: DragEvent<HTMLElement>) => void;
  onDrop?: (e: DragEvent<HTMLElement>) => void;
}

export function importDropHandlers(target: CommandTarget | null): ImportDropHandlers {
  const ctx = dropContext(target);
  if (!ctx) return {};
  return {
    onDragOver: (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDrop: (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      handleImportDrop(e.dataTransfer.files, ctx);
    },
  };
}
