import { create } from 'zustand';
/** Invalidate in-memory previews and inspector snapshots after metadata writes. */
export const useObjectRevisionStore = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));
