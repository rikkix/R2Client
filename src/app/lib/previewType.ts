/** Detection runs only for an opened preview, never while listing or making thumbnails. */
export const PREVIEW_SAMPLE_BYTES = 8192;
export const DETECTED_TEXT_LIMIT = 5 * 1024 * 1024;
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unknown';

const extensions: Record<Exclude<PreviewKind, 'unknown'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'],
  pdf: ['pdf'],
  text: [],
};

export function mediaKindFromName(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [kind, list] of Object.entries(extensions)) {
    if (list.includes(ext)) return kind as PreviewKind;
  }
  return 'unknown';
}

/** A conservative subset of magic detection, not a full libmagic database. */
export function detectPreviewKind(bytes: Uint8Array, name: string): PreviewKind {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (
    starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ||
    starts(0xff, 0xd8, 0xff) ||
    ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) ||
    starts(0, 0, 1, 0) ||
    (ascii(0, 2) === 'BM' && bytes.length >= 14) ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
  )
    return 'image';
  if (
    ascii(0, 3) === 'ID3' ||
    ascii(0, 4) === 'fLaC' ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
  )
    return 'audio';
  if (ascii(0, 4) === 'OggS') return mediaKindFromName(name) === 'video' ? 'video' : 'audio';
  if (ascii(4, 8) === 'ftyp') {
    return ['M4A ', 'M4B ', 'M4P '].includes(ascii(8, 12)) ? 'audio' : 'video';
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video';

  // UTF-8 includes ASCII. Permit an incomplete character at the sample boundary,
  // but reject malformed input, NULs, and binary control characters.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
      stream: bytes.length === PREVIEW_SAMPLE_BYTES,
    });
    if (!/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) {
      // SVG has an XML text header; preserve its existing image viewer.
      return mediaKindFromName(name) === 'image' && /<svg(?:\s|>)/i.test(text) ? 'image' : 'text';
    }
  } catch {
    // Legacy media formats retain their existing viewer; text extensions do not
    // turn invalid bytes into editable text.
  }
  return mediaKindFromName(name) === 'pdf' ? 'unknown' : mediaKindFromName(name);
}

export async function readPreviewSample(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch
): Promise<Uint8Array> {
  const response = await fetcher(url, {
    headers: { Range: `bytes=0-${PREVIEW_SAMPLE_BYTES - 1}` },
    signal,
    cache: 'no-store',
  });
  if (response.status === 416 && response.headers.get('content-range') === 'bytes */0') {
    await response.body?.cancel();
    return new Uint8Array();
  }
  if (!response.ok) throw new Error(`Preview detection failed (HTTP ${response.status})`);
  if (!response.body) throw new Error('Preview detection returned no readable body');
  const reader = response.body.getReader();
  const sample = new Uint8Array(PREVIEW_SAMPLE_BYTES);
  let length = 0;
  try {
    while (length < sample.length) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, sample.length - length);
      sample.set(part, length);
      length += part.length;
    }
  } finally {
    // Also bound the read when a public server ignores the Range header.
    await reader.cancel().catch(() => {});
  }
  return sample.subarray(0, length);
}
