const FLAG_CWD_RE = /(?:--cwd|--prefix|-C)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;

const QUOTED_PATH_RE =
  /(?:"([A-Za-z]:\\[^"\r\n]+)"|'([A-Za-z]:\\[^'\r\n]+)'|"(\/(?:Users|home|code|opt|var|tmp)[^"\r\n]*)"|'(\/(?:Users|home|code|opt|var|tmp)[^'\r\n]*)')/g;

const WIN_PATH_RE = /(?:^|[\s="'])([A-Za-z]:\\[^\s"'*?<>|]+)/g;

const POSIX_PATH_RE = /(?:^|[\s="'])(\/(?:Users|home|code|opt|var|tmp)[^\s"'*?<>|]+)/g;

const SCRIPT_EXT_RE = /\.(?:js|mjs|cjs|mts|cts|ts|tsx|jsx|py|rb|php|go|rs|toml|json)$/i;

const NODE_MODULES_RE = /^(.*?)[/\\]node_modules(?:[/\\]|$)/i;

const RUNTIME_DIR_RE =
  /(?:^|[/\\])(?:Program Files(?: \(x86\))?[/\\](?:nodejs|Git|Docker|Python\d*)|Windows(?:[/\\]System32)?|nodejs|node[/\\]v\d+|Python\d*|pyenv|rbenv|nvm|fnm|volta|usr[/\\](?:bin|lib|local)|opt[/\\]homebrew)(?:[/\\]|$)/i;

export function inferCwdFromCommand(command?: string, executablePath?: string): string | undefined {
  const candidates = collectPathCandidates(command, executablePath);
  for (const path of candidates) {
    const fromModules = nodeModulesRoot(path);
    if (fromModules) return fromModules;
  }
  for (const path of candidates) {
    if (SCRIPT_EXT_RE.test(path)) {
      const dir = dirnameOf(path);
      if (dir && !isRuntimeInstallDir(dir)) return dir;
    }
  }
  for (const path of candidates) {
    if (!SCRIPT_EXT_RE.test(path) && !isRuntimeInstallDir(path)) return path;
  }
  return undefined;
}

export function collectPathCandidates(command?: string, executablePath?: string): string[] {
  const found: string[] = [];
  const add = (value: string | undefined): void => {
    const cleaned = normalizeCandidate(value);
    if (cleaned && !found.includes(cleaned)) found.push(cleaned);
  };

  if (command) {
    for (const match of command.matchAll(FLAG_CWD_RE)) {
      add(match[1] ?? match[2] ?? match[3]);
    }
    for (const match of command.matchAll(QUOTED_PATH_RE)) {
      add(match[1] ?? match[2] ?? match[3] ?? match[4]);
    }
    for (const match of command.matchAll(WIN_PATH_RE)) add(match[1]);
    for (const match of command.matchAll(POSIX_PATH_RE)) add(match[1]);
  }
  add(executablePath);
  return found;
}

export function nodeModulesRoot(path: string): string | undefined {
  const match = NODE_MODULES_RE.exec(path);
  const root = match?.[1];
  if (!root || isRuntimeInstallDir(root)) return undefined;
  return root;
}

export function isRuntimeInstallDir(path: string): boolean {
  return RUNTIME_DIR_RE.test(path.replaceAll("\\", "/"));
}

export function parsePidCwdTable(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab < 0) continue;
    const pid = Number.parseInt(trimmed.slice(0, tab), 10);
    const cwd = trimmed.slice(tab + 1).trim();
    if (!Number.isNaN(pid) && cwd) map.set(pid, cwd);
  }
  return map;
}

function normalizeCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let cleaned = value.trim().replace(/^['"]|['"]$/g, "");
  cleaned = cleaned.replace(/[,;]+$/, "");
  if (cleaned.length < 2) return undefined;
  if (cleaned === "." || cleaned === ".." || cleaned === "/" || /^[A-Za-z]:\\?$/.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function dirnameOf(path: string): string | undefined {
  const normalized = path.replaceAll("/", "\\");
  const idx = Math.max(normalized.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (idx <= 0) return undefined;
  return path.slice(0, idx);
}
