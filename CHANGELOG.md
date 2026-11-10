# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Fast inventory (`--fast`), discovery-stage timings, and a repeatable command benchmark.
- Interactive terminal dashboard with search, project filters, process details, optional health/Docker checks, and confirmed graceful stops.
- Extension service search and actions for explaining ports, opening localhost, copying endpoints, revealing projects, and launching the TUI.

### Changed

- Scope port queries to listener owners and inspect/stop PIDs without full discovery; avoid the extra doctor scan.
- List project directory markers once per scan, memoize ancestor reads, and bound filesystem concurrency.
- Query Docker once with a one-second budget; skip optional discovery in the extension and terminal inventory.
- Distinguish running listeners from checked healthy services; retain sidebar data during transient errors.

## [0.1.8] — 2026-11-10

### Fixed

- Accept both array and package-keyed npm pack JSON results in the packaged artifact smoke test, and cover the latest npm release in CI.
- Install the extension compiler independently, check isolated extension installs before root dependencies, and allow extension-only publication retries.
- Includes all 0.1.7 changes below. The 0.1.7 release validation failed before publication; its existing Git tag is retained.

## [0.1.7] — 2026-11-10 (not published)

### Fixed

- Redact mixed and quoted credentials, render fallback service names as text, and prevent stale inspector requests from targeting another process.
- Stop automatically executing workspace CLI files in the extension; restrict executable settings to the machine and require trusted workspaces.
- Serve the bundled React UI from installed packages and print the complete authenticated URL.
- Repair Windows process field separators, timestamps, permission reporting, and observed working-directory recovery.
- Report stop timeouts accurately in the CLI, web UI, and editor extension; handle free-port JSON responses in the extension.
- Mark HTTP timeouts unhealthy, cancel probe response bodies, and label framework guesses and Compose associations as inferred.
- Preserve case-sensitive project identities, correlate Docker addresses and protocols, and retain running containers without host sockets.
- Synchronize scans, restore persisted event baselines, report SQLite fallback accurately, and stop discovery loops cleanly.
- Recompute filtered service summaries and warnings, validate configuration, refresh the extension sidebar, and update activity through SSE.
- Add packaged CLI/web smoke tests, native Windows regression coverage, and extension checks to CI.
- Clarify Linux process-age limitations, cache semantics, configuration constraints, and immediate force termination.

## [0.1.6] — 2026-11-07

### Fixed

- Correct bundled skill documentation for numeric PID versus port targets, immediate force termination, stop-result fields, and Linux process-age availability.
- Clarify skill installation with an explicit GitHub source and skill selector, including the installer's separate Node.js requirement.
- Correct extension installation and packaging instructions, CLI PATH requirements, and the empty `airctl.path` default.
- Clarify JSON support, port-option scope, health-check redirects, and local command-line caching.

### Changed

- Update development tooling: esbuild, commitlint, and CI checkout/setup-node actions. Correct CI's commit selection for older pull requests.

## [0.1.5] — 2026-11-07

### Fixed

- Resolve CLI entry-point symlinks so global npm/Bun commands run on Linux, including Arch.
- Validate CLI options and stop PIDs, report unreadable explicit config files and inaccessible port owners, preserve JSON errors during startup, and report failed desktop openers.
- Allow command output to drain before exiting.

## [0.1.4] — 2026-08-19

### Added

- **Agent skill** (`skills/airctl/`): installable skill for coding agents — port-conflict diagnostics, safe stop workflow, and `--json` reference. Install with `npx skills add https://github.com/0x0arash/airctl --skill airctl`.

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
