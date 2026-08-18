export interface CliFlags {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  watch: boolean;
  all: boolean;
  yes: boolean;
  force: boolean;
  help: boolean;
  version: boolean;
  project?: string;
  port?: string;
  config?: string;
}

export interface CliRequest {
  command: string;
  args: string[];
  flags: CliFlags;
}

const FLAG_ALIASES: Record<string, keyof CliFlags | "arg"> = {
  "--json": "json",
  "--quiet": "quiet",
  "-q": "quiet",
  "--verbose": "verbose",
  "-v": "verbose",
  "--watch": "watch",
  "-w": "watch",
  "--all": "all",
  "-a": "all",
  "--yes": "yes",
  "-y": "yes",
  "--force": "force",
  "--help": "help",
  "-h": "help",
  "--version": "version",
};

export function parseArgv(argv: string[]): CliRequest {
  const flags: CliFlags = {
    json: false,
    quiet: false,
    verbose: false,
    watch: false,
    all: false,
    yes: false,
    force: false,
    help: false,
    version: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    const alias = FLAG_ALIASES[token];
    if (alias && alias !== "arg") {
      flags[alias] = true as never;
      continue;
    }
    if (token.startsWith("--project=")) {
      flags.project = token.slice("--project=".length);
      continue;
    }
    if (token === "--project") {
      flags.project = argv[++i];
      continue;
    }
    if (token.startsWith("--port=")) {
      flags.port = token.slice("--port=".length);
      continue;
    }
    if (token === "--port") {
      flags.port = argv[++i];
      continue;
    }
    if (token.startsWith("--config=")) {
      flags.config = token.slice("--config=".length);
      continue;
    }
    if (token === "--config") {
      flags.config = argv[++i];
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown flag: ${token}`);
    }
    rest.push(token);
  }
  const command = rest[0] ?? "status";
  return { command, args: rest.slice(1), flags };
}

export const COMMANDS = [
  "status",
  "scan",
  "explain",
  "inspect",
  "projects",
  "services",
  "graph",
  "open",
  "stop",
  "refresh",
  "doctor",
  "config",
  "version",
  "ui",
  "tui",
  "logs",
  "help",
  "complete",
] as const;

export function helpText(): string {
  return `AirCtl — air traffic control for localhost

Usage:
  airctl [command] [options]

Commands:
  status                 Discover and show local services (default)
  scan                   Force a fresh discovery scan
  explain <port>         Explain what owns a port
  inspect <pid>          Inspect a process
  projects               List detected projects
  services               List services
  graph                  Show inferred service topology
  open <project>         Open a project directory
  stop <pid>             Stop a process (asks first)
  refresh                Refresh discovery cache
  doctor                 Diagnose AirCtl and the local environment
  config                 Show effective configuration
  ui                     Start the local web UI
  tui                    Interactive terminal view
  logs                   Show recent discovery activity
  version                Print version
  help                   Show this help

Options:
  --json                 Machine-readable output
  --quiet, -q            Minimal output
  --verbose, -v          Debug logs on stderr
  --watch, -w            Refresh continuously
  --project <name>       Filter by project
  --port <port>          Filter by port
  --all, -a              Include system services
  --yes, -y              Confirm destructive actions
  --force                Use forceful termination after stop
  --config <path>        Config file path
  --help, -h             Show help

AirCtl does not send process, project, or network data anywhere.
`;
}
