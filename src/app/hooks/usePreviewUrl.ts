import { useEffect, useState } from 'react';
import { useObjectRevisionStore } from '@/app/stores/objectRevisionStore';
import {
  buildPublicUrl,
  hasSigningCredentials,
  isBucketPublic,
  type StorageConfig,
} from '@/app/lib/r2cache';
import { acquirePreviewSession } from '@/app/lib/previewSessions';
import { publicPreviewUrl } from '@/app/lib/publicPreviewUrl';

/** Local preview URLs are never sharing URLs and never require presigning. */
export function usePreviewUrl(
  config: StorageConfig | null | undefined,
  key: string,
  enabled: boolean
): string | null {
  const [result, setResult] = useState<{ scope: string; url: string } | null>(null);
  const revision = useObjectRevisionStore((state) => state.revision);
  // This scope stays in memory and is never placed in a cache, URL, or log.
  const scope = JSON.stringify([config, key, revision]);
  useEffect(() => {
    setResult(null);
    if (!enabled || !config || isBucketPublic(config) || !hasSigningCredentials(config)) return;
    return acquirePreviewSession(
      config,
      key,
      (session) => setResult({ scope, url: session.url }),
      () => setResult(null)
    );
    // The scope includes every effective connection field and credential change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, enabled]);
  if (!enabled || !config) return null;
  if (isBucketPublic(config)) return publicPreviewUrl(buildPublicUrl(config, key), revision);
  return result?.scope === scope ? result.url : null;
}
