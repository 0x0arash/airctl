import type { FileSystemProvider } from "../runtime/fs.js";
import type { ProcessInfo, Project } from "../domain/types.js";
import { projectIdFor } from "../domain/ids.js";
import { FRAMEWORK_FILES, MAX_ANCESTOR_WALK, PROJECT_MARKERS } from "./markers.js";
import { collectPathCandidates, inferCwdFromCommand } from "../process/cwd.js";

export interface ProjectDetector {
  detectFromProcesses(processes: ProcessInfo[], extraRoots?: string[]): Promise<Project[]>;
  inspectRoot(root: string): Promise<Project | undefined>;
}

export class FilesystemProjectDetector implements ProjectDetector {
  constructor(private readonly fs: FileSystemProvider) {}

  async detectFromProcesses(
    processes: ProcessInfo[],
    extraRoots: string[] = [],
  ): Promise<Project[]> {
    const seeds = new Set<string>();
    for (const proc of processes) {
      if (proc.cwd) seeds.add(proc.cwd);
      if (proc.executablePath) seeds.add(this.fs.dirname(proc.executablePath));
      const inferred = inferCwdFromCommand(proc.command, proc.executablePath);
      if (inferred) seeds.add(inferred);
      for (const path of collectPathCandidates(proc.command, proc.executablePath)) seeds.add(path);
    }
    for (const root of extraRoots)
      seeds.add(expandHome(root, this.fs.homeDir(), this.fs.join.bind(this.fs)));

    const found = new Map<string, Project>();
    for (const seed of seeds) {
      const project = await this.walkAncestors(seed);
      if (project) found.set(project.id, project);
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async inspectRoot(root: string): Promise<Project | undefined> {
    return this.readProject(root);
  }

  private async walkAncestors(start: string): Promise<Project | undefined> {
    let current = start;
    for (let i = 0; i < MAX_ANCESTOR_WALK; i += 1) {
      const project = await this.readProject(current);
      if (project) return project;
      const parent = this.fs.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return undefined;
  }

  private async readProject(root: string): Promise<Project | undefined> {
    const stat = await this.fs.stat(root);
    if (!stat?.isDirectory && !stat?.isSymbolicLink) return undefined;

    const markers: string[] = [];
    const kinds: string[] = [];
    for (const marker of PROJECT_MARKERS) {
      if (await this.fs.exists(this.fs.join(root, marker.file))) {
        markers.push(marker.file);
        kinds.push(marker.kind);
      }
    }
    const isGitRoot = await this.fs.exists(this.fs.join(root, ".git"));
    if (markers.length === 0 && !isGitRoot) return undefined;

    const resolved = (await this.fs.realpath(root)) ?? root;
    const name = this.fs.basename(resolved) || resolved;
    const frameworkHints: string[] = [];
    for (const file of FRAMEWORK_FILES) {
      if (await this.fs.exists(this.fs.join(root, file.file))) frameworkHints.push(file.name);
    }

    const kind = kinds[0] ?? (isGitRoot ? "git" : undefined);
    return {
      id: projectIdFor(resolved),
      root: resolved,
      name,
      repository: isGitRoot ? resolved : await findGitRoot(this.fs, root),
      kind,
      markers: [...markers, ...frameworkHints.map((f) => `framework:${f}`)],
    };
  }
}

export async function findGitRoot(
  fs: FileSystemProvider,
  start: string,
): Promise<string | undefined> {
  let current = start;
  for (let i = 0; i < MAX_ANCESTOR_WALK + 4; i += 1) {
    if (await fs.exists(fs.join(current, ".git"))) return current;
    const parent = fs.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function expandHome(input: string, home: string, joinPath = posixJoin): string {
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) return joinPath(home, input.slice(2));
  return input;
}

function posixJoin(home: string, rest: string): string {
  const left = home.replaceAll("\\", "/").replace(/\/+$/, "");
  const right = rest.replaceAll("\\", "/").replace(/^\/+/, "");
  return `${left}/${right}`;
}

export function projectByCwd(projects: Project[], cwd: string | undefined): Project | undefined {
  if (!cwd) return undefined;
  const normalized = cwd.replaceAll("\\", "/");
  const matches = projects.filter((p) => {
    const root = p.root.replaceAll("\\", "/");
    return (
      normalized === root || normalized.startsWith(`${root}/`) || normalized.startsWith(`${root}\\`)
    );
  });
  matches.sort((a, b) => b.root.length - a.root.length);
  return matches[0];
}

export function projectForProcess(
  projects: Project[],
  proc: ProcessInfo | undefined,
): Project | undefined {
  if (!proc) return undefined;
  return (
    projectByCwd(projects, proc.cwd) ??
    projectByCwd(projects, inferCwdFromCommand(proc.command, proc.executablePath))
  );
}
