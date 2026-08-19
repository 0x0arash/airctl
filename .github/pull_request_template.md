## Summary

<!-- What changed and why? Keep this to 1–3 sentences. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing behavior to change)
- [ ] Documentation only
- [ ] Refactor / chore (no user-facing change)

## Related issues

<!-- Link issues this closes, e.g. Fixes #123 -->

## Changes

<!-- Bullet list of the main changes. Focus on behavior, not file names. -->

-

## Test plan

<!-- How did you verify this works? Check all that apply and add notes. -->

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint` / `npm run format:check`
- [ ] Manual CLI verification (`npx tsx src/cli.ts …` or `node dist/cli.js …`)
- [ ] Web UI tested (if applicable)
- [ ] VS Code extension tested (if applicable)
- [ ] Cross-platform consideration noted (Windows / macOS / Linux)

**Manual steps:**

1.

## Screenshots / recordings

<!-- Required for UI, TUI, or VS Code extension changes. -->

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …)
- [ ] `CHANGELOG.md` updated (if user-facing)
- [ ] Tests added or updated for parsers, detectors, or non-trivial logic
- [ ] No new dependencies without justification in the PR description
- [ ] No telemetry, cloud calls, or secret logging introduced
- [ ] Domain logic kept out of React and CLI formatting layers
