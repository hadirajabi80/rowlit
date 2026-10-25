// File types of the Import Wizard. Tiny and dependency-free: the explorer drop handler and the commands import this
// (the wizard itself and its model are lazy chunks).
import type { SourceFormat } from './types';

const FORMAT_BY_EXTENSION: Record<string, SourceFormat> = {
  csv: 'csv', txt: 'csv', tsv: 'tsv', tab: 'tsv', xlsx: 'xlsx', json: 'json', ndjson: 'ndjson', jsonl: 'ndjson',
};

/** Extensions the wizard accepts (without the dot). */
export const IMPORT_EXTENSIONS: readonly string[] = Object.keys(FORMAT_BY_EXTENSION);

export const IMPORT_FILE_FILTERS = [
  { name: 'Data files', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'json', 'ndjson', 'jsonl'] },
  { name: 'CSV / TSV / text', extensions: ['csv', 'tsv', 'txt'] },
  { name: 'Excel workbook', extensions: ['xlsx'] },
  { name: 'JSON / NDJSON', extensions: ['json', 'ndjson', 'jsonl'] },
];

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The format of a file by its extension, null when the wizard cannot read it. */
export function formatOfPath(path: string): SourceFormat | null {
  return FORMAT_BY_EXTENSION[extensionOf(path)] ?? null;
}

export function isImportable(path: string): boolean {
  return formatOfPath(path) !== null;
}
