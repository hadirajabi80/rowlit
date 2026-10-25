// Dropping a data file on an explorer node opens the Import Wizard: on a table to load into it, on a schema / database /
// connection to create a new table. `importDropHandlers(target)` returns drag handlers to spread on the row element
// (empty for nodes that cannot take an import).
import type { DragEvent } from 'react';
import type { CommandTarget } from '../../commands/types';
import { getPlatform } from '../../platform';
import { toast } from '../../store/ui';
import { isImportable } from './files';
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

/** Handles a drop of files for an import context; returns true when the wizard was opened. */
export function handleImportDrop(files: FileList | readonly File[] | null | undefined, ctx: ImportContext): boolean {
  const file = files?.[0];
  if (!file) return false;
  if (!isImportable(file.name)) {
    toast('info', `Cannot import "${file.name}"`, 'Supported files: CSV, TSV, TXT, XLSX, JSON, NDJSON.');
    return false;
  }
  const path = pathOfFile(file);
  if (!path) toast('info', 'Choose the file in the wizard', 'This browser does not tell the location of dropped files.');
  openImportWizard(ctx, path);
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
