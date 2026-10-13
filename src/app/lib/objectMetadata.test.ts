import { describe, expect, test } from 'bun:test';
import { metadataChanges } from './objectMetadata';
import { validateSignedUrlLifetime } from './signedUrl';
import type { ObjectMetadata } from '@/app/providers/types';
const baseline: ObjectMetadata = {
  headers: {
    'Content-Type': 'text/plain',
    'Cache-Control': 'max-age=60',
    'Content-Disposition': null,
    'Content-Encoding': null,
    'Content-Language': null,
    Expires: null,
  },
  customMetadata: { keep: 'value', remove: 'value' },
  size: 12,
  etag: 'etag',
  lastModified: null,
  storageClass: 'STANDARD',
  missingMetadata: 0,
};
describe('metadata editor changes', () => {
  test('sends only intentional changes and deletions', () => {
    const changes = metadataChanges(
      baseline,
      { ...baseline.headers, 'Content-Type': 'application/json' },
      [
        ['keep', 'value'],
        ['new', '中文'],
      ]
    );
    expect(changes.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(changes.customMetadata).toEqual({ remove: null, new: '中文' });
  });
  test('rejects duplicate keys, header injection, invalid dates, and provider limits', () => {
    expect(() =>
      metadataChanges(baseline, baseline.headers, [
        ['same', '1'],
        ['same', '2'],
      ])
    ).toThrow('Duplicate');
    expect(() =>
      metadataChanges(
        baseline,
        { ...baseline.headers, 'Content-Type': 'text/plain\r\nInjected: yes' },
        []
      )
    ).toThrow('ASCII');
    expect(() =>
      metadataChanges(baseline, { ...baseline.headers, Expires: 'invalid date' }, [])
    ).toThrow('Expires');
    expect(() =>
      metadataChanges(baseline, baseline.headers, [['large', 'a'.repeat(2049)]], 'aws')
    ).toThrow('size limit');
  });
  test('handles prototype-like keys as ordinary custom metadata', () => {
    const changes = metadataChanges({ ...baseline, customMetadata: {} }, baseline.headers, [
      ['__proto__', 'safe'],
      ['constructor', 'safe'],
    ]);
    expect(JSON.parse(JSON.stringify(changes.customMetadata))).toEqual(
      Object.fromEntries([
        ['__proto__', 'safe'],
        ['constructor', 'safe'],
      ])
    );
    expect(Object.prototype.hasOwnProperty.call(changes.customMetadata, '__proto__')).toBe(true);
  });
});
describe('signed URL lifetime', () => {
  test('rejects missing, fractional, nonfinite, and out-of-range lifetimes', () => {
    for (const value of [0, -1, 0.5, 604801, NaN, Infinity, undefined as unknown as number])
      expect(() => validateSignedUrlLifetime(value)).toThrow();
    for (const value of [1, 900, 3600, 86400, 604800])
      expect(validateSignedUrlLifetime(value)).toBe(value);
  });
});
