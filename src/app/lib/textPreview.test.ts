import { expect, test } from 'bun:test';
import { readTextPreview } from './textPreview';
import { TEXT_PREVIEW_LIMIT } from './previewType';
const signal = () => new AbortController().signal;
const failure = (promise: Promise<string>) => promise.catch((error: Error) => error.message);

test('known text extensions cannot bypass the size limit through listed size or response headers', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const result = await failure(
    readTextPreview(
      'large.txt',
      { signal: signal() },
      (async () =>
        new Response(body, {
          headers: { 'content-length': String(TEXT_PREVIEW_LIMIT + 1) },
        })) as typeof fetch
    )
  );
  expect(result).toContain('limited to 5 MiB');
  expect(cancelled).toBe(true);
});

test('a missing or dishonest Content-Length cannot bypass the streamed byte limit', async () => {
  const headerCases: HeadersInit[] = [{}, { 'content-length': '1' }];
  for (const headers of headerCases) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const result = await failure(
      readTextPreview(
        'data',
        { signal: signal(), maxBytes: 5 },
        (async () => new Response(body, { headers })) as typeof fetch
      )
    );
    expect(result).toContain('limited to 5 MiB');
    expect(cancelled).toBe(true);
  }
});

test('valid text at the byte boundary succeeds, while invalid UTF-8 after a text header fails', async () => {
  expect(
    await readTextPreview(
      'small.txt',
      { signal: signal(), maxBytes: 5 },
      (async () => new Response('hello')) as typeof fetch
    )
  ).toBe('hello');
  const bytes = new Uint8Array(8193).fill(65);
  bytes[8192] = 255;
  expect(
    await failure(
      readTextPreview(
        'data.txt',
        { signal: signal() },
        (async () => new Response(bytes)) as typeof fetch
      )
    )
  ).toContain('not valid UTF-8');
  expect(
    await readTextPreview(
      'empty.txt',
      { signal: signal() },
      (async () => new Response(null, { headers: { 'content-length': '0' } })) as typeof fetch
    )
  ).toBe('');
});

test('abandoning a text preview cancels the stream and never reports partial content as success', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('first chunk'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await failure(
    readTextPreview(
      'text',
      {
        signal: controller.signal,
        onProgress: () => controller.abort(new Error('Preview closed')),
      },
      (async () => new Response(body)) as typeof fetch
    )
  );
  expect(result).toBe('Preview closed');
  expect(cancelled).toBe(true);
});

test('permission failures close response bodies without reporting a successful preview', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  expect(
    await failure(
      readTextPreview(
        'private.txt',
        { signal: signal() },
        (async () => new Response(body, { status: 403 })) as typeof fetch
      )
    )
  ).toContain('HTTP 403');
  expect(cancelled).toBe(true);
});
