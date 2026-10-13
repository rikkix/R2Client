import { useEffect, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { detectPreviewKind, readPreviewSample, type PreviewKind } from '@/app/lib/previewType';

export function usePreviewKind(url: string | null, name: string) {
  const [result, setResult] = useState<{
    url: string;
    name: string;
    kind: PreviewKind;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    void readPreviewSample(url, controller.signal, tauriFetch)
      .then((sample) => {
        if (active) setResult({ url, name, kind: detectPreviewKind(sample, name) });
      })
      .catch((error: unknown) => {
        if (active) {
          setResult({
            url,
            name,
            kind: 'unknown',
            error: error instanceof Error ? error.message : 'Could not detect preview type',
          });
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url, name]);
  // A late response cannot select a viewer for a different object/account.
  const current = result?.url === url && result?.name === name ? result : null;
  return { kind: current?.kind ?? 'unknown', detecting: !!url && !current, error: current?.error };
}
