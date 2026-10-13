# Folder Loading Flash Fix

Date: 2026-10-13. This remains an unofficial personal modification.

The brief blue notice was "Showing cached folder contents; checking for changes". Folder and search loading also mounted Ant Design's fullscreen Spin, whose fixed dark mask covers the entire window. This could briefly darken the shell before the cached snapshot arrived.

Loading now uses a nested spinner confined to the file area, delayed by 150 ms. Initial account loading also no longer uses a fullscreen mask. Cached-folder revalidation notices wait 250 ms and reset on folder/account changes; errors and partial-result notices remain immediate. Previous-folder rows are not used as actionable placeholders.

Formatting, TypeScript, all 334 frontend tests, and the macOS release build passed. A rendered-component regression test checks that folder and search loading do not produce a fullscreen mask. The rebuilt app was installed in `/Applications/r2.app`, with installed-file and local ad-hoc signature verification.

Native navigation from the root into a folder displayed the new rows without a fullscreen mask or the brief cache banner. The original blue notice was captured before the change. Automation uses snapshots, so the reported millisecond black frame was not directly recorded. Native inspection was read-only; no remote object was modified.
