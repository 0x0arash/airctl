# Contributing to AirCtl

Thanks for helping. AirCtl should stay **fast, trustworthy, and locally private**.

## Development

1. Install Node.js 22.14+.
2. `npm install` (installs lefthook git hooks)
3. `npm test`
4. `npm run typecheck`
5. `npm run lint` / `npm run format`
6. `npx tsx src/cli.ts status`

`npm install` installs [lefthook](https://github.com/evilmartians/lefthook) git hooks. Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …). Pre-commit runs `oxfmt` and `oxlint` on staged files.

## Project layout

- `src/domain` — types, errors, events, redaction
- `src/process`, `src/network` — platform discovery
- `src/projects`, `src/detectors`, `src/classification` — inference
- `src/engine` — orchestration
- `src/cli`, `src/tui`, `src/server`, `web` — presentation
- `vscode-extension` — VS Code extension (separate `package.json`, bundled with esbuild)

Keep domain logic out of React and out of CLI formatting.

## Rules of the road

- No telemetry, no cloud, no secret logging.
- Prefer Node built-ins; runtime dependencies should stay at zero.
- Never `exec` interpolated strings. Spawn argument arrays.
- Treat process disappearance as normal, not fatal.
- Label inference as inferred.
- Prefer tests with fixtures and fakes over live-OS tests.
- New detectors go in `src/detectors` as modules registered on `DetectorRegistry`.
- `eval "$(airctl complete bash)"` (or `zsh` / `fish` / `powershell`) installs completions.

## Pull requests

- Keep them small and reviewable.
- Include tests for parsers and detectors.
- Update `CHANGELOG.md`.
- Do not add dependencies without explaining why the standard library is insufficient.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
