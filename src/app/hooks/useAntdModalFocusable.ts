'use client';

import { useMemo } from 'react';
import { useTransferErrorStore } from '@/app/stores/transferErrorStore';

/**
 * `focusable` for an antd Modal. antd pulls focus back inside its modal on
 * every focusin, which would leave the keyboard under the transfer failure
 * modal whenever it opens above it (at ABOVE_ANTD_MODALS_Z_INDEX).
 * The trap lifts while the failure modal is open.
 */
export function useAntdModalFocusable(): { trap: boolean } {
  const failureOpen = useTransferErrorStore((s) => s.isOpen);
  const trap = !failureOpen;
  return useMemo(() => ({ trap }), [trap]);
}
