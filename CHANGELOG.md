# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Loopback-only guard on `/__agent`, `/__undo`, `/__redo` (opt out via `allowRemote: true`).
- `eslint.config.js`, GitHub Actions CI (lint/typecheck/test/build + example-app build).
- Unit tests for the stamp plugin and the agent's git-snapshot undo/redo + syntax-revert logic.
- `examples/vite-react` — a minimal end-to-end smoke-test app.

## 0.1.0

Initial extraction from the `click-to-source` / agent-panel tool built in
[tjcages/socials](https://github.com/tjcages/socials), generalized into a standalone package:

- `visualCursor(options)` — Vite plugin bundle (`clickToSourceStamp` + `cursorAgent`).
- `<VisualCursor />` (from `visual-cursor/client`) — the ⌘-hover/click overlay + composer.
