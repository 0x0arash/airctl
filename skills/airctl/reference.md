# AirCtl reference

## CLI commands

```bash
airctl status [--json] [--all] [--project NAME] [--watch]
airctl explain <port> [--json]          # also: explain :3000
airctl stop <pid|:port|project> [--yes] [--force] [--json]
airctl inspect <pid> [--json]
airctl projects | services | graph [--json]
airctl scan | refresh
airctl doctor [--json]
airctl open <project> [--json]
airctl config [--json]
airctl ui
airctl version [--json]
```

Global flags: `--json` `--quiet` `--verbose` `--yes` `--force` `--all` `--project` `--port`

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| 0    | Success                                                      |
| 1    | Internal error                                               |
| 2    | Invalid input / unknown flag                                 |
| 3    | Not found (free port, missing process/project)               |
| 4    | Permission denied                                            |
| 5    | Confirmation required (non-interactive stop without `--yes`) |
| 6    | Unsupported / dependency unavailable                         |
| 7    | Timeout                                                      |

With `--json`, errors print `{ "error": { "code", "message" } }` to stdout.

## JSON: `explain`

```json
{
  "port": 3000,
  "occupied": true,
  "sockets": [
    {
      "address": "127.0.0.1",
      "port": 3000,
      "protocol": "tcp",
      "scope": "loopback",
      "forwarded": null
    }
  ],
  "process": {
    "pid": 18472,
    "executable": "node",
    "command": "npm run dev",
    "cwd": "/home/user/code/old-blog",
    "startedAt": "2026-08-19T10:00:00.000Z",
    "availability": "ok"
  },
  "project": {
    "id": "…",
    "root": "/home/user/code/old-blog",
    "name": "old-blog"
  },
  "classification": "development-server",
  "confidence": 0.9,
  "likelyIssue": "This appears to be a stale development server.",
  "actions": ["airctl stop 18472"]
}
```

Key fields:

- `occupied: false` — port is free (CLI exit 3)
- `evidenceKind` on nested `service` — `"observed"` | `"inferred"` | `"unknown"`
- `actions` — suggested next commands (informational)

## JSON: `status`

```json
{
  "version": 1,
  "scannedAt": "2026-08-19T12:00:00.000Z",
  "durationMs": 42,
  "summary": {
    "services": 3,
    "healthy": 3,
    "unhealthy": 0,
    "stopped": 0,
    "warning": 0,
    "unknown": 0,
    "orphaned": 0
  },
  "services": [
    {
      "id": "…",
      "name": "Vite",
      "projectId": "…",
      "processId": 1234,
      "ports": [5173],
      "classification": "development-server",
      "confidence": 0.85,
      "health": "healthy",
      "framework": { "name": "vite", "confidence": 0.9, "evidence": ["…"] },
      "evidenceKind": "observed"
    }
  ],
  "projects": [{ "id": "…", "name": "shop", "root": "/code/shop", "kind": null }],
  "warnings": [],
  "capabilities": { "processDiscovery": { "ok": true, "detail": "…" }, "platform": "linux" },
  "events": []
}
```

Use `--all` to include system services. Use `--project shop` to filter.

## JSON: `stop`

```json
{
  "stopped": [{ "pid": 18472, "ok": true, "signal": "SIGTERM" }]
}
```

## JSON: `doctor`

```json
{
  "platform": "win32",
  "nodeVersion": "v22.18.0",
  "checks": [
    { "name": "Process discovery", "ok": true, "detail": "…" },
    { "name": "Working directory inspection", "ok": true, "limited": true, "detail": "…" }
  ],
  "warnings": []
}
```

## Stop target resolution

| Target  | Example                     | Stops                        |
| ------- | --------------------------- | ---------------------------- |
| PID     | `stop 18472`                | That process                 |
| Port    | `stop :3000` or `stop 3000` | Listener(s) on port          |
| Project | `stop shop`                 | Dev services tied to project |

## Platform notes

| Area      | Linux           | macOS         | Windows                                    |
| --------- | --------------- | ------------- | ------------------------------------------ |
| Processes | `/proc`         | `ps` + `lsof` | CIM / `tasklist`                           |
| Sockets   | `/proc/net`     | `lsof`        | `netstat -ano`                             |
| CWD       | `/proc/pid/cwd` | `lsof -d cwd` | command-line inference, PEB when permitted |
| Forwards  | —               | —             | WSL, Hyper-V, `netsh portproxy`            |

When `availability` is `permission-limited` or `unsupported`, say so — do not guess missing fields.

## Config (optional)

Locations: `./airctl.yaml`, or user config dir (`~/.config/airctl/config.yaml`, `%LOCALAPPDATA%\airctl\config.yaml`, `~/Library/Application Support/airctl/config.yaml`).

```yaml
projects:
  roots:
    - ~/code
ui:
  port: 4114
```

## VS Code extension

If the user works in VS Code/Cursor with the AirCtl extension: sidebar tree view, **Explain Port** from editor context menu, **Stop Service** from tree. Setting `airctl.path` overrides binary location.
