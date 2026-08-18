import { homedir } from "node:os";
import path from "node:path";

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
}

export interface FileSystemProvider {
  exists(target: string): Promise<boolean>;
  stat(target: string): Promise<FileStat | undefined>;
  readFile(target: string, encoding?: BufferEncoding): Promise<string | undefined>;
  readLink(target: string): Promise<string | undefined>;
  readDir(target: string): Promise<string[] | undefined>;
  realpath(target: string): Promise<string | undefined>;
  homeDir(): string;
  join(...parts: string[]): string;
  dirname(target: string): string;
  basename(target: string): string;
}

export class NodeFileSystem implements FileSystemProvider {
  constructor(private readonly fs: typeof import("node:fs/promises")) {}

  static async create(): Promise<NodeFileSystem> {
    const fs = await import("node:fs/promises");
    return new NodeFileSystem(fs);
  }

  async exists(target: string): Promise<boolean> {
    try {
      await this.fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  async stat(target: string): Promise<FileStat | undefined> {
    try {
      const st = await this.fs.lstat(target);
      return {
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
        size: st.size,
        mtimeMs: st.mtimeMs,
      };
    } catch {
      return undefined;
    }
  }

  async readFile(target: string, encoding: BufferEncoding = "utf8"): Promise<string | undefined> {
    try {
      return await this.fs.readFile(target, encoding);
    } catch {
      return undefined;
    }
  }

  async readLink(target: string): Promise<string | undefined> {
    try {
      return await this.fs.readlink(target);
    } catch {
      return undefined;
    }
  }

  async readDir(target: string): Promise<string[] | undefined> {
    try {
      return await this.fs.readdir(target);
    } catch {
      return undefined;
    }
  }

  async realpath(target: string): Promise<string | undefined> {
    try {
      return await this.fs.realpath(target);
    } catch {
      return undefined;
    }
  }

  homeDir(): string {
    return homedir();
  }

  join(...parts: string[]): string {
    return path.join(...parts);
  }

  dirname(target: string): string {
    return path.dirname(target);
  }

  basename(target: string): string {
    return path.basename(target);
  }
}

export class MemoryFileSystem implements FileSystemProvider {
  constructor(
    private files: Map<string, string> = new Map(),
    private dirs: Set<string> = new Set(),
    private links: Map<string, string> = new Map(),
    private readonly home = "/home/dev",
  ) {}

  private norm(target: string): string {
    return path.posix.normalize(target.replaceAll("\\", "/"));
  }

  addFile(target: string, contents: string): void {
    const n = this.norm(target);
    this.files.set(n, contents);
    this.addDir(path.posix.dirname(n));
  }

  addDir(target: string): void {
    let n = this.norm(target);
    while (n && n !== "." && n !== "/") {
      this.dirs.add(n);
      const parent = path.posix.dirname(n);
      if (parent === n) break;
      n = parent;
    }
    this.dirs.add("/");
  }

  addLink(target: string, dest: string): void {
    this.links.set(this.norm(target), dest);
  }

  async exists(target: string): Promise<boolean> {
    const n = this.norm(target);
    return this.files.has(n) || this.dirs.has(n) || this.links.has(n);
  }

  async stat(target: string): Promise<FileStat | undefined> {
    const n = this.norm(target);
    if (this.links.has(n)) {
      return { isFile: false, isDirectory: false, isSymbolicLink: true, size: 0, mtimeMs: 0 };
    }
    if (this.files.has(n)) {
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        size: this.files.get(n)?.length ?? 0,
        mtimeMs: 0,
      };
    }
    if (this.dirs.has(n)) {
      return { isFile: false, isDirectory: true, isSymbolicLink: false, size: 0, mtimeMs: 0 };
    }
    return undefined;
  }

  async readFile(target: string): Promise<string | undefined> {
    return this.files.get(this.norm(target));
  }

  async readLink(target: string): Promise<string | undefined> {
    return this.links.get(this.norm(target));
  }

  async readDir(target: string): Promise<string[] | undefined> {
    const n = this.norm(target);
    if (!(await this.exists(n))) return undefined;
    const prefix = n.endsWith("/") ? n : `${n}/`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
    }
    return [...names];
  }

  async realpath(target: string): Promise<string | undefined> {
    const n = this.norm(target);
    if (this.links.has(n)) return this.links.get(n);
    if (await this.exists(n)) return n;
    return undefined;
  }

  homeDir(): string {
    return this.home;
  }

  join(...parts: string[]): string {
    return path.posix.join(...parts.map((p) => p.replaceAll("\\", "/")));
  }

  dirname(target: string): string {
    return path.posix.dirname(this.norm(target));
  }

  basename(target: string): string {
    return path.posix.basename(this.norm(target));
  }
}
