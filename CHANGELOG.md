# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] — 2026-08-19

### Added

- **VS Code extension** (`vscode-extension/`): status bar with service count, sidebar tree view (projects/services/ports), "Explain Port" command with editor context menu, and "Stop Service" action. Auto-detects the local CLI build; falls back to a global `airctl` install.
- Release workflow now publishes the VS Code extension to Open VSX alongside the npm package.

## [0.1.2] — 2026-08-19

### Added

- `npx airctl` install path, shell completions (`bash`/`zsh`/`fish`/`powershell`), and README screenshots.
- `airctl stop :3000` and `airctl stop <project>` in addition to stopping by PID.
- Observed localhost TCP connections in topology (labeled separately from inferred edges).
- Windows working-directory recovery from command lines and, for listeners, process PEB when permitted.
- Windows UDP listeners, `netstat` established sockets, and WSL/Hyper-V/portproxy attribution.
- GitHub Actions release workflow that publishes to npm on `v*` tags.

### Fixed

- Version string is sourced from `src/version.ts` (CLI, User-Agent, and doctor stay in sync).

## [0.1.0] — 2026-08-18

### Added

- Initial AirCtl release: local process and socket discovery, project detection, service classification, topology inference, health checks, orphan and port-conflict warnings, CLI, watch TUI, loopback web UI, SQLite cache, and doctor.
- Developer tooling: oxlint, oxfmt, lefthook, and commitlint (conventional commits).
