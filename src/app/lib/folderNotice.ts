export interface FolderNotice {
  label: string;
  detail?: string;
  tone: 'progress' | 'info' | 'error';
  retry?: boolean;
}

export function folderNotice(state: {
  configured: boolean;
  hasData: boolean;
  loading: boolean;
  fetching: boolean;
  partial: boolean;
  cached: boolean;
  error: Error | null;
  searchQuery: string;
  searching: boolean;
  indexing: { isRunning: boolean; objectsFetched: number; estimatedTotal: number | null };
}): FolderNotice | null {
  if (!state.configured) return null;
  if (state.searchQuery.trim()) {
    if (state.searching) return { label: 'Searching bucket…', tone: 'progress' };
    if (state.indexing.isRunning) {
      const { objectsFetched, estimatedTotal } = state.indexing;
      return {
        label: `Search covers ${objectsFetched.toLocaleString()}${estimatedTotal ? ` / ~${estimatedTotal.toLocaleString()}` : ''} indexed objects`,
        detail: 'The bucket is still being indexed; search results may be incomplete.',
        tone: 'info',
      };
    }
    return null;
  }
  if (state.error) {
    return {
      label: state.hasData ? 'Refresh failed; showing available files' : 'Folder load failed',
      detail: state.error.message,
      tone: 'error',
      retry: true,
    };
  }
  if (state.loading) return { label: 'Loading folder…', tone: 'progress' };
  if (state.partial) {
    return {
      label: state.fetching ? 'Loading more files…' : 'Partial file list',
      detail: 'Sorting the files loaded so far.',
      tone: state.fetching ? 'progress' : 'info',
      retry: !state.fetching,
    };
  }
  if (state.fetching) {
    return {
      label: state.cached ? 'Checking for changes…' : 'Refreshing folder…',
      detail: state.cached
        ? 'Showing cached folder contents while checking for changes.'
        : undefined,
      tone: 'progress',
    };
  }
  return null;
}
