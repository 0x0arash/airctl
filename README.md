# AirCtl

Air traffic control for localhost.

Your laptop has a network. AirCtl lets you see and control it.

AirCtl discovers what is running on your machine, figures out which processes and projects own which ports, and gives you a fast CLI plus a local web UI to inspect and control your development environment.

It is **not** a generic port scanner, reverse proxy, or another dashboard. It answers:

> What is happening on my machine, what caused it, and what can I do about it?

## Why it exists

Developers constantly run into:

- “What is using port 3000?”
- leftover Vite/Next servers from a forgotten terminal
- a Postgres container bound to `0.0.0.0`
- two projects that both want `:8080`

`lsof` and `netstat` answer the first question badly. AirCtl answers the rest.

## Quick start

Requires **Node.js 22.14+**.

```bash
npm install
npm run build
node dist/cli.js status
```

After a global install:

```bash
npm install -g airctl
airctl
airctl status
airctl explain 3000
```

Example:

```text
AIRCTL — LOCAL DEVELOPMENT

3 services
3 healthy

PROJECT          SERVICE       PORT        STATUS

shop             Vite          5173        ● healthy
shop             api           8080        ● healthy
shop             Postgres      5432        ● healthy
```

## CLI

```bash
airctl                 # same as status
airctl status          # discover local services
airctl status --json   # stable machine-readable output
airctl scan            # force a fresh scan
airctl explain :3000   # why this port is occupied
airctl inspect <pid>
airctl projects
airctl services
airctl graph           # inferred topology (labeled inferred vs observed)
airctl open <project>  # open the project directory
airctl stop <pid>      # asks first; never SIGKILL by default
airctl refresh
airctl doctor
airctl config
airctl ui              # local web UI on 127.0.0.1
airctl status --watch  # terminal watch view
airctl version
```

Flags: `--json` `--quiet` `--verbose` `--watch` `--project` `--port` `--all` `--yes` `--force`.

JSON output is a single document. Logs never mix into `--json`.

## Web UI

```bash
airctl ui
```

Binds to `127.0.0.1:4114` by default. Views: overview, services, projects, topology graph, port/process inspector, warnings, activity.

Live updates use Server-Sent Events. The browser does not poll every second.

## Architecture

```text
CLI / TUI / Web
        │
   Application core
        │
 Discovery ── Domain ── SQLite cache
   │
 OS / Docker / filesystem
```

Domain logic does not depend on React. The CLI does not contain discovery rules. The UI consumes `/api/v1`.

Platform backends:

| Area      | Linux               | macOS         | Windows                                    |
| --------- | ------------------- | ------------- | ------------------------------------------ |
| Processes | `/proc`             | `ps` + `lsof` | CIM / `tasklist`                           |
| Sockets   | `/proc/net/tcp{,6}` | `lsof`        | `netstat -ano`                             |
| CWD       | `/proc/pid/cwd`     | `lsof -d cwd` | often unavailable without extra privileges |

If something cannot be inspected, AirCtl degrades: `Permission limited`, `Unavailable on this platform`, or `Unknown`. It does not crash the scan.

## Permissions

AirCtl does **not** require root or Administrator. Some process fields (especially working directories on macOS/Windows) may be incomplete without extra access. `airctl doctor` reports this.

## Privacy

AirCtl does not send your process, project, or network data anywhere.

- no cloud service
- no telemetry
- no analytics
- no accounts
- no external API calls

Environment variables are never displayed by default and never persisted. Command lines are redacted when they look like they contain secrets.

## Security

The local HTTP API is not “safe because it is localhost.”

- loopback bind only (`127.0.0.1`)
- origin checks
- mutating routes require a random session token
- no arbitrary filesystem reads through the API
- process stop is explicit and rate-limited
- never interpolates user input into a shell

See [SECURITY.md](SECURITY.md).

## Health checks

Conservative by design:

- TCP connect with a short timeout
- HTTP GET `/` only for likely HTTP development servers
- distinctive User-Agent `AirCtl/… (local-health-check)`
- no credentials, no form posts, no destructive methods

## Inference vs observation

Topology edges and framework guesses are labeled:

- **Observed** — process/socket/project evidence from the OS
- **Inferred** — likely relationships (Compose, typical frontend→api→db)
- **Unknown** — not enough signal

AirCtl will not present an inference as a fact.

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

Minimum Node.js: **22.14**. `node:sqlite` is used as a local cache when available; AirCtl falls back to in-memory storage otherwise. The OS remains the source of truth for live processes and sockets.

## Troubleshooting

**No services shown** — try `airctl status --all`. System listeners are hidden by default.

**Empty working directory / project** — permission limited. `airctl doctor` explains which collectors work.

**Docker integration unavailable** — expected if Docker is not installed. Not an error.

**Port already in use for the UI** — set `ui.port` in config.

## License

MIT
