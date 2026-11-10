# AirCtl for VS Code

See and control your local development services directly from VS Code.

## Features

Use **AirCtl: Find Service** to search by port, project, PID, or name. Selecting a service offers explain, open localhost, copy address, reveal project, and confirmed stop actions. **AirCtl: Open Terminal Dashboard** launches the interactive TUI using the same configured CLI.

- **Status bar** — shows the number of active services at a glance.
- **Sidebar tree view** — browse projects, services, and ports in the activity bar.
- **Explain port** — right-click a port number in your code (or use the command palette) to see what's using it.
- **Stop service** — stop a service directly from the tree view.

Fast inventory skips Docker and health probes. Enable `airctl.detailedDiscovery` to include them (with slower refreshes). `running (not probed)` means a listener exists, not that an HTTP health check passed. Ports are visible beside each sidebar service, and a transient refresh failure keeps the last successful inventory visible.

## Live discovery

One private CLI session per editor window serves the sidebar, status bar, search, and commands. Updates arrive through stdio; ordinary reads use the latest snapshot without launching another process. Refresh forces a scan. Explanations and stops still query live process state.

The status bar shows the last scan time and marks retained results stale while reconnecting. Settings changes restart the session; closing the extension shuts down its owned process. Stop requests are never replayed after a disconnect.

AirCtl 0.2.0+ supports live sessions. Older CLIs fall back to polling, including ordinary status output if `--fast` is unavailable.

## Requirements

Install the CLI with `npm install -g airctl` (Node.js 22.14+) and make it available on the editor’s PATH, or set `airctl.path` to its executable. Use AirCtl 0.2.0+ for fast inventory, the interactive TUI, and live sessions. Running `npx airctl` once does not install a persistent command for the extension. During development, the extension can detect a built CLI in the AirCtl checkout containing the extension. It does not execute workspace `dist/cli.js` files. Executable settings are machine-scoped, and the extension requires a trusted workspace.

## Settings

| Setting                  | Default | Description                                                        |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `airctl.path`            | `""`    | Empty means auto-detect; otherwise the path to the CLI executable. |
| `airctl.refreshInterval` | `10`    | Refresh interval for the sidebar and status bar, in seconds.       |

## Development

```bash
cd vscode-extension
npm install
npm run compile
npm run package
code --install-extension ./airctl-vscode-*.vsix
```

Build the root project with `npm run build` first when using the local CLI. Published extension releases are available on [Open VSX](https://open-vsx.org/extension/0x0arash/airctl-vscode).

Free ports are shown as **FREE**. A stop timeout is reported as still running, rather than as a successful stop. Changing either setting restarts refresh with the new configuration.
