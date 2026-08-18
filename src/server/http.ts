import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "../engine/app.js";
import { AirCtlError, isAirCtlError, toErrorPayload } from "../domain/errors.js";
import { isLoopbackHost, newAuthToken, newRequestId, originAllowed } from "../shared/api.js";
import { snapshotToJson } from "../cli/format.js";
import { runDoctor } from "../engine/doctor.js";

export interface ServerHandle {
  url: string;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const stopAttempts = new Map<string, { count: number; resetAt: number }>();

export async function startServer(options: {
  app: AppContext;
  openBrowser?: boolean;
  port?: number;
  bind?: string;
}): Promise<ServerHandle> {
  const bind = options.bind ?? options.app.config.security.bind ?? "127.0.0.1";
  if (bind !== "127.0.0.1" && bind !== "localhost" && bind !== "::1") {
    throw new AirCtlError(
      "INVALID_INPUT",
      "Refusing to bind the UI to a non-loopback address. Set security.bind to 127.0.0.1.",
    );
  }
  const port = options.port ?? options.app.config.ui.port;
  const token = newAuthToken();
  const webRoot = resolveWebRoot();
  const sseClients = new Set<ServerResponse>();

  const unsub = options.app.engine.onChange((snapshot) => {
    const payload = `data: ${JSON.stringify({ type: "snapshot", scannedAt: snapshot.scannedAt })}\n\n`;
    for (const client of sseClients) client.write(payload);
  });

  options.app.engine.startAdaptiveLoop();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = req.headers["x-request-id"]?.toString() || newRequestId();
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    try {
      const host = req.headers.host;
      if (!isLoopbackHost(host)) {
        json(res, 403, { error: { code: "FORBIDDEN", message: "Host not allowed.", requestId } });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (!originAllowed(req.headers.origin, bind, port)) {
          json(res, 403, {
            error: { code: "FORBIDDEN", message: "Origin not allowed.", requestId },
          });
          return;
        }
        const mutating = req.method !== "GET" && req.method !== "HEAD";
        if (mutating && !validToken(req, url, token)) {
          json(res, 401, {
            error: { code: "UNAUTHORIZED", message: "Missing or invalid token.", requestId },
          });
          return;
        }
        await handleApi(options.app, req, res, url, token, sseClients, requestId);
        return;
      }
      await serveStatic(res, url.pathname, webRoot, token);
    } catch (error) {
      const payload = toErrorPayload(error, requestId);
      json(res, isAirCtlError(error) ? statusFor(error.code) : 500, payload);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(port, bind, () => resolve());
    server.on("error", reject);
  });

  const url = `http://${bind}:${port}/#token=${token}`;
  if (options.openBrowser) {
    const opener =
      options.app.runtime.platform === "darwin"
        ? "open"
        : options.app.runtime.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args = options.app.runtime.platform === "win32" ? ["/c", "start", "", url] : [url];
    void options.app.runtime.commands.run(opener, args);
  }

