// State of one wizard tab (kept in React state of the view; only path / target are persisted into the tab).
import {
  autoMatch, defaultNewColumns, tableNameFromFile, type MapChoice, type NewColumnRow,
} from './model';
import type {
  DdlPreview, ImportCapabilities, ImportMode, ImportProgress, ImportSummary, PreviewResult, SourceOptions, TargetTableInfo,
} from './types';

export const STEPS = ['Source', 'Format', 'Target', 'Mode', 'Run'] as const;
export const STEP_SOURCE = 0;
export const STEP_FORMAT = 1;
export const STEP_TARGET = 2;
export const STEP_MODE = 3;
export const STEP_RUN = 4;

export interface RunState {
  status: 'idle' | 'starting' | 'running' | 'done' | 'failed';
  jobId: string | null;
  progress: ImportProgress | null;
  /** Rows read as the engine reports them in job.progress (done), when the message is not the JSON form. */
  rowsRead: number;
  summary: ImportSummary | null;
  error: string | null;
  startedAt: number | null;
  cancelling: boolean;
}

export const IDLE_RUN: RunState = { status: 'idle', jobId: null, progress: null, rowsRead: 0, summary: null, error: null, startedAt: null, cancelling: false };

export interface WizardState {
  step: number;
  path: string;
  /** Options the user changed; everything else is the engine's auto-detection (PreviewResult.options). */
  userOpts: Partial<SourceOptions>;
  preview: PreviewResult | null;
  previewLoading: boolean;
  /** Preview page (0-based, PREVIEW_PAGE_SIZE rows each). */
  previewPage: number;
  previewError: string | null;
  /** Signature of the file columns (index + name): a change resets the mapping. */
  columnSig: string;

  caps: ImportCapabilities | null;
  capsError: string | null;

  targetMode: 'existing' | 'new';
  schema: string | null;
  /** Existing table to load into. */
  table: string;
  tableInfo: TargetTableInfo | null;
  tableInfoLoading: boolean;
  tableInfoError: string | null;
  mapping: Record<string, MapChoice>;
  mappingTouched: boolean;

  /** New table. */
  newTable: string;
  newColumns: NewColumnRow[];
  primaryKey: string[];
  ddl: DdlPreview | null;
  ddlError: string | null;

  mode: ImportMode;
  keyColumns: string[];
  onError: 'stop' | 'skip';
  maxErrors: number;
  /** null: the engine's default (capabilities). */
  batchSize: number | null;
  /** null: on when the provider supports it. */
  transaction: boolean | null;
  useBulk: boolean;
  /** 0 = all rows. */
  limit: number;
  confirmTruncate: boolean;

  run: RunState;
}

export function initialState(init: { path?: string | null; targetMode?: 'existing' | 'new'; schema?: string | null; table?: string | null }): WizardState {
  const path = init.path ?? '';
  const mode = init.targetMode ?? 'new';
  return {
    step: 0,
    path,
    userOpts: {},
    preview: null,
    previewLoading: false,
    previewPage: 0,
    previewError: null,
    columnSig: '',
    caps: null,
    capsError: null,
    targetMode: mode,
    schema: init.schema ?? null,
    table: mode === 'existing' ? init.table ?? '' : '',
    tableInfo: null,
    tableInfoLoading: false,
    tableInfoError: null,
    mapping: {},
    mappingTouched: false,
    newTable: path ? tableNameFromFile(path) : '',
    newColumns: [],
    primaryKey: [],
    ddl: null,
    ddlError: null,
    mode: 'append',
    keyColumns: [],
    onError: 'stop',
    maxErrors: 1000,
    batchSize: null,
    transaction: null,
    useBulk: true,
    limit: 0,
    confirmTruncate: false,
    run: IDLE_RUN,
  };
}

/** A fresh preview arrived: refresh the file columns, and reset what depends on their identity when they changed. */
export function applyPreview(prev: WizardState, r: PreviewResult): WizardState {
  const sig = r.columns.map((c) => `${c.index}:${c.name}`).join('\u0001');
  const next: WizardState = { ...prev, preview: r, previewLoading: false, previewError: null, columnSig: sig };
  if (sig !== prev.columnSig) {
    next.newColumns = defaultNewColumns(r.columns);
    next.primaryKey = [];
    next.ddl = null;
    if (prev.tableInfo) {
      next.mapping = autoMatch(prev.tableInfo.columns, r.columns);
      next.mappingTouched = false;
    }
  } else {
    // same columns: only the inferred types may have changed (date formats, separators)
    next.newColumns = prev.newColumns.map((row) => ({ ...row, inferred: r.columns.find((c) => c.index === row.index)?.inferred ?? row.inferred }));
  }
  if (!prev.newTable.trim() && prev.path) next.newTable = tableNameFromFile(prev.path);
  return next;
}

export function applyTableInfo(prev: WizardState, info: TargetTableInfo): WizardState {
  return {
    ...prev,
    tableInfo: info,
    tableInfoLoading: false,
    tableInfoError: null,
    mapping: autoMatch(info.columns, prev.preview?.columns ?? []),
    mappingTouched: false,
    keyColumns: [],
  };
}

/** The options sent to the engine: its own detection overlaid with the user's changes. */
export function effectiveSource(s: Pick<WizardState, 'preview' | 'userOpts'>): SourceOptions | null {
  if (!s.preview) return null;
  return { ...s.preview.options, ...s.userOpts } as SourceOptions;
}
