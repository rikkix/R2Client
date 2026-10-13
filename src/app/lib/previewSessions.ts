import { invoke } from '@tauri-apps/api/core';
import { toObjectConfig } from '@/app/providers/objectAccess';
import type { StorageConfig } from '@/app/providers/types';
export interface PreviewSession {
  sessionId: string;
  url: string;
}
export function createPreviewSession(config: StorageConfig, key: string) {
  return invoke<PreviewSession>('create_preview_session', { config: toObjectConfig(config), key });
}
export function releasePreviewSession(session: PreviewSession) {
  return invoke<void>('release_preview_session', { sessionId: session.sessionId });
}
/** A late IPC response must release its lease when the consumer already left. */
export function acquirePreviewSession(
  config: StorageConfig,
  key: string,
  onReady: (session: PreviewSession) => void,
  onError: (error: unknown) => void,
  backend = { create: createPreviewSession, release: releasePreviewSession }
) {
  let cancelled = false;
  let session: PreviewSession | undefined;
  const release = (value: PreviewSession) => {
    void backend.release(value).catch(() => undefined);
  };
  void backend
    .create(config, key)
    .then((value) => {
      if (cancelled) {
        release(value);
        return;
      }
      session = value;
      onReady(value);
    })
    .catch((error: unknown) => {
      if (!cancelled) onError(error);
    });
  return () => {
    cancelled = true;
    if (session) {
      release(session);
      session = undefined;
    }
  };
}
