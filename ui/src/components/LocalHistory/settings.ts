// Local history settings, kept in the free-form settings.ui map (Settings > Editor; no engine change needed).
import { useSettings } from '../../store/settings';

export const LOCAL_HISTORY_KEY = 'localHistory';
export const LOCAL_HISTORY_DAYS_KEY = 'localHistoryDays';
export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

type UiSettings = { ui: Record<string, unknown> };

/** "Keep local history": on unless the user turned it off. */
export function localHistoryEnabled(s: UiSettings = useSettings.getState().settings): boolean {
  return s.ui[LOCAL_HISTORY_KEY] !== false;
}

/** "Keep for N days": a whole number in [1, 365], default 30. */
export function retentionDays(s: UiSettings = useSettings.getState().settings): number {
  const v = Number(s.ui[LOCAL_HISTORY_DAYS_KEY]);
  if (!Number.isFinite(v)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.round(v)));
}