  return {
    url: `http://${bind}:${port}`,
    token,
    close: async () => {
      unsub();
      options.app.engine.stopLoop();
      for (const client of sseClients) client.end();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function handleApi(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  token: string,
  sseClients: Set<ServerResponse>,
  requestId: string,
): Promise<void> {
  const pathName = url.pathname.replace(/\/+$/, "") || "/";
  if (pathName === "/api/v1/events" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", tokenHint: token.slice(0, 4) })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  const snapshot = app.engine.getSnapshot() ?? (await app.engine.scan());

  if (pathName === "/api/v1/status" && req.method === "GET") {
    json(res, 200, snapshotToJson(snapshot, true));
    return;
  }
  if (pathName === "/api/v1/processes" && req.method === "GET") {
    json(res, 200, { processes: snapshot.processes });
    return;
  }
  const procMatch = /^\/api\/v1\/processes\/(\d+)$/.exec(pathName);
  if (procMatch && req.method === "GET") {
    const pid = Number.parseInt(procMatch[1] ?? "", 10);
    const proc = await app.engine.inspectPid(pid);
    json(res, 200, { process: proc });
    return;
  }
  const stopMatch = /^\/api\/v1\/processes\/(\d+)\/stop$/.exec(pathName);
  if (stopMatch && req.method === "POST") {
    const pid = Number.parseInt(stopMatch[1] ?? "", 10);
    rateLimitStop(req.socket.remoteAddress ?? "local");
    const body = await readJson(req);
    const force =
      typeof body === "object" &&
      body !== null &&
      "force" in body &&
      (body as { force?: unknown }).force === true;
    const result = await app.controller.stop({ pid, force });
    json(res, 200, { pid, ...result });
    return;
  }
  if (pathName === "/api/v1/sockets" && req.method === "GET") {
    json(res, 200, { sockets: snapshot.sockets });
    return;
  }
  if (pathName === "/api/v1/services" && req.method === "GET") {
    json(res, 200, { services: snapshot.services });
    return;
  }
  if (pathName === "/api/v1/projects" && req.method === "GET") {
    json(res, 200, { projects: snapshot.projects });
    return;
  }
  if (pathName === "/api/v1/graph" && req.method === "GET") {
    json(res, 200, snapshot.graph);
    return;
  }
  if (pathName === "/api/v1/warnings" && req.method === "GET") {
    json(res, 200, { warnings: snapshot.warnings });
    return;
  }
  if (pathName === "/api/v1/health" && req.method === "GET") {
    json(res, 200, { ok: true, scannedAt: snapshot.scannedAt });
    return;
  }
  if (pathName === "/api/v1/doctor" && req.method === "GET") {
    json(res, 200, await runDoctor(app.engine));
    return;
  }
  if (pathName === "/api/v1/refresh" && req.method === "POST") {
    const next = await app.engine.refresh();
    json(res, 200, { scannedAt: next.scannedAt, durationMs: next.durationMs });
    return;
  }
  const explainMatch = /^\/api\/v1\/explain\/(\d+)$/.exec(pathName);
  if (explainMatch && req.method === "GET") {
    const expl = await app.engine.explainPort(explainMatch[1] ?? "");
    json(res, 200, expl);
    return;
  }
  json(res, 404, { error: { code: "NOT_FOUND", message: "Unknown endpoint.", requestId } });
}

async function serveStatic(
  res: ServerResponse,
  pathname: string,
  webRoot: string,
  token: string,
): Promise<void> {
  if (!webRoot || !existsSync(webRoot)) {
    htmlFallback(res, token);
    return;
  }
  const rel = pathname === "/" ? "/index.html" : pathname;
  const unsafe = normalize(join(webRoot, rel));
  if (!unsafe.startsWith(webRoot)) {
    json(res, 403, { error: { code: "FORBIDDEN", message: "Invalid path." } });
    return;
  }
  if (!existsSync(unsafe)) {
    const index = join(webRoot, "index.html");
    if (existsSync(index)) {
      res.writeHead(200, { "content-type": MIME[".html"] });
      createReadStream(index).pipe(res);
      return;
    }
    htmlFallback(res, token);
    return;
  }
  const type = MIME[extname(unsafe)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(unsafe).pipe(res);
}

function htmlFallback(res: ServerResponse, token: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>AirCtl</title>
<meta name="airctl-token" content="${token}"/>
<style>
:root{color-scheme:dark;--bg:#071018;--fg:#e8f0e8;--muted:#8aa;--line:#1c3;--warn:#e6b84d;--bad:#e25c5c;}
body{font:14px/1.5 ui-sans-serif,system-ui;background:var(--bg);color:var(--fg);margin:0;padding:24px;}
h1{font-size:18px;letter-spacing:.12em;text-transform:uppercase;}
a{color:var(--line);} table{border-collapse:collapse;width:100%;} td,th{padding:8px 10px;border-bottom:1px solid #123;text-align:left;}
.muted{color:var(--muted);} .warn{color:var(--warn);}
</style></head>
<body>
<main>
<h1>AirCtl</h1>
<p class="muted">Local development air traffic control. Data stays on this machine.</p>
<p><button id="refresh">Refresh</button></p>
<div id="app">Loading…</div>
</main>
<script>
const token = document.querySelector('meta[name="airctl-token"]').content;
async function load(){
  const res = await fetch('/api/v1/status');
  const data = await res.json();
  const rows = (data.services||[]).map(s => '<tr><td>'+s.name+'</td><td>'+(s.ports||[]).join(', ')+'</td><td>'+s.health+'</td><td>'+s.classification+'</td></tr>').join('');
  document.getElementById('app').innerHTML = '<p>'+data.summary.services+' services</p><table><thead><tr><th>Service</th><th>Port</th><th>Status</th><th>Class</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
document.getElementById('refresh').onclick = async () => {
  await fetch('/api/v1/refresh',{method:'POST',headers:{'x-airctl-token':token}});
  load();
};
const es = new EventSource('/api/v1/events');
es.onmessage = load;
load();
</script>
</body></html>`);
}

function validToken(req: IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers["x-airctl-token"];
  if (typeof header === "string" && header === token) return true;
  const query = url.searchParams.get("token");
  return query === token;
}

function rateLimitStop(ip: string): void {
  const now = Date.now();
  const rec = stopAttempts.get(ip) ?? { count: 0, resetAt: now + 10_000 };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + 10_000;
  }
  rec.count += 1;
  stopAttempts.set(ip, rec);
  if (rec.count > 10) {
    throw new AirCtlError("INVALID_INPUT", "Too many stop requests. Slow down.");
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function statusFor(code: string): number {
  switch (code) {
    case "INVALID_INPUT":
      return 400;
    case "PROCESS_NOT_FOUND":
    case "PORT_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
      return 404;
    case "PERMISSION_DENIED":
      return 403;
    case "CONFIRMATION_REQUIRED":
      return 409;
    default:
      return 500;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new AirCtlError("INVALID_INPUT", "Request body too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AirCtlError("INVALID_INPUT", "Invalid JSON body.");
  }
}

function resolveWebRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "web"),
    join(here, "../web/dist"),
    join(process.cwd(), "web/dist"),
  ];
  return candidates.find((c) => existsSync(join(c, "index.html"))) ?? candidates[0] ?? "";
}

void randomBytes;
