// File formats of the exports (Data tab, results pane, export dialog): extension, MIME type and save-dialog name.
import type { ExportFormat } from '../api/types';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const EXPORT_EXT: Record<ExportFormat, string> = { csv: 'csv', tsv: 'tsv', json: 'json', 'sql-insert': 'sql', markdown: 'md', xlsx: 'xlsx' };

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', 'sql-insert': 'application/sql', markdown: 'text/markdown', xlsx: XLSX_MIME,
};

/** Name of the format in a file dialog's filter list. */
export const EXPORT_FILTER_NAME: Record<ExportFormat, string> = {
  csv: 'CSV', tsv: 'TSV', json: 'JSON', 'sql-insert': 'SQL', markdown: 'Markdown', xlsx: 'Excel workbook',
};
