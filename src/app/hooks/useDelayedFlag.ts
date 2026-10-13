import { useEffect, useState } from 'react';

/** Suppress short-lived notices; never carry visibility across folders/accounts. */
export function useDelayedFlag(enabled: boolean, scope: string, delayMs: number): boolean {
  const [readyScope, setReadyScope] = useState<string | null>(null);
  useEffect(() => {
    setReadyScope(null);
    if (!enabled) return;
    const timer = setTimeout(() => setReadyScope(scope), delayMs);
    return () => clearTimeout(timer);
  }, [enabled, scope, delayMs]);
  return enabled && readyScope === scope;
}
