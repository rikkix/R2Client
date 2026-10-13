import { expect, test } from 'bun:test';
import { acquirePreviewSession, type PreviewSession } from './previewSessions';
import type { StorageConfig } from '@/app/providers/types';
const config: StorageConfig = {
  provider: 'r2',
  accountId: 'fixture',
  bucket: 'bucket',
  accessKeyId: 'fixture',
  secretAccessKey: 'fixture-secret',
};
test('late preview creation is released after navigation without displaying old content', async () => {
  let resolve!: (session: PreviewSession) => void;
  const pending = new Promise<PreviewSession>((done) => {
    resolve = done;
  });
  const released: string[] = [];
  const shown: string[] = [];
  const cancel = acquirePreviewSession(
    config,
    'file.txt',
    (session) => shown.push(session.url),
    () => undefined,
    {
      create: () => pending,
      release: async (session) => {
        released.push(session.sessionId);
      },
    }
  );
  cancel();
  resolve({ sessionId: 'old-session', url: 'http://127.0.0.1:1234/preview/old/file.txt' });
  await pending;
  await Promise.resolve();
  expect(shown).toEqual([]);
  expect(released).toEqual(['old-session']);
});
test('a mounted preview is released once and never exposes credentials in its URL', async () => {
  const released: string[] = [];
  const shown: string[] = [];
  const cancel = acquirePreviewSession(
    config,
    'file.txt',
    (session) => shown.push(session.url),
    () => undefined,
    {
      create: async () => ({
        sessionId: 'session',
        url: 'http://127.0.0.1:1234/preview/session/file.txt',
      }),
      release: async (session) => {
        released.push(session.sessionId);
      },
    }
  );
  await Promise.resolve();
  cancel();
  cancel();
  expect(released).toEqual(['session']);
  expect(shown[0]).not.toContain(config.secretAccessKey!);
});
