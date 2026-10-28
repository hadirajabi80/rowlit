import type { ActivityRow } from './types';

export interface MonitorMetric {
  id: string;
  label: string;
  value: number | null;
  unit: 'count' | 'bytes' | 'percent' | 'seconds' | 'ms';
  kind: 'gauge' | 'counter';
  group: 'sessions' | 'throughput' | 'memory' | 'io' | 'server';
  hint?: string | null;
  needs?: string | null;
}
export interface MonitorDatabase { name: string; sizeBytes: number }
export interface MonitorSnapshot {
  at: string;
  providerId: string;
  metrics: MonitorMetric[];
  databases: MonitorDatabase[];
  topQueries: ActivityRow[];
  notes: string[];
  version?: string | null;
}
