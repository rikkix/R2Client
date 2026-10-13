# Listing Timeout Fix

Date: 2026-10-13. This remains an unofficial personal modification.

The reported message came from the listing executor's total 30-second budget. A stalled SDK request could consume that entire budget before returning an error, leaving no opportunity for the configured retries. The error did not establish an authentication failure; cached files were retained. A read-only refresh subsequently succeeded in the previous build, consistent with a temporary stall, although its underlying network cause was not captured.

Listings now have separate per-attempt and total deadlines:

| Operation                 | Attempt limit | Total budget | Maximum attempts |
| ------------------------- | ------------- | ------------ | ---------------- |
| Foreground folder listing | 10 seconds    | 30 seconds   | 3                |
| Background bucket refresh | 30 seconds    | 90 seconds   | 6                |

Queueing and backoff count toward the total budget, so fewer attempts may fit when responses stall. The background admission semaphore is also bounded by this deadline. Waiting for a previous background sync now has its own error message instead of claiming an S3 network request timed out. Transfer and metadata-write timeouts are unchanged; timed-out writes are not replayed by this change.

Four regression tests cover recovery after a stalled attempt, bounded repeated stalls, blocked background admission, and an actual SDK fixture whose first response stalls. All 477 Rust workspace tests passed, along with formatting, Clippy with warnings denied, frontend formatting/typecheck, and the macOS release build.

The rebuilt app was installed in `/Applications/r2.app`, with file and local ad-hoc signature verification. Its startup background listing completed for the existing R2 bucket, showing 33 files and no failure or syncing banner. Live checks were read-only; no remote object was modified. This verifies recovery during the check, not guaranteed availability of the storage endpoint or network.
