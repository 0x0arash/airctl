---
name: airctl
description: >-
  Diagnose and resolve local port conflicts, stale dev servers, and localhost
  service issues using AirCtl. Use when the user hits EADDRINUSE, "port already
  in use", cannot bind a dev server, asks what is on a port, needs to stop a
  local process safely, or when lsof/netstat/kill would otherwise be used for
  local development troubleshooting.
---

# AirCtl — Local Port & Dev Service Control

AirCtl discovers local development services, explains port occupancy with project context, and stops processes safely. Prefer it over raw `lsof`, `netstat`, or `kill -9` for local dev troubleshooting.

**Requires Node.js 22.14+.** No install needed: `npx airctl …`

## When to use

| Situation                                           | Start here                                   |
| --------------------------------------------------- | -------------------------------------------- |
| `EADDRINUSE`, port conflict, dev server won't start | `airctl explain :PORT`                       |
| "What's using port X?"                              | `airctl explain :PORT` or `airctl explain X` |
| Stale Vite/Next/Docker dev process                  | `airctl explain` → `airctl stop`             |
| Overview of local dev services                      | `airctl status`                              |
| Empty project roots / permission gaps               | `airctl doctor`                              |
| Need structured data for scripts                    | add `--json` to any query command            |

## Diagnostic workflow

Copy and track progress:

```
Port conflict task:
- [ ] 1. Explain the port
- [ ] 2. Report findings to the user (project, process, age, likely issue)
- [ ] 3. Stop only if the user asked to free the port
- [ ] 4. Re-check with explain or retry the dev server
```

### 1. Explain first

```bash
npx airctl explain :3000
# or, for machine parsing:
npx airctl explain :3000 --json
```

Read the output before stopping anything. AirCtl includes:

- Process name, PID, command line (redacted if secret-like)
- Project root when detectable
- How long the process has been running
- Classification (dev server, database, container, …)
- `likelyIssue` and suggested `actions`

Exit code **3** means the port is **free** (`occupied: false`).

### 2. Stop safely

Only stop when the user wants the port freed or explicitly asked to kill the blocker.

**Interactive terminal** (AirCtl prompts for confirmation):

```bash
npx airctl stop :3000
# or by PID / project name:
npx airctl stop 18472
npx airctl stop shop
```

**Non-interactive / agent sessions** — confirmation is required via flag:

```bash
npx airctl stop :3000 --yes
```

Without `--yes` in a non-TTY session, AirCtl exits **5** (`CONFIRMATION_REQUIRED`). Do not use `--yes` unless the user asked to stop the process.

Optional flags:

- `--force` — SIGKILL only when graceful stop fails (last resort)
- `--json` — `{ "stopped": [{ "pid", "ok", "signal", … }] }`

### 3. Verify

```bash
npx airctl explain :3000 --json
# occupied: false → port is free
```

## Safety rules

1. **Explain before stop** — never `kill -9` first when AirCtl is available.
2. **Confirm with the user** before `--yes`, unless they already asked to free the port or stop the service.
3. **No SIGKILL by default** — AirCtl sends a graceful signal; use `--force` only if graceful stop failed and the user agrees.
4. **Treat inference as inference** — `evidenceKind: "inferred"` and graph edges labeled inferred are guesses, not facts.
5. **Local dev only** — do not use AirCtl to manage production or remote servers.

## Machine-readable output

Always pass `--json` when parsing output programmatically. Logs never mix into JSON stdout.

| Command                | JSON shape                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `status --json`        | `{ version, scannedAt, summary, services, projects, warnings, … }` |
| `explain :PORT --json` | `{ port, occupied, process, project, likelyIssue, actions, … }`    |
| `stop … --json`        | `{ stopped: [...] }`                                               |
| `doctor --json`        | `{ checks, warnings, platform, nodeVersion }`                      |
| errors with `--json`   | `{ error: { code, message } }` on stdout                           |

Errors use structured codes: `CONFIRMATION_REQUIRED` (5), `PROCESS_NOT_FOUND` (3), `INVALID_INPUT` (2). See [reference.md](reference.md) for exit codes and field notes.

## Common scenarios

**Dev server fails with EADDRINUSE**

```bash
npx airctl explain :5173 --json
# Report: PID, project, command, likelyIssue
# If user wants it freed:
npx airctl stop :5173 --yes
```

**Nothing shows in status**

System listeners are hidden by default. Try:

```bash
npx airctl status --all
npx airctl doctor
```

**Docker / WSL port forwarding on Windows**

`explain` may show forwarded listeners (`forwarded` on sockets). Stop the owning process or container AirCtl identifies — not arbitrary proxy PIDs.

**Permission-limited CWD or process name**

Run `airctl doctor`. Report limitations honestly; do not invent project paths.

## Other useful commands

```bash
npx airctl status --json          # all dev services
npx airctl status --project shop  # filter by project
npx airctl inspect 18472 --json   # single process detail
npx airctl projects --json
npx airctl graph --json           # topology (observed vs inferred edges)
npx airctl scan                   # force fresh discovery
npx airctl ui                     # local web UI on 127.0.0.1:4114
```

Full command list and JSON field reference: [reference.md](reference.md)

## Install

```bash
npm install -g airctl   # optional; npx works without install
```

Install this skill:

```bash
npx skills add 0x0arash/airctl@airctl -y
```

Privacy: AirCtl is local-only — no telemetry, no cloud, no external API calls.
