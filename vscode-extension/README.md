# AirCtl for VS Code

See and control your local development services directly from VS Code.

## Features

- **Status bar** — shows the number of active services at a glance.
- **Sidebar tree view** — browse projects, services, and ports in the activity bar.
- **Explain port** — right-click a port number in your code (or use the command palette) to see what's using it.
- **Stop service** — stop a service directly from the tree view.

## Requirements

The `airctl` CLI must be available on your PATH (install with `npm install -g airctl` or use `npx airctl`).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `airctl.path` | `airctl` | Path to the airctl binary. |
| `airctl.refreshInterval` | `10` | Auto-refresh interval in seconds. |

## Development

```bash
cd vscode-extension
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host.
