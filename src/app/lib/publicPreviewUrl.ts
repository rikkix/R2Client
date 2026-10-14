/** Preview-only cache invalidation; the canonical sharing URL stays unchanged. */
const previewEpoch = Date.now().toString(36);
export function publicPreviewUrl(url: string | null, revision: number): string | null {
  if (!url || revision === 0) return url;
  const preview = new URL(url);
  preview.searchParams.set('_r2_preview_revision', `${previewEpoch}-${revision}`);
  return preview.href;
}
