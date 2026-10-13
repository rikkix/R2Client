# Personalization Validation

Date: 2026-10-13. Platform: macOS, Apple Silicon. Version: 0.3.10.

## Delivered Behavior

- macOS skips tray creation. The Dock icon, application menu, windows, and existing mount cleanup remain available. Windows and Linux retain the existing tray code.
- Private previews and thumbnails use authenticated SDK reads through object-scoped, reference-counted loopback sessions. Sharing URLs require an explicit lifetime selection, validated in TypeScript and Rust from 1 through 604,800 integer seconds. Internal transfer signing is unchanged.
- File context menus and the Inspector open a shared metadata editor. Saves use same-key server-side copying, preserve untouched fields, check conflicts, and verify the result. Objects above 5 GiB remain viewable but cannot be saved by this editor.

## Automated Checks

| Check                                                 | Result                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Frontend formatting and TypeScript                    | Passed                                                                  |
| Bun tests                                             | 360 passed, 0 failed                                                    |
| Rust formatting                                       | Passed                                                                  |
| Clippy, workspace and all targets, warnings denied    | Passed                                                                  |
| Rust workspace tests                                  | 473 passed, 0 failed; 7 existing tests and 1 documentation test ignored |
| Production frontend export                            | Passed                                                                  |
| macOS release app and DMG, updater artifacts disabled | Passed                                                                  |
| DMG checksum verification                             | VALID                                                                   |

Fixture coverage includes byte ranges and invalid ranges, authenticated reads, shared preview leases, revoked sessions, invalid hosts, access denial, late frontend session creation after navigation, and shutdown. Metadata fixtures exercise the real AWS SDK for R2, AWS S3, MinIO, and RustFS interfaces: additions and removals, untouched headers, storage/encryption/ACL/tagging preservation requests, special-character keys, source and R2 destination conditions, conflicts, permissions failures, uncertain outcomes without copy replay, omitted metadata, and the 5 GiB boundary. Fixture content hashes remain unchanged across metadata copies.

The debug Rust test linker emitted a compact-unwind size warning. Tests completed successfully; Clippy and the release build passed.

## Native App Checks

An isolated application identifier and dummy MinIO account connected exclusively to an in-memory S3 fixture on `127.0.0.1`. No real account or bucket was used.

- Text, image, PDF, video, and audio viewers rendered the fixture content. Video and audio playback worked, media range requests reached the fixture, and image/video thumbnails appeared.
- The sharing dialog initially had no lifetime selected and generation was disabled. Explicitly selecting 15 minutes produced `X-Amz-Expires=900`, an expiration time, and enabled Copy URL / Open URL actions. The generated link was not externally opened.
- The grid context menu opened the metadata editor. Saving changed Content-Type and added a custom entry while preserving Cache-Control and an existing custom entry. Independent reads confirmed the before/after SHA-256 was identical: `d2aef157713c0872038663fa630e93c692d19d77e2fe3f199aa1b945e93c1673`.
- Browsing produced zero presigned query requests at the fixture. Private preview sources are separate from displayed sharing links.
- Normal application menu and window behavior remained available. The macOS tray creation branch is excluded at compile time.

An existing list-row context-menu event forwarding issue was repaired with a native wrapper and included in the final build. Its final native GUI recheck could not complete: after the Mac was unlocked, Computer Use repeatedly returned ScreenCaptureKit error `-3811` (audio/video capture failure), including after resetting the automation session. The final small change that pauses preview-navigation shortcuts while an object-action dialog is open passed frontend checks but was not independently rechecked in the native app.

The isolated app and fixture server were stopped. Their processes exited and the fixture port no longer listened.

## Artifacts and Limits

- App: `src-tauri/target/release/bundle/macos/r2.app`
- DMG: `src-tauri/target/release/bundle/dmg/r2_0.3.10_aarch64.dmg`

Build command:

```sh
DYLD_FALLBACK_LIBRARY_PATH="$(rustc --print sysroot)/lib:/usr/lib" NEXT_TELEMETRY_DISABLED=1 bun run tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Validation used local fixtures only, as requested. Live R2 writes and live AWS S3, MinIO, and RustFS compatibility were not verified. Unsupported preservation cases are rejected instead of silently discarding settings; no multipart metadata updates are included. No release was published and no existing remote object was modified.
