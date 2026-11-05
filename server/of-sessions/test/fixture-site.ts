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

export type FixtureMode = "users-me" | "state" | "menu" | "profile" | "missing-username" | "none";

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

function profileHtml(mode: FixtureMode): string {
  const fetchUser =
    mode === "profile" ? `<script>fetch("/api2/v2/users/me?view=full&appToken=no-guardar");</script>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Perfil</title>${fetchUser}</head><body><h1>Perfil</h1></body></html>`;
}

function pageHtml(title: string, head: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
}

function dashboardHtml(mode: FixtureMode): string {
  const storage = `<script>localStorage.setItem("fanlink_user","42");</script>`;
  const usersMe = `<script>fetch("/api2/v2/users/me?view=full&appToken=no-guardar");</script>`;
  switch (mode) {
    case "users-me":
      return pageHtml(
        "Dashboard",
        storage + usersMe,
        `<h1>Dashboard</h1><p id="fanlink-identity" data-username="creadora" data-user-id="42">Creadora de prueba</p>`,
      );
    case "state": {
      const state = JSON.stringify({
        auth: { user: { id: 99, username: "creadora", name: "Desde estado", password: "no-guardar", isAuth: true } },
      });
      return pageHtml("Dashboard", `${storage}<script>window.__INITIAL_STATE__=${state};</script>`, `<h1>Dashboard</h1>`);
    }
    case "menu":
      return pageHtml(
        "Dashboard",
        storage,
        `<h1>Dashboard</h1><aside><a href="/creadora?ref=secret">@creadora</a><a href="/posts">Posts</a></aside>`,
      );
    case "profile":
      return pageHtml("Dashboard", storage, `<h1>Dashboard</h1>`);
    case "none":
      return pageHtml(
        "Dashboard",
        `${storage}<script>fetch("/api2/v2/init?token=sekret");</script>`,
        `<h1>Dashboard</h1>`,
      );
    case "missing-username":
      return pageHtml("Dashboard", storage + usersMe, `<h1>Dashboard</h1>`);
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

const blankHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Blank</title></head><body>blank</body></html>`;

export async function startFixture(mode: FixtureMode = "users-me"): Promise<Fixture> {
  let epoch = 1;
  const hits: FixtureHits = { login: 0, session: 0, dashboard: 0 };
  const server = createServer((req, res) => {
    void handle(req, res, () => epoch, hits, mode).catch(() => {
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
  mode: FixtureMode,
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
  if (req.method === "GET" && (url.pathname === "/api/me" || url.pathname === "/api2/v2/users/me")) {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    const body =
      mode === "missing-username"
        ? { id: 5, name: "Sin handle", password: "no-guardar" }
        : { id: 42, username: "creadora", name: "Creadora de prueba", password: "no-guardar" };
    res.end(JSON.stringify(body));
    return;
  }
  if (req.method === "GET" && url.pathname === "/dashboard") {
    hits.dashboard += 1;
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, dashboardHtml(mode));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api2/v2/init") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/profile") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, profileHtml(mode));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api2/v2/earnings/chart") {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        currency: "USD",
        password: "no-guardar",
        list: [{ date: "2026-11-01", subscriptions: 4, tips: 3, messages: 2, posts: 1 }],
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api2/v2/subscriptions/subscribers") {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        list: [
          {
            id: 7,
            username: "fanuno",
            name: "Fan Uno",
            password: "no-guardar",
            subscribedOnData: { subscribedAt: "2026-10-01T00:00:00.000Z", totalSumm: 15.5 },
          },
          {
            id: 8,
            username: "fanexp",
            name: "Fan Exp",
            subscribedOnExpiredNow: true,
            subscribedOnData: { subscribeAt: "2026-01-02", totalSumm: 0 },
          },
        ],
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/statements/earnings") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(
      res,
      pageHtml(
        "Ganancias",
        `<script>fetch("/api2/v2/earnings/chart?startDate=2026-11-01&token=sekret");</script>`,
        `<p data-fanlink-earning data-day="2026-11-02" data-kind="tip" data-amount="99" data-currency="USD">DOM</p>`,
      ),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/subscribers/active") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(
      res,
      pageHtml(
        "Fans",
        `<script>fetch("/api2/v2/subscriptions/subscribers?offset=0&token=sekret");</script>`,
        `<p data-fanlink-fan data-id="1" data-handle="domfan" data-name="DOM" data-subscribed="2026-02-02" data-status="active" data-spent="1">DOM</p>`,
      ),
    );
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
    profileUrl: `${origin}/my/profile`,
    earningsUrl: `${origin}/my/statements/earnings`,
    subscribersUrl: `${origin}/my/subscribers/active`,
    requiredCookies: ["auth_id", "sess"],
    loggedOutSelector: 'input[type="password"]',
    identitySelector: "#fanlink-identity",
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
