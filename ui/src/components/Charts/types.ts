// Charts from query results: the settings a chart is built from and the data shapes between the layers
// (values -> aggregate -> scene -> svg). Everything here is plain data so the pipeline is unit-testable without a DOM.
import type { CellValue, ColumnInfo } from '../../api/types';

export type ChartType = 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'scatter' | 'pie' | 'donut' | 'kpi';
export type Agg = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';
/** How a date/time X is grouped. `auto` picks a unit from the time span; `none` keeps every timestamp. */
export type Bucket = 'auto' | 'none' | 'hour' | 'day' | 'week' | 'month' | 'year';
export type SortMode = 'none' | 'x-asc' | 'x-desc' | 'y-asc' | 'y-desc';

export interface SeriesSpec {
  /** Column name (names, not ordinals, so settings survive a re-ordered select list). */
  column: string;
  agg: Agg;
}

export interface ChartSpec {
  type: ChartType;
  x: string | null;
  y: SeriesSpec[];
  group: string | null;
  bucket: Bucket;
  sort: SortMode;
  /** Keep the N largest categories (0 = all). */
  topN: number;
  labels: boolean;
  legend: boolean;
  log: boolean;
}

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'hbar', label: 'Horizontal bar' },
  { id: 'stacked', label: 'Stacked bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'pie', label: 'Pie' },
  { id: 'donut', label: 'Donut' },
  { id: 'kpi', label: 'KPI number' },
];

export const AGGS: { id: Agg; label: string }[] = [
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'count', label: 'Count' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
  { id: 'none', label: 'Raw' },
];

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'none', label: 'None' },
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

export const SORTS: { id: SortMode; label: string }[] = [
  { id: 'none', label: 'Result order' },
  { id: 'x-asc', label: 'X ascending' },
  { id: 'x-desc', label: 'X descending' },
  { id: 'y-desc', label: 'Value descending' },
  { id: 'y-asc', label: 'Value ascending' },
];

/** What a column can be used as. */
export type ColumnClass = 'number' | 'time' | 'category' | 'other';

export type XKind = 'category' | 'time' | 'number';

export interface Category {
  /** Stable key (time: bucket start in ms as text). */
  key: string;
  label: string;
  /** Position on a continuous axis (ms for time, the number itself for number); the index for category. */
  pos: number;
}

export interface DataSeries {
  name: string;
  /** One value per category; null = no data. */
  values: (number | null)[];
  /** Column the series is built from (KPI labels, tooltips). */
  column: string;
  agg: Agg;
}

export interface ChartData {
  xKind: XKind;
  xName: string | null;
  categories: Category[];
  series: DataSeries[];
  /** Rows that fed the chart (rows whose X could not be read are skipped). */
  usedRows: number;
  skippedRows: number;
  /** Categories dropped by Top-N (pie: folded into "Other"). */
  droppedCategories: number;
  /** Group values dropped because there were too many series. */
  droppedSeries: number;
  /** The resolved bucket unit when X is a time column ('none' otherwise). */
  bucket: Exclude<Bucket, 'auto'>;
}

export interface RowSource {
  readonly length: number;
  get(i: number): CellValue[] | undefined;
}

export type { CellValue, ColumnInfo };
