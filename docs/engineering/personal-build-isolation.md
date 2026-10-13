# Personal Build Isolation

Date: 2026-10-13. This remains an unofficial personal modification, unverified for live provider writes and production use.

Removed the automatic/manual updater, upstream update endpoint and public key, updater/restart permissions, and unused updater/process/OS plugins. Updater artifact generation is disabled in the default build configuration.

Removed all upstream issue-reporting entry points, dialog/store, URL builder, and session-log collection hooks. Local transfer failure details and clipboard copying remain available. Settings and About no longer open upstream pages. Upstream release, Homebrew publishing, and funding configuration were removed; source attribution and dependency licenses remain.

PDF.js workers, fonts, character maps, and WASM files are copied from the installed React-PDF dependency into the app bundle. Monaco and its workers are copied from the installed editor dependency and configured to load locally. The asset preparation script runs before development and production builds; generated assets are ignored by Git, and their licenses are included. The interface uses system fonts instead of the Google Fonts build integration. Next.js telemetry is disabled by the development, build, and start scripts.

No separate outbound analytics SDK was found in application code. Optional local timing diagnostics retain credential redaction and have no remote exporter. Storage-provider endpoints, configured public object URLs, and explicit opening of user-generated sharing links remain functional. Package registry URLs, dependency source URLs, schema references, and legal attribution are development or documentation references rather than background application services.

## Validation

- Frontend formatting, TypeScript, and 333 tests passed. Removed tests belonged to deleted reporting code; two new boundary tests guard the updater/reporting removal and local viewer configuration.
- Rust formatting, Clippy with warnings denied, and workspace tests passed: 473 tests passed, with 7 existing tests and 1 documentation test ignored.
- The isolated native app rendered a local text fixture through Monaco and a PDF fixture through the bundled PDF.js worker. The status bar had no reporting or update actions, Settings displayed Personal build without a documentation link, and the command palette had no reporting action.
- The list-view context menu was verified in the isolated app, resolving the earlier GUI recheck limitation. Generate signed URL and Edit metadata actions remained available. No metadata writes were performed during this check.
- The production macOS app and DMG were rebuilt. The installed app's file manifest and local ad-hoc signature were verified, and the app was reopened with the report/update controls absent and existing account data intact.
- The isolated app and localhost fixture server were stopped after testing.

These checks used local fixtures. Runtime traffic was not packet-captured, and this is not a claim that the app cannot contact user-configured storage or object URLs. No release was published.
