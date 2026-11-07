# AirCtl for VS Code

See and control your local development services directly from VS Code.

## Features

- **Status bar** — shows the number of active services at a glance.
- **Sidebar tree view** — browse projects, services, and ports in the activity bar.
- **Explain port** — right-click a port number in your code (or use the command palette) to see what's using it.
- **Stop service** — stop a service directly from the tree view.

## Requirements

Install the CLI with `npm install -g airctl` (Node.js 22.14+) and make it available on the editor’s PATH, or set `airctl.path` to its executable. Running `npx airctl` once does not install a persistent command for the extension. During development, the extension can also detect a built local CLI.

## Settings

| Setting                  | Default | Description                                                        |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `airctl.path`            | `""`    | Empty means auto-detect; otherwise the path to the CLI executable. |
| `airctl.refreshInterval` | `10`    | Auto-refresh interval in seconds.                                  |

## Development

```bash
cd vscode-extension
npm install
npm run compile
npm run package
code --install-extension ./airctl-vscode-*.vsix
```

Build the root project with `npm run build` first when using the local CLI. Published extension releases are available on [Open VSX](https://open-vsx.org/extension/0x0arash/airctl-vscode).
