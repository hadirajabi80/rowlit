// Renders rows the grid holds into the content of an export file (the client-side scopes: loaded rows and the
// selection). Full values of truncated cells are fetched first (logic-12); SQL INSERT is refused while values are still
// truncated. The text formats follow the same options the engine's writers do (header, delimiter, NULL text, date
// pattern, byte order mark, SQL table / dialect), so every scope gives the same file.
import type { CellValue, ColumnInfo, Dialect, ExportFormat } from '../../api/types';
import {
  defaultTableName, resolvePartialValues, toDelimited, toJson, toMarkdown, toSqlInsert, truncationWarning,
  type CellFetcher, type CellLocator,
} from '../../lib/serialize';
import { applyDatePattern } from './dateFormat';
import { nullTextOf, supportsDateFormat } from './model';
import type { ExportSettings } from './types';

export const UTF8_BOM = String.fromCharCode(0xfeff);

export type Rendered =
  | { ok: true; content: string | Blob; warning: string | null }
  | { ok: false; message: string };

export interface RenderInput {
  format: ExportFormat;
  columns: ColumnInfo[];
  rows: CellValue[][];
  settings: ExportSettings;
  /** Dialect of the connection (SQL INSERT quoting unless the settings choose another). */
  dialect: Dialect;
  /** Table name used by SQL INSERT when the settings leave it empty. */
  defaultTable: string;
  sheetName?: string | null;
  locate?: ((row: number, col: number) => CellLocator | null) | null;
  fetch?: CellFetcher | null;
}

export async function renderClientFile(i: RenderInput): Promise<Rendered> {
  const { format, columns, settings: s } = i;
  const resolved = await resolvePartialValues(i.rows, { locate: i.locate, fetch: i.fetch });
  const warnings: string[] = [];
  if (resolved.unresolved > 0) {
    if (format === 'sql-insert') return { ok: false, message: truncationWarning(resolved.unresolved) };
    warnings.push(truncationWarning(resolved.unresolved));
  }

  if (format === 'xlsx') {
    const { toXlsx } = await import('../Grid/xlsx');
    const x = await toXlsx(columns, resolved.rows, { sheetName: s.sheetName.trim() || i.sheetName });
    if (x.dropped > 0) warnings.push(`${x.dropped.toLocaleString('en-US')} rows exceed Excel's row limit and were left out.`);
    return { ok: true, content: new Blob([x.bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), warning: warnings.join(' ') || null };
  }

  const rows = supportsDateFormat(format) ? applyDatePattern(columns, resolved.rows, s.dateFormat) : resolved.rows;
  const nullText = nullTextOf(s);
  let text: string;
  switch (format) {
    case 'csv': text = toDelimited(columns, rows, s.delimiter || ',', { header: s.header, nullText }); break;
    case 'tsv': text = toDelimited(columns, rows, '\t', { header: s.header, nullText }).replace(/\n/g, '\r\n'); break;
    case 'json': text = toJson(columns, rows); break;
    case 'markdown': text = toMarkdown(columns, rows, { nullText }); break;
    default: {
      const dialect = s.sqlDialect ?? i.dialect;
      text = toSqlInsert(columns, rows, { dialect, tableName: s.tableName.trim() || i.defaultTable || defaultTableName(columns, dialect) });
    }
  }
  // every record / statement ends with a line break, like the engine's files
  if (text && format !== 'json' && !text.endsWith('\n')) text += format === 'markdown' ? '\n' : '\r\n';
  return { ok: true, content: (s.bom ? UTF8_BOM : '') + text, warning: warnings.join(' ') || null };
}
