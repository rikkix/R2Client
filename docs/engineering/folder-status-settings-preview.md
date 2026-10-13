# Folder status, Settings scrolling, and content previews

Date: 2026-10-13. This is an unofficial personal build; live provider writes remain unverified.

Folder cache, partial-list, search-index, and refresh notices now use a permanently reserved slot at the bottom right of the status bar. The file table has no top notice that changes its position. Errors retain a Retry action and full details on hover. Fatal loads with no files still show an error inside the file area. The obsolete notice-delay hook was removed.

Settings has a bounded body between its header and footer. The outer modal body does not scroll; the content panel scrolls independently. The navigation fills the available height and only needs its own scroll when the window is too short for the navigation itself. Switching tabs resets the content panel to the top.

Opening a file preview now probes its first 8 KiB with a range request through the existing authenticated local preview service or configured public URL. It recognizes common image, PDF, audio, and video signatures and conservative ASCII/UTF-8 text. Existing media extensions remain a fallback for formats without a recognized signature. This is a small signature detector, not the full Linux `file`/libmagic database; UTF-16 and other legacy text encodings are not included. Detection runs only in an opened preview, not during listing or thumbnail generation, and creates no sharing URL.

The probe adds one GET, and private reads also use the service's existing HeadObject request. A server that ignores Range may transmit more data before stream cancellation. Detection has a 15-second timeout, bounds the retained sample, cancels its stream, and ignores results from closed or replaced previews. Newly detected text with an unfamiliar extension is read-only and limited to 5 MiB, with both listed-size and streamed-byte checks. Known text extensions retain their existing editing interface. Text reads now abort on unmount.

## Validation

- Frontend formatting, TypeScript, and 343 tests passed. Fixtures cover extension-independent text, malformed UTF-8, binary data, signature detection, a truncated UTF-8 sample boundary, bounded reads when Range is ignored, empty objects, and access denial.
- Rust source was unchanged in this change; Rust tests were not rerun.
- The production frontend build, macOS release app, and DMG completed successfully. Running the frontend build directly avoided a port failure in the Tauri pre-build subprocess; packaging reused that completed static output. Updater artifacts remain disabled.
- `/Applications/r2.app` was replaced after normal quit. Its staged and installed file manifests and local ad-hoc signature were verified; account data was untouched.
- The footer refresh status was observed in the native app before the Settings and preview changes. Final native Settings scrolling and content detection verification are pending because desktop automation reports that the Mac is locked. Content detection was tested with automated local fixtures; no live provider write acceptance is claimed.

No existing remote object was changed and no release was published.
