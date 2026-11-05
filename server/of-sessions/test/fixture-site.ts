import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { InvalidArgumentError } from "../types.ts";
import { messages } from "../messages.ts";
import type { SiteAdapter } from "../sessions/site.ts";
import { hasLiveCookies } from "../sessions/site.ts";
import type { StorageCookie } from "../sessions/storage-state.ts";

export interface FixtureHits {
  login: number;
  session: number;
  dashboard: number;
}

export interface Fixture {
  origin: string;
  site: SiteAdapter;
  hits: FixtureHits;
  invalidate(): void;
  close(): Promise<void>;
}

const loginHtml = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Login</title></head>
  <body>
    <form method="POST" action="/session" autocomplete="off">
      <input name="user" autocomplete="off" />
      <input name="password" type="password" autocomplete="off" />
      <button type="submit">Entrar</button>
    </form>
  </body>
</html>`;

const dashboardHtml = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Dashboard</title>
    <script>localStorage.setItem("fanlink_user","42");</script>
  </head>
  <body><h1>Dashboard</h1></body>
</html>`;

const blankHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Blank</title></head><body>blank</body></html>`;

export async function startFixture(): Promise<Fixture> {
  let epoch = 1;
  const hits: FixtureHits = { login: 0, session: 0, dashboard: 0 };
  const server = createServer((req, res) => {
    void handle(req, res, () => epoch, hits).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("El sitio de prueba no tiene puerto");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    site: createFixtureSite(origin),
    hits,
    invalidate() {
      epoch += 1;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  epoch: () => number,
  hits: FixtureHits,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/login") {
    hits.login += 1;
    if (accepted(req, epoch())) {
      redirect(res, "/dashboard");
      return;
    }
    html(res, loginHtml);
    return;
  }
  if (req.method === "POST" && url.pathname === "/session") {
    hits.session += 1;
    await readBody(req);
    const current = epoch();
    res.writeHead(302, {
      location: "/dashboard",
      "set-cookie": [
        `sess=ok-${current}; Path=/; HttpOnly; SameSite=Lax`,
        `auth_id=42; Path=/; SameSite=Lax`,
      ],
    });
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/dashboard") {
    hits.dashboard += 1;
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, dashboardHtml);
    return;
  }
  if (req.method === "GET" && url.pathname === "/blank") {
    html(res, blankHtml);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("no encontrado");
}

function accepted(req: IncomingMessage, epoch: number): boolean {
  const header = req.headers.cookie ?? "";
  const cookies = new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), part.slice(index + 1)] as const;
      }),
  );
  return (
    cookies.get("sess") === `ok-${epoch}` && cookies.get("auth_id") === "42"
  );
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    req.on("data", () => undefined);
    req.on("end", () => resolve());
    req.on("error", reject);
  });
}

export function createFixtureSite(origin: string): SiteAdapter {
  const hostname = new URL(origin).hostname;
  return {
    id: "fixture",
    origin,
    hostname,
    loginUrl: `${origin}/login`,
    probeUrl: `${origin}/dashboard`,
    requiredCookies: ["auth_id", "sess"],
    loggedOutSelector: 'input[type="password"]',
    isDashboardUrl(raw: string): boolean {
      return samePath(origin, raw, "/dashboard");
    },
    isLoginUrl(raw: string): boolean {
      return samePath(origin, raw, "/login");
    },
    isAuthenticated(
      raw: string,
      cookies: readonly StorageCookie[],
      nowMs: number,
    ): boolean {
      return this.isDashboardUrl(raw) && hasLiveCookies(this, cookies, nowMs);
    },
    assertRequestUrl(raw: string): void {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new InvalidArgumentError(messages.invalidUrl);
      }
      if (url.username || url.password)
        throw new InvalidArgumentError(messages.urlCredentials);
      if (url.origin !== origin)
        throw new InvalidArgumentError(messages.originRejected);
    },
  };
}

function samePath(origin: string, raw: string, pathname: string): boolean {
  try {
    const url = new URL(raw);
    return url.origin === origin && url.pathname === pathname;
  } catch {
    return false;
  }
}
