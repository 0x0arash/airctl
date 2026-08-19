# AirCtl

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

[Install](#install) · [GitHub](https://github.com/0x0arash/airctl) · [Web UI](#web-ui)

---

## Why?

Developers constantly run into:

- `Error: EADDRINUSE :::3000`
- leftover Vite/Next servers from a forgotten terminal
- a Postgres container bound to `0.0.0.0`
- two projects that both want `:8080`

`lsof` and `netstat` answer "what is using port X?" badly. They don't tell you *which project*, *how long it's been running*, or *whether you can safely kill it*.

AirCtl does.

## What can it do?

```bash
airctl explain :3000     # what is using this port, and why?
airctl stop :3000        # stop it (asks first, never SIGKILL)
airctl status            # every development service on your machine
airctl status --watch    # live terminal dashboard
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

Requires **Node.js 22.14+**.

**Try instantly** — no install needed:

```bash
npx airctl
npx airctl explain :3000
```

**Install globally:**

```bash
npm install -g airctl
```

**From source:**

```bash
git clone https://github.com/0x0arash/airctl.git
cd airctl
npm install && npm run build
node dist/cli.js status
```

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
airctl status --watch  # terminal watch view
airctl version
```

Flags: `--json` `--quiet` `--verbose` `--watch` `--project` `--port` `--all` `--yes` `--force`.

JSON output is a single document. Logs never mix into `--json`.

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

Live updates use Server-Sent Events. The browser does not poll every second.

## How it works

```text
CLI / TUI / Web
        │
   Application core
        │
 Discovery ── Domain ── SQLite cache
   │
 OS / Docker / filesystem
```

AirCtl queries the OS for processes, sockets, working directories, and Docker containers, then correlates them into projects and services.

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

AirCtl will not present an inference as a fact.

## Permissions

AirCtl does **not** require root or Administrator. `airctl doctor` reports how complete the scan was.

## Privacy

AirCtl does not send your data anywhere.

- no cloud service, no telemetry, no analytics, no accounts, no external API calls

Environment variables are never displayed by default and never persisted. Command lines are redacted when they look like they contain secrets.

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

Locations: `./airctl.yaml` or the user config directory (`~/.config/airctl/config.yaml`, `%LOCALAPPDATA%\airctl\config.yaml`, `~/Library/Application Support/airctl/config.yaml`).

## Health checks

Conservative by design:

- TCP connect with a short timeout
- HTTP GET `/` only for likely HTTP development servers
- distinctive User-Agent `AirCtl/… (local-health-check)`
- no credentials, no form posts, no destructive methods

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

Minimum Node.js: **22.14**. `node:sqlite` is used as a local cache when available; AirCtl falls back to in-memory storage otherwise.

## Troubleshooting

**No services shown** — try `airctl status --all`. System listeners are hidden by default.

**Empty working directory / project** — permission limited. `airctl doctor` explains which collectors work.

**Docker integration unavailable** — expected if Docker is not installed. Not an error.

**Port already in use for the UI** — set `ui.port` in config.

## License

MIT
