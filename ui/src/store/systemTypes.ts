// SQL Server "System Data Types" (the explorer's read-only built-in types group): loaded on first expansion, per database.
import { create } from 'zustand';
import { api, errorMessage } from '../api/client';
import type { SystemTypeInfo } from '../api/types';
import { dbKey } from './catalog';

export interface SystemTypesEntry {
  status: 'loading' | 'ready' | 'error';
  types: SystemTypeInfo[];
  error?: string;
}

interface SystemTypesState {
  byDb: Record<string, SystemTypesEntry>;
  /** Loads the database's built-in types once (an error entry is retried by `reload`). */
  load(connectionId: string, database: string | null): Promise<void>;
  reload(connectionId: string, database: string | null): Promise<void>;
}

export const useSystemTypes = create<SystemTypesState>((set, get) => ({
  byDb: {},
  async load(connectionId, database) {
    const key = dbKey(connectionId, database);
    if (get().byDb[key]) return;
    set((s) => ({ byDb: { ...s.byDb, [key]: { status: 'loading', types: [] } } }));
    try {
      const types = await api.systemTypes(connectionId, database);
      set((s) => ({ byDb: { ...s.byDb, [key]: { status: 'ready', types } } }));
    } catch (e) {
      set((s) => ({ byDb: { ...s.byDb, [key]: { status: 'error', types: [], error: errorMessage(e) } } }));
    }
  },
  async reload(connectionId, database) {
    const key = dbKey(connectionId, database);
    set((s) => {
      const { [key]: _drop, ...rest } = s.byDb;
      return { byDb: rest };
    });
    await get().load(connectionId, database);
  },
}));
