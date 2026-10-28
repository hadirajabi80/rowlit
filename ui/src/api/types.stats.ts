import type { CellValue, QueryParam } from './types';

export interface ColumnStatsRequest {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
  table: string;
  columns?: string[];
  where?: string | null;
  params?: QueryParam[];
  sample?: 'auto' | 'exact' | 'sample';
}

export interface TopValue { value: string; count: number }
export interface HistogramBucket { from: number; to: number; count: number }
export interface StatsHistogram { axis: 'number' | 'time'; buckets: HistogramBucket[] }

export interface ColumnStats {
  name: string;
  type: string;
  kind: string;
  rows: number;
  nulls: number;
  distinct?: number | null;
  min?: string | null;
  max?: string | null;
  avg?: number | null;
  sum?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  top: TopValue[];
  histogram?: StatsHistogram | null;
  warning?: string | null;
  error?: string | null;
}

export interface ColumnStatsResult {
  label: string;
  dialect: string;
  rowsScanned: number;
  sampled: boolean;
  tableRows?: number | null;
  sampleNote?: string | null;
  columns: ColumnStats[];
  notes: string[];
  elapsedMs: number;
}

export interface ClientColumn { name: string; dbType: string; kind: string }
export type ClientStatsInput = { column: ClientColumn; values: CellValue[] };
