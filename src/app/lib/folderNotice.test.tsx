import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { folderNotice } from './folderNotice';
import FolderStatus from '@/app/components/status-bar-parts/FolderStatus';

const ready = {
  configured: true,
  hasData: true,
  loading: false,
  fetching: false,
  partial: false,
  cached: false,
  error: null,
  searchQuery: '',
  searching: false,
  indexing: { isRunning: false, objectsFetched: 33, estimatedTotal: 33 },
};

test('cached refresh is an inline notice and disappears when finished', () => {
  expect(folderNotice(ready)).toBeNull();
  expect(folderNotice({ ...ready, fetching: true, cached: true })?.label).toBe(
    'Checking for changes…'
  );
  expect(folderNotice({ ...ready, configured: false, fetching: true })).toBeNull();
});

test('failed partial refresh preserves the error and retry instead of claiming it is loading', () => {
  const notice = folderNotice({
    ...ready,
    partial: true,
    fetching: true,
    error: new Error('AccessDenied'),
  });
  expect(notice?.tone).toBe('error');
  expect(notice?.detail).toBe('AccessDenied');
  expect(notice?.retry).toBe(true);
  expect(folderNotice({ ...ready, partial: true, fetching: true })?.label).toBe(
    'Loading more files…'
  );
});

test('partial search status describes the index rather than an unrelated folder refresh', () => {
  const notice = folderNotice({
    ...ready,
    searchQuery: 'photo',
    cached: true,
    fetching: true,
    indexing: { ...ready.indexing, isRunning: true },
  });
  expect(notice?.label).toContain('33 / ~33 indexed objects');
  expect(notice?.detail).toContain('incomplete');
});

test('idle and active status both retain the reserved status slot without an alert banner', () => {
  for (const notice of [null, folderNotice({ ...ready, fetching: true, cached: true })]) {
    const markup = renderToStaticMarkup(<FolderStatus notice={notice} />);
    expect(markup).toContain('sb-folder-status');
    expect(markup).not.toContain('ant-alert');
    expect(markup).not.toContain('fullscreen');
  }
});
