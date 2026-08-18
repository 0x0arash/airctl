export interface EnvProvider {
  get(name: string): string | undefined;
  has(name: string): boolean;
}

export class ProcessEnv implements EnvProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(name: string): string | undefined {
    return this.env[name];
  }

  has(name: string): boolean {
    return this.env[name] !== undefined;
  }
}

export class MapEnv implements EnvProvider {
  constructor(private readonly values: Map<string, string> = new Map()) {}

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  set(name: string, value: string): void {
    this.values.set(name, value);
  }
}

export function colorEnabled(env: EnvProvider, stdoutIsTty: boolean): boolean {
  if (env.get("NO_COLOR") !== undefined && env.get("NO_COLOR") !== "") return false;
  if (env.get("FORCE_COLOR") === "0") return false;
  if (env.get("FORCE_COLOR")) return true;
  if (env.get("CI")) return false;
  if (env.get("TERM") === "dumb") return false;
  return stdoutIsTty;
}
