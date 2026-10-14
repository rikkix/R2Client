import { expect, test } from 'bun:test';
import { publicPreviewUrl } from './publicPreviewUrl';

test('metadata revisions reload public previews while keeping the sharing URL unchanged', () => {
  const canonical = 'https://cdn.example.test/a%20b/%23name.png?existing=value#fragment';
  expect(publicPreviewUrl(canonical, 0)).toBe(canonical);
  expect(publicPreviewUrl(null, 1)).toBeNull();
  const first = new URL(publicPreviewUrl(canonical, 1)!);
  const next = new URL(publicPreviewUrl(canonical, 2)!);
  expect(first.href).not.toBe(next.href);
  expect(first.pathname).toBe('/a%20b/%23name.png');
  expect(first.searchParams.get('existing')).toBe('value');
  expect(first.searchParams.get('_r2_preview_revision')).toContain('-1');
  expect(first.hash).toBe('#fragment');
  expect(canonical).not.toContain('_r2_preview_revision');
});
