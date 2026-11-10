# Private discovery sessions

`airctl session --json --fast` starts a parent-owned discovery process. It reads one JSON request per line from stdin and writes one JSON frame per line to stdout. Logs stay on stderr. This transport opens no HTTP listener and writes no authentication token to disk. Closing stdin or sending SIGTERM/SIGINT shuts the session down after pending work finishes.

The VS Code extension starts one session per editor window and shares it between the status bar, sidebar, search, and actions. The TUI and web UI already keep their own engines alive; they do not attach to the editor's process. This is not a machine-wide daemon.

## Frames

The server first emits:

```json
{ "type": "ready", "protocol": 1 }
```

It performs an initial scan and then scans every ten seconds by default. `--fast` skips Docker enrichment, health probes, and established TCP collection. Omit it for full discovery. Each completed scan emits a status payload with a scan timestamp:

```json
{
  "type": "snapshot",
  "data": { "version": 1, "scannedAt": "…", "services": [], "projects": [], "summary": {} }
}
```

The data follows `airctl status --json`, including capabilities, warnings, events, and summary fields. The example above is abbreviated. Cached reads retain the original `scannedAt`; they do not pretend that another scan happened.

## Requests

Every request requires a unique string `id` (1–128 characters). Up to 32 requests may be pending. Request lines are limited to 64 KiB; the editor rejects response frames larger than 8 MiB.

| Method      | Additional fields      | Result                                                         |
| ----------- | ---------------------- | -------------------------------------------------------------- |
| `status`    | —                      | Latest snapshot, or a shared initial scan if none exists       |
| `refresh`   | —                      | Fresh scan; concurrent refreshes share the work                |
| `configure` | `intervalMs`           | Set scan interval, integer 1000–2147483647                     |
| `explain`   | `port`                 | Fresh listener-owner lookup, independent of cached inventory   |
| `inspect`   | `pid`                  | Fresh process inspection                                       |
| `stop`      | `pid`, `confirm: true` | Graceful termination results, followed by an inventory refresh |

Example:

```json
{ "id": "request-1", "method": "explain", "port": 3000 }
```

Successful replies contain `result`:

```json
{
  "type": "response",
  "id": "request-1",
  "result": { "port": 3000, "occupied": false, "sockets": [], "actions": [] }
}
```

Errors contain the same codes as CLI errors:

```json
{
  "type": "response",
  "id": "request-2",
  "error": { "code": "CONFIRMATION_REQUIRED", "message": "A stop request requires confirm: true." }
}
```

Scan errors without a request ID use `type: "error"`. Oversized requests close the session. Malformed JSON or IDs produce a protocol error without executing an action. Slow readers apply backpressure to scans; EOF can still close a blocked writer.

## Editor lifecycle

The extension displays the last successful result as stale when discovery or the connection fails. It reconnects with backoff, replacing the stale result only after receiving a valid snapshot. The tree uses stable project/service/port IDs to preserve expansion and selection across updates.

Pending requests fail on disconnect or timeout. Stop requests are never replayed automatically: if a connection is lost during termination, the caller must inspect the live process before deciding whether to try again. There is no session method for force termination.

Settings changes replace the owned process. Deactivation closes its stdin and cancels reconnection. If the owned helper has not exited after five seconds, the extension terminates that helper (and its shim tree on Windows); discovered services are not part of this cleanup. Older CLIs that reject `session` use compatibility polling; CLIs that also reject `--fast` use ordinary `status --json` until upgraded.
