import { expect, test } from 'bun:test';
import { detectPreviewKind, readPreviewSample, PREVIEW_SAMPLE_BYTES } from './previewType';

const bytes = (text: string) => new TextEncoder().encode(text);

test('detects ASCII and UTF-8 text regardless of extension, including empty files', () => {
  for (const name of ['README', 'configuration.keys', 'wrong.png', 'script.py']) {
    expect(detectPreviewKind(bytes('hello\n世界\t=1\r\n'), name)).toBe('text');
  }
  expect(detectPreviewKind(new Uint8Array(), 'empty')).toBe('text');
});

test('binary and malformed UTF-8 do not become editable text', () => {
  expect(detectPreviewKind(new Uint8Array([65, 0, 66]), 'secret.keys')).toBe('unknown');
  expect(detectPreviewKind(new Uint8Array([0xff, 0xff]), 'wrong.txt')).toBe('unknown');
  const sample = new Uint8Array(PREVIEW_SAMPLE_BYTES).fill(65);
  sample[sample.length - 1] = 0xe4;
  expect(detectPreviewKind(sample, 'utf8')).toBe('text');
});

test('magic signatures override names and common media viewers remain available', () => {
  expect(detectPreviewKind(bytes('%PDF-1.7\n'), 'data.bin')).toBe('pdf');
  expect(
    detectPreviewKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'data.txt')
  ).toBe('image');
  expect(detectPreviewKind(bytes('RIFFxxxxWEBP'), 'data')).toBe('image');
  expect(detectPreviewKind(bytes('RIFFxxxxWAVE'), 'data')).toBe('audio');
  expect(detectPreviewKind(bytes('xxxxftypM4A '), 'data')).toBe('audio');
  expect(detectPreviewKind(bytes('xxxxftypisom'), 'data')).toBe('video');
  expect(
    detectPreviewKind(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'icon.svg')
  ).toBe('image');
});

test('requests a bounded range and cancels servers that ignore it', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(20000).fill(65));
    },
    cancel() {
      cancelled = true;
    },
  });
  const signal = new AbortController().signal;
  const sample = await readPreviewSample('http://127.0.0.1/opaque/file', signal, (async (
    _url,
    init
  ) => {
    expect(init?.headers).toEqual({ Range: 'bytes=0-8191' });
    expect(init?.signal).toBe(signal);
    expect(init?.cache).toBe('no-store');
    return new Response(stream);
  }) as typeof fetch);
  expect(sample.length).toBe(PREVIEW_SAMPLE_BYTES);
  expect(cancelled).toBe(true);
});

test('partial reads, empty objects and access failures are handled explicitly', async () => {
  expect(
    await readPreviewSample(
      'local',
      new AbortController().signal,
      (async () => new Response('abc', { status: 206 })) as typeof fetch
    )
  ).toEqual(bytes('abc'));
  expect(
    await readPreviewSample(
      'local',
      new AbortController().signal,
      (async () =>
        new Response(null, {
          status: 416,
          headers: { 'content-range': 'bytes */0' },
        })) as typeof fetch
    )
  ).toEqual(new Uint8Array());
  const failure = await readPreviewSample(
    'local',
    new AbortController().signal,
    (async () => new Response(null, { status: 403 })) as typeof fetch
  ).catch((error: Error) => error.message);
  expect(failure).toContain('HTTP 403');
});

test('ASCII prose that resembles short media prefixes stays text', () => {
  for (const text of ['ID3', 'ID3 tags describe music.', 'BMP is an image format.']) {
    expect(detectPreviewKind(bytes(text), 'notes.txt')).toBe('text');
  }
  const bmp = new Uint8Array(54);
  const view = new DataView(bmp.buffer);
  bmp.set(bytes('BM'));
  view.setUint32(2, 58, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  expect(detectPreviewKind(bmp, 'unknown')).toBe('image');
  expect(detectPreviewKind(new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 1]), 'unknown')).toBe(
    'audio'
  );
});

test('failed probe closes its response stream instead of retaining a remote read', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const result = await readPreviewSample(
    'fixture',
    new AbortController().signal,
    (async () => new Response(body, { status: 403 })) as typeof fetch
  ).catch((error: Error) => error.message);
  expect(result).toContain('HTTP 403');
  expect(cancelled).toBe(true);
});
