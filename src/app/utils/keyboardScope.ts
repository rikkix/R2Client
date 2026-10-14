/** File-list actions must never run behind a visible dialog. */
export function blocksBackgroundShortcut(
  event: Pick<KeyboardEvent, 'defaultPrevented'> &
    Partial<Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'preventDefault'>>,
  root: Pick<Document, 'querySelectorAll'> | undefined = typeof document === 'undefined'
    ? undefined
    : document,
  dialogRequested = false
): boolean {
  const blocked =
    dialogRequested ||
    event.defaultPrevented ||
    Array.from(root?.querySelectorAll('[role="dialog"], [role="alertdialog"]') ?? []).some(
      (dialog) => dialog.getClientRects().length > 0
    );
  // Blocking the app's refresh handler must also block the browser's fallback
  // reload, which would otherwise discard an open editor in dev or WebView2.
  if (blocked && (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 'r') {
    event.preventDefault?.();
  }
  return blocked;
}
