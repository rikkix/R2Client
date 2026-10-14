import { TEXT_PREVIEW_LIMIT } from './previewType';

export async function readTextPreview(
  url: string,
  options: {
    signal: AbortSignal;
    maxBytes?: number;
    onProgress?: (loaded: number, total: number | null) => void;
  },
  fetcher: typeof fetch
): Promise<string> {
  const { signal, maxBytes = TEXT_PREVIEW_LIMIT, onProgress } = options;
  signal.throwIfAborted();
  const response = await fetcher(url, { signal, cache: 'no-store' });
  const totalHeader = response.headers.get('content-length');
  const total = totalHeader === null ? null : Number(totalHeader);
  const readableTotal = total !== null && Number.isFinite(total) && total >= 0 ? total : null;
  if (!response.ok || (readableTotal !== null && readableTotal > maxBytes) || signal.aborted) {
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    throw new Error('Text preview is limited to 5 MiB. Download this file to view it.');
  }
  if (!response.body) {
    if (readableTotal === 0) return '';
    throw new Error('Text preview returned no readable body');
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      loaded += value.length;
      if (loaded > maxBytes) {
        throw new Error('Text preview is limited to 5 MiB. Download this file to view it.');
      }
      chunks.push(value);
      onProgress?.(loaded, readableTotal);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    // A text-looking header is not proof that the complete file is valid UTF-8.
    // Do not silently replace invalid bytes and then allow a corrupted save.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('This file is not valid UTF-8 text. Download it to view it.');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
