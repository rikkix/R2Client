import { create } from 'zustand';
import type { StorageConfig } from '@/app/providers/types';
export interface ObjectAction {
  kind: 'signed-url' | 'metadata';
  config: StorageConfig;
  key: string;
  name: string;
}
export const useObjectActionStore = create<{
  action: ObjectAction | null;
  open: (action: ObjectAction) => void;
  close: () => void;
}>((set) => ({
  action: null,
  open: (action) => set({ action }),
  close: () => set({ action: null }),
}));
