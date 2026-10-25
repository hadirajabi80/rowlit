// "Set colour…" for a schema / database: what the dialog is open for. Tiny on purpose (the shell imports it to know when
// to load the dialog, ScopeColorDialogHost); the dialog itself is a lazy chunk.
import { create } from 'zustand';
import type { ScopeRef } from '../../lib/scopeColors';

interface ScopeColorDialogStore {
  request: ScopeRef | null;
  open(request: ScopeRef): void;
  close(): void;
}

export const useScopeColorDialog = create<ScopeColorDialogStore>((set) => ({
  request: null,
  open(request) {
    set({ request });
  },
  close() {
    set({ request: null });
  },
}));
