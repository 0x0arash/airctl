import type { DetectionContext, DetectionHit, Detector } from "./types.js";
import { score } from "./types.js";

function cmd(ctx: DetectionContext): string {
  return `${ctx.executable} ${ctx.command}`.toLowerCase();
}

function hasMarker(ctx: DetectionContext, needle: string): boolean {
  return ctx.project?.markers.some((m) => m.toLowerCase().includes(needle.toLowerCase())) ?? false;
}

export const builtinDetectors: Detector[] = [
  {
    id: "vite",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/\bvite\b/.test(c)) evidence.push("command mentions vite");
      if (hasMarker(ctx, "framework:Vite")) evidence.push("vite config present");
      if (ctx.ports.includes(5173)) evidence.push("default Vite port 5173");
      if (evidence.length === 0) return undefined;
      return {
        name: "Vite",
        confidence: score(evidence.length >= 2 ? 0.92 : 0.72),
        evidence,
        classification: "development-server",
      };
    },
  },
  {
    id: "next",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/\bnext\b/.test(c)) evidence.push("command mentions next");
      if (hasMarker(ctx, "framework:Next.js")) evidence.push("next config present");
      if (ctx.ports.includes(3000) && hasMarker(ctx, "package.json"))
        evidence.push("port 3000 with Node project");
      if (evidence.length === 0) return undefined;
      return {
        name: "Next.js",
        confidence: score(evidence.length >= 2 ? 0.9 : 0.68),
        evidence,
        classification: "development-server",
      };
    },
  },
  {
    id: "nuxt",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/\bnuxt\b/.test(c)) evidence.push("command mentions nuxt");
      if (hasMarker(ctx, "framework:Nuxt")) evidence.push("nuxt config present");
      if (evidence.length === 0) return undefined;
      return { name: "Nuxt", confidence: 0.88, evidence, classification: "development-server" };
    },
  },
  {
    id: "astro",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      if (!/\bastro\b/.test(c) && !hasMarker(ctx, "framework:Astro")) return undefined;
      return {
        name: "Astro",
        confidence: 0.86,
        evidence: ["astro signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "remix",
    detect(ctx): DetectionHit | undefined {
      if (!/\bremix\b/.test(cmd(ctx)) && !hasMarker(ctx, "framework:Remix")) return undefined;
      return {
        name: "Remix",
        confidence: 0.84,
        evidence: ["remix signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "express",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      if (!/\bexpress\b/.test(c) && !/node.*(server|app|api)/.test(c)) return undefined;
      if (/\bexpress\b/.test(c)) {
        return {
          name: "Express",
          confidence: 0.8,
          evidence: ["command mentions express"],
          classification: "development-server",
        };
      }
      return undefined;
    },
  },
  {
    id: "fastify",
    detect(ctx): DetectionHit | undefined {
      if (!/\bfastify\b/.test(cmd(ctx))) return undefined;
      return {
        name: "Fastify",
        confidence: 0.86,
        evidence: ["command mentions fastify"],
        classification: "development-server",
      };
    },
  },
  {
    id: "nest",
    detect(ctx): DetectionHit | undefined {
      if (!/\bnest\b/.test(cmd(ctx)) && !hasMarker(ctx, "framework:Nest")) return undefined;
      return {
        name: "Nest",
        confidence: 0.84,
        evidence: ["nest signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "django",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/manage\.py|django/.test(c)) evidence.push("django command");
      if (hasMarker(ctx, "framework:Django")) evidence.push("manage.py present");
      if (evidence.length === 0) return undefined;
      return { name: "Django", confidence: 0.9, evidence, classification: "development-server" };
    },
  },
  {
    id: "flask",
    detect(ctx): DetectionHit | undefined {
      if (!/\bflask\b/.test(cmd(ctx))) return undefined;
      return {
        name: "Flask",
        confidence: 0.86,
        evidence: ["command mentions flask"],
        classification: "development-server",
      };
    },
  },
  {
    id: "rails",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      if (!/\brails\b/.test(c) && !hasMarker(ctx, "framework:Rails")) return undefined;
      return {
        name: "Rails",
        confidence: 0.88,
        evidence: ["rails signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "laravel",
    detect(ctx): DetectionHit | undefined {
      if (!/\bartisan\b|\blaravel\b/.test(cmd(ctx)) && !hasMarker(ctx, "framework:Laravel"))
        return undefined;
      return {
        name: "Laravel",
        confidence: 0.86,
        evidence: ["laravel signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "spring",
    detect(ctx): DetectionHit | undefined {
      if (!/\bspring\b|\bjava\b.*\.jar/.test(cmd(ctx))) return undefined;
      return {
        name: "Spring",
        confidence: 0.7,
        evidence: ["java/spring signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "go",
    detect(ctx): DetectionHit | undefined {
      if (ctx.executable.toLowerCase() === "go" || hasMarker(ctx, "go.mod")) {
        if (ctx.ports.length === 0 && !/\brun\b/.test(cmd(ctx))) return undefined;
        return {
          name: "Go",
          confidence: hasMarker(ctx, "go.mod") ? 0.8 : 0.6,
          evidence: ["go project"],
          classification: "development-server",
        };
      }
      return undefined;
    },
  },
  {
    id: "rust",
    detect(ctx): DetectionHit | undefined {
      if (!/\bcargo\b/.test(cmd(ctx)) && !hasMarker(ctx, "Cargo.toml")) return undefined;
      return {
        name: "Rust",
        confidence: 0.78,
        evidence: ["rust/cargo signal"],
        classification: "development-server",
      };
    },
  },
  {
    id: "postgres",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/postgres|postgresql/.test(c)) evidence.push("postgres executable");
      if (ctx.ports.includes(5432)) evidence.push("port 5432");
      if (evidence.length === 0) return undefined;
      return {
        name: "Postgres",
        confidence: score(evidence.length >= 2 ? 0.95 : 0.82),
        evidence,
        classification: "database",
      };
    },
  },
  {
    id: "mysql",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/mysqld|mariadbd/.test(c)) evidence.push("mysql executable");
      if (ctx.ports.includes(3306)) evidence.push("port 3306");
      if (evidence.length === 0) return undefined;
      return {
        name: "MySQL",
        confidence: score(evidence.length >= 2 ? 0.94 : 0.8),
        evidence,
        classification: "database",
      };
    },
  },
  {
    id: "redis",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/redis-server|\bredis\b/.test(c)) evidence.push("redis executable");
      if (ctx.ports.includes(6379)) evidence.push("port 6379");
      if (evidence.length === 0) return undefined;
      return {
        name: "Redis",
        confidence: score(evidence.length >= 2 ? 0.95 : 0.84),
        evidence,
        classification: "cache",
      };
    },
  },
  {
    id: "mongo",
    detect(ctx): DetectionHit | undefined {
      const c = cmd(ctx);
      const evidence: string[] = [];
      if (/mongod/.test(c)) evidence.push("mongod");
      if (ctx.ports.includes(27017)) evidence.push("port 27017");
      if (evidence.length === 0) return undefined;
      return {
        name: "MongoDB",
        confidence: score(evidence.length >= 2 ? 0.94 : 0.8),
        evidence,
        classification: "database",
      };
    },
  },
  {
    id: "docker",
    detect(ctx): DetectionHit | undefined {
      if (!/docker|com\.docker|containerd/.test(cmd(ctx))) return undefined;
      return {
        name: "Docker",
        confidence: 0.9,
        evidence: ["docker process"],
        classification: "container",
      };
    },
  },
  {
    id: "nginx",
    detect(ctx): DetectionHit | undefined {
      if (!/\bnginx\b/.test(cmd(ctx))) return undefined;
      return {
        name: "nginx",
        confidence: 0.9,
        evidence: ["nginx executable"],
        classification: "proxy",
      };
    },
  },
  {
    id: "caddy",
    detect(ctx): DetectionHit | undefined {
      if (!/\bcaddy\b/.test(cmd(ctx))) return undefined;
      return {
        name: "Caddy",
        confidence: 0.9,
        evidence: ["caddy executable"],
        classification: "proxy",
      };
    },
  },
  {
    id: "wsl",
    detect(ctx): DetectionHit | undefined {
      const name = ctx.executable.toLowerCase().replace(/\.exe$/, "");
      if (
        !/^(wslrelay|wslhost|wsl|vmmemwsl)$/.test(name) &&
        !/\bwslrelay\b|\bwslhost\b/.test(cmd(ctx))
      ) {
        return undefined;
      }
      return {
        name: "WSL",
        confidence: 0.9,
        evidence: ["WSL/Hyper-V localhost relay"],
        classification: "proxy",
      };
    },
  },
  {
    id: "node",
    detect(ctx): DetectionHit | undefined {
      const exec = ctx.executable.toLowerCase();
      if (
        exec !== "node" &&
        exec !== "nodejs" &&
        !/[/\\]node(\.exe)?$/i.test(ctx.process.executablePath ?? "")
      ) {
        return undefined;
      }
      return {
        name: "Node.js",
        confidence: 0.55,
        evidence: ["node executable"],
        classification: "development-server",
      };
    },
  },
];

export class DetectorRegistry {
  constructor(private detectors: Detector[] = [...builtinDetectors]) {}

  register(detector: Detector): void {
    this.detectors = this.detectors.filter((d) => d.id !== detector.id).concat(detector);
  }

  detect(ctx: DetectionContext): DetectionHit | undefined {
    const hits = this.detectors
      .map((d) => d.detect(ctx))
      .filter((h): h is DetectionHit => h !== undefined)
      .sort((a, b) => b.confidence - a.confidence);
    // A docker-proxy/wslrelay PID often publishes many ports. When we classify a
    // single port, prefer the application identity for that port over "Docker".
    if (ctx.ports.length === 1) {
      const app = hits.find(
        (h) =>
          h.classification === "database" ||
          h.classification === "cache" ||
          (h.classification === "development-server" && h.name !== "Node.js") ||
          h.classification === "proxy",
      );
      if (app) return app;
    }
    return hits[0];
  }
}
