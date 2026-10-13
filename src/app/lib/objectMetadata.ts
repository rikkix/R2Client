import type { MetadataChanges, ObjectMetadata } from '@/app/providers/types';
export const METADATA_COPY_LIMIT = 5 * 1024 ** 3;
export const METADATA_HEADERS = [
  'Content-Type',
  'Cache-Control',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Language',
  'Expires',
] as const;
export function metadataChanges(
  baseline: ObjectMetadata,
  headers: Record<string, string | null>,
  entries: [string, string][],
  provider: string = 'r2'
): MetadataChanges {
  const custom: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (!key || key.startsWith('x-amz-meta-') || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key))
      throw new Error('Custom metadata keys must be lowercase HTTP tokens without x-amz-meta-');
    if (Object.prototype.hasOwnProperty.call(custom, key))
      throw new Error(`Duplicate metadata key: ${key}`);
    if (/[\u0000-\u001f\u007f]/.test(value))
      throw new Error('Metadata cannot contain control characters');
    custom[key] = value;
  }
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const customBytes = Object.entries(custom).reduce(
    (sum, [key, value]) => sum + bytes(key) + bytes(value),
    0
  );
  const totalBytes =
    customBytes +
    Object.entries(headers).reduce((sum, [key, value]) => sum + bytes(key) + bytes(value ?? ''), 0);
  if (totalBytes > 8192 || (provider !== 'r2' && customBytes > 2048))
    throw new Error("Metadata exceeds the provider's size limit");
  const changes: MetadataChanges = {
    headers: Object.create(null),
    customMetadata: Object.create(null),
  };
  for (const key of METADATA_HEADERS) {
    const value = headers[key] ?? null;
    if (value !== null && /[^\x20-\x7e]/.test(value))
      throw new Error('HTTP headers must contain printable ASCII characters');
    if (key === 'Expires' && value && Number.isNaN(Date.parse(value)))
      throw new Error('Expires must be an HTTP date or ISO 8601 timestamp');
    if (value !== baseline.headers[key]) changes.headers[key] = value;
  }
  for (const key of new Set([...Object.keys(baseline.customMetadata), ...Object.keys(custom)])) {
    if (custom[key] !== baseline.customMetadata[key])
      changes.customMetadata[key] = custom[key] ?? null;
  }
  return changes;
}
