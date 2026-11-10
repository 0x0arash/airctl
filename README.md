# AirCtl

[![npm version](https://badgen.net/npm/v/airctl)](https://www.npmjs.com/package/airctl) [![npm downloads](https://badgen.net/npm/dm/airctl)](https://www.npmjs.com/package/airctl) [![runtime deps](https://badgen.net/badge/runtime%20deps/0/green)](https://bundlephobia.com/package/airctl) [![license](https://badgen.net/github/license/0x0arash/airctl)](LICENSE) [![node](https://badgen.net/npm/node/airctl)](https://nodejs.org)

**What the hell is using port 3000?**

```bash
npx airctl explain :3000
```

```text
PORT 3000
────────────────────────────────────
● OCCUPIED

  node · PID 18472
  ~/code/old-blog
  npm run dev
  running for 2h 14m

  This is probably a stale development server.
```

```bash
npx airctl stop :3000
# ✓ stopped
```

![AirCtl in action](docs/images/demo.gif)

---

Your laptop has a network. AirCtl lets you **see it, understand it, and control it**.

![`npx airctl status` in a terminal](docs/images/status.svg)

[Install](#install) · [GitHub](https://github.com/0x0arash/airctl) · [Web UI](#web-ui) · [VS Code Extension](vscode-extension/)

---

## Why?

Developers constantly run into:

- `Error: EADDRINUSE :::3000`
- leftover Vite/Next servers from a forgotten terminal
- a Postgres container bound to `0.0.0.0`
- two projects that both want `:8080`

`lsof` and `netstat` answer "what is using port X?" badly. They don't tell you _which project_, _how long it's been running_, or _whether you can safely kill it_.

AirCtl associates listeners with projects and reports the evidence available on your platform. Linux currently omits process start times, so running age is unavailable there.

## What can it do?

```bash
airctl explain :3000     # what is using this port, and why?
airctl stop :3000        # stop it (asks first; SIGTERM by default)
airctl status            # every development service on your machine
airctl status --fast     # quick inventory without health probes or Docker
airctl tui               # interactive terminal dashboard
airctl status --watch    # alias for the terminal dashboard
airctl ui                # local web UI
```

```text
AIRCTL — LOCAL DEVELOPMENT

3 services
3 healthy

PROJECT          SERVICE       PORT        STATUS

shop             Vite          5173        ● healthy
shop             api           8080        ● healthy
shop             Postgres      5432        ● healthy
```

![AirCtl web UI overview](docs/images/ui.svg)

## Install

Requires **Node.js 22.14+**. The published package has **zero runtime npm dependencies** — `npm install -g airctl` installs only AirCtl (the web UI is bundled at build time).

**Try instantly** — no install needed:

```bash
npx airctl
npx airctl explain :3000
```

**Install globally:**

```bash
npm install -g airctl
```

On Linux (including Arch), discovery reads `/proc` directly; `lsof` and `netstat` are not required. Processes owned by other users may have limited details. Opening project folders requires `xdg-open` and a desktop session.

On Linux, if `airctl` exits silently, check `airctl --version`. Older releases could skip startup when invoked through a global-install symlink. Version 0.1.5 fixes this startup check; the command works through npm and Bun command symlinks. To diagnose an older installation, run its resolved entry point directly:

```bash
node "$(readlink -f "$(command -v airctl)")" --version
node "$(readlink -f "$(command -v airctl)")" doctor
```

**From source:**

```bash
git clone https://github.com/0x0arash/airctl.git
cd airctl
npm install && npm run build
node dist/cli.js status
```

## Agent support

AirCtl ships an [agent skill](skills/airctl/SKILL.md) that teaches coding agents to diagnose port conflicts and stop local dev services safely — prefer `airctl explain` over `lsof`/`kill -9`, use `--json` for parsing, and require `--yes` before stopping in non-interactive sessions.

```bash
npx skills add https://github.com/0x0arash/airctl --skill airctl
```

The [skills installer](https://github.com/vercel-labs/skills#install-a-skill) has its own Node.js requirement (currently 22.20+); AirCtl itself requires 22.14+. The repository owner is `0x0arash`; the npm package is the unscoped `airctl`.

The skill is also bundled in the npm package under `skills/airctl/` for tools that discover skills from dependencies.

## CLI reference

```bash
airctl                 # same as status
airctl status          # discover local services
airctl status --json   # stable machine-readable output
airctl scan            # force a fresh scan
airctl explain :3000   # why this port is occupied
airctl inspect <pid>
airctl projects
airctl services
airctl graph           # topology (observed connections vs inferred)
airctl open <project>  # open the project directory
airctl stop <pid>      # asks first; never SIGKILL by default
airctl stop :3000      # stop whoever owns the port
airctl stop shop       # stop that project's development services
airctl complete bash   # print a shell completion script
airctl refresh
airctl doctor
airctl config
airctl ui              # local web UI on 127.0.0.1
airctl status --watch  # interactive terminal dashboard
airctl tui             # search, project filter, details, confirmed stop
airctl version
```

Filtered status output recomputes counts and warnings for the selected services. `--all` includes system services in both rows and totals. Activity events remain the global discovery history.

Flags: `--fast` `--json` `--quiet` `--verbose` `--watch` `--project` `--port` `--all` `--yes` `--force`.

Query commands and `stop` support `--json`; logs go to stderr. `ui`, `tui`, and shell completion output are not JSON. Use `--port` with `explain` or `stop`; it does not filter `status`. `--force` sends SIGKILL immediately on Unix (or `taskkill /F` on Windows), so use it only when forceful termination is intended. If graceful termination times out, `stop` exits with code 7 and reports `stopped: false` in JSON; it does not claim the process stopped.

**Shell completions:**

```bash
# bash
eval "$(airctl complete bash)"
# zsh
eval "$(airctl complete zsh)"
# fish
airctl complete fish | source
# powershell
airctl complete powershell | Out-String | Invoke-Expression
```

## Web UI

```bash
airctl ui
```

Binds to `127.0.0.1:4114` by default. Views: overview, services, projects, topology graph, port/process inspector, warnings, activity.

Live updates use Server-Sent Events. The browser does not poll every second. The printed URL includes a session token; use that complete URL when opening the UI manually. Treat it as a local control credential.

## Terminal dashboard

Run `airctl tui` or `airctl status --watch`. Inventory appears without waiting for Docker or HTTP checks. The dashboard groups services by project and supports:

| Key                  | Action                                               |
| -------------------- | ---------------------------------------------------- |
| `↑` / `↓`, `j` / `k` | Select a service                                     |
| `/`                  | Search by port, project, PID, name, or health        |
| `p`                  | Cycle project filters                                |
| `Enter`              | Toggle process and project details                   |
| `s`                  | Request a graceful stop; `y` confirms, `Esc` cancels |
| `r`                  | Refresh                                              |
| `h`                  | Toggle health checks and Docker enrichment           |
| `a`                  | Include system services                              |
| `Esc`                | Leave details or clear search                        |
| `q`, `Ctrl+C`        | Quit and restore the terminal                        |

`running` means a listener was found but health has not been probed. It is counted separately from `healthy`. When output is redirected, the TUI prints one plain fast snapshot instead of terminal control sequences.

For repeatable local timing, run `npm run bench`. It reports three-sample command medians using the built CLI, without npm installer overhead. `--verbose` also reports discovery-stage durations on stderr. Docker discovery uses one running-container listing with a one-second budget; `doctor` reports a timeout as limited availability.

## VS Code Extension

Browse and control your local services without leaving the editor.

```bash
cd vscode-extension
npm install
npm run compile
npm run package
code --install-extension ./airctl-vscode-*.vsix
```

Published extension releases are available on [Open VSX](https://open-vsx.org/extension/0x0arash/airctl-vscode). The extension keeps one private discovery session per editor window and shares pushed snapshots across the sidebar, status bar, search, and actions. The status bar shows freshness; interrupted connections retain the last result with a stale indicator and reconnect automatically. Manual refresh requests a scan, while port explanations and stops inspect live state. See the [session protocol](docs/session-protocol.md). Older CLIs fall back to compatibility polling.

The extension uses fast inventory by default (enable `airctl.detailedDiscovery` for Docker and health probes); `running` does not imply a successful health probe. It needs the CLI installed globally or configured through `airctl.path`; running `npx airctl` once does not put it on PATH.

- **Find Service** — search by port, project, PID, or name; open localhost, copy an endpoint, reveal the project, explain, or stop
- **Terminal Dashboard** — launch the interactive TUI using the configured CLI
- **Status bar** — service count at a glance
- **Sidebar tree view** — projects, services, and ports in the activity bar
- **Explain Port** — right-click a port in your code or use the command palette
- **Stop Service** — stop a service directly from the tree view

Settings: `airctl.path` (binary path, auto-detected by default), `airctl.refreshInterval` (scanner interval in seconds), and `airctl.detailedDiscovery` (include Docker and health checks).

See the [extension README](vscode-extension/README.md) for details.

## How it works

```text
CLI / TUI / Web / VS Code
        │
   Application core
        │
 Discovery ── Domain ── SQLite cache
   │
 OS / Docker / filesystem
```

AirCtl queries the OS for processes, sockets, working directories, and Docker containers, then correlates them into projects and services. Running containers remain visible even when Docker publishes ports through NAT without a host listener. Such containers have no host PID to stop; AirCtl does not terminate containers through Docker.

| Area      | Linux                      | macOS              | Windows                                                       |
| --------- | -------------------------- | ------------------ | ------------------------------------------------------------- |
| Processes | `/proc`                    | `ps` + `lsof`      | CIM / `tasklist`                                              |
| Sockets   | `/proc/net/tcp{,6}` + UDP  | `lsof` TCP/UDP     | `netstat -ano` (TCP, UDP, IPv6)                               |
| CWD       | `/proc/pid/cwd`            | `lsof -d cwd`      | command-line inference, then PEB for listeners when permitted |
| Forwards  | —                          | —                  | WSL/`wslrelay`, Hyper-V, `netsh interface portproxy`          |
| Graph     | established TCP in `/proc` | `lsof` ESTABLISHED | `netstat` ESTABLISHED to localhost                            |

If something cannot be inspected, AirCtl degrades gracefully — `Permission limited`, `Unavailable on this platform`, or `Unknown`. It does not crash the scan.

### Inference vs observation

Topology edges and framework guesses are labeled:

- **Observed** — process/socket/project evidence from the OS
- **Inferred** — likely relationships (Compose, typical frontend→api→db)
- **Unknown** — not enough signal

Framework and port-based classifications are inferred, regardless of confidence. A shared Compose project produces an inferred association, not evidence of communication. Observed TCP edges require OS connection evidence.

## Permissions

AirCtl does **not** require root or Administrator. `airctl doctor` reports how complete the scan was.

## Privacy

AirCtl keeps discovery data in the local process and cache; it does not upload it to a hosted service.

- no cloud service, telemetry, analytics, or accounts
- health checks connect to discovered services; HTTP checks follow redirects, which may reach external hosts
- package and skill installation use their registries and hosting services
- zero runtime npm dependencies — no transitive package tree to audit or supply-chain surprises

AirCtl does not collect complete process environments. Collected command lines are redacted when they look like they contain secrets and may be stored in the local discovery cache.

## Security

The local HTTP API is not "safe because it is localhost."

- loopback bind only (`127.0.0.1`)
- origin checks
- mutating routes require a random session token
- no arbitrary filesystem reads through the API
- process stop is explicit and rate-limited
- never interpolates user input into a shell

See [SECURITY.md](SECURITY.md).

## Configuration

Optional. Defaults work.

```yaml
scan:
  interval: adaptive
health:
  enabled: true
projects:
  roots:
    - ~/code
ui:
  openBrowser: true
  port: 4114
security:
  bind: 127.0.0.1
```

Configuration values are validated: numeric scan intervals are milliseconds (1000–2147483647), UI ports are 1–65535, and `events.limit` is 1–10000. Unknown keys and malformed values produce `INVALID_INPUT`. YAML supports nested sections and a `projects.roots` list; JSON is also accepted. `security.bind` accepts only loopback hosts. The legacy `ui.bind` alias is supported when it agrees with `security.bind`.

Locations: `./airctl.yaml` or the user config directory (`~/.config/airctl/config.yaml`, `%LOCALAPPDATA%\airctl\config.yaml`, `~/Library/Application Support/airctl/config.yaml`).

## Health checks

Conservative by design:

- TCP connect with a short timeout
- HTTP GET `/` only for likely HTTP development servers
- distinctive User-Agent `AirCtl/… (local-health-check)`
- no credentials, no form posts, no destructive methods
- HTTP timeout or connection failure marks a likely HTTP service unhealthy, even if TCP accepts connections

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npx tsx src/cli.ts status
```

Linting uses **oxlint**, formatting uses **oxfmt**. Git hooks are managed with **lefthook**; commit messages are checked with **commitlint**.

Tests use fake process/socket/filesystem providers. They do not require Docker.

Minimum Node.js: **22.14**. `node:sqlite` stores the last discovery snapshot and recent activity when available; AirCtl falls back to in-memory storage otherwise, and `doctor` reports that limitation. Each query command performs fresh discovery scoped to its task. `explain` inspects the requested port and its owners; PID inspection and stopping bypass unrelated discovery. `status --fast` skips Docker, health probes, and established TCP collection. The stored snapshot provides the baseline for change events across invocations; `logs` reads stored activity without scanning. `scan` and `refresh` explicitly request the same fresh discovery pipeline.

## Troubleshooting

**No services shown** — try `airctl status --all`. System listeners are hidden by default.

**Empty working directory / project** — permission limited. `airctl doctor` explains which collectors work.

**Docker integration unavailable** — expected if Docker is not installed. Not an error.

**Port already in use for the UI** — set `ui.port` in config.

## License

MIT
