import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
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
  pushFanMessage(text: string): void;
  sent: Array<{ fan: string; body: string; price: string }>;
  composed: Array<{ body: string; price: string; file: string }>;
  confirmSends: { on: boolean };
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

function ofChatHtml(mode: "live" | "slow" | "late" | "verylate" | "hang" | "posting" | "reject" | "enter" | "stuck" = "live", chatId = "9"): string {
  if (mode === "posting" || mode === "reject") {
    const sendScript = `const box = document.querySelector("[at-attr='chat_input']");
       const send = document.querySelector("[at-attr='send_btn']");
       send.disabled = true;
       box.addEventListener("input", () => { send.disabled = box.value.trim() === ""; });
       send.onclick = async () => {
         const body = box.value;
         await fetch("/fixture/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, price: "", file: "" }) });
         box.value = "\\n";
         const item = document.createElement("div");
         item.className = "b-chat__message m-sending";
         item.textContent = body;
         document.querySelector(".b-chat").appendChild(item);
         const response = await fetch("/api2/v2/chats/${chatId}/messages", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
         if (response.ok) item.className = "b-chat__message";
       };`;
    return pageHtml(
      "Hilo",
      "",
      `<div class="b-chat">
         <textarea at-attr="chat_input" placeholder="Type a message..."></textarea>
         <button at-attr="send_btn" type="button">Send</button>
         <button at-attr="price_btn" type="button">Price</button>
         <input at-attr="price_input" />
         <button at-attr="vault_btn" type="button">Vault</button>
       </div>
       <script>${sendScript}</script>`,
    );
  }
  const sendScript = mode === "stuck"
    ? `document.querySelector("[at-attr='send_btn']").disabled = true;`
    : `const box = document.querySelector("[at-attr='chat_input']");
       const send = document.querySelector("[at-attr='send_btn']");
       const lateMs = "${mode}" === "verylate" ? 13000 : "${mode}" === "late" ? 4000 : "${mode}" === "slow" ? 800 : 0;
       const post = async (waitMs) => {
         if (send.disabled) return;
         const go = async () => {
           const body = box.value;
           const price = document.querySelector("[at-attr='price_input']").dataset.saved || "";
           await fetch("/fixture/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, price, file: "" }) });
           const slow = "${mode}" === "verylate" && waitMs !== 0 ? "&slow=1" : "";
           const hang = "${mode}" === "hang" ? "&hang=1" : "";
           await fetch("/api2/v2/chats/${chatId}/messages?order=desc" + slow + hang);
           box.value = "";
           send.disabled = true;
         };
         if (waitMs > 0 && "${mode}" !== "verylate") setTimeout(() => { void go(); }, waitMs);
         else await go();
       };
       send.disabled = true;
       box.addEventListener("input", () => { send.disabled = box.value.trim() === ""; });
       send.onclick = () => { if ("${mode}" === "enter") return; void post(lateMs); };
       box.addEventListener("keydown", (event) => {
         if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void post(false); }
       });
       document.querySelector("[at-attr='vault_btn']").onclick = () => { void fetch("/fixture/vault"); };`;
  return pageHtml(
    "Hilo",
    "",
    `<div style="height:70vh"></div>
     <div class="b-chat">
       <ul class="b-chat__messages"><li class="b-chat__item">mensaje secreto del fan</li></ul>
       <form class="b-chat__form">
         <div class="b-chat__message-input">
           <textarea placeholder="Type a message..." at-attr="chat_input"></textarea>
         </div>
         <button type="button" at-attr="price_btn" aria-label="Price">Price</button>
         <button type="button" at-attr="vault_btn" aria-label="Add from media vault">Vault</button>
         <button type="button" at-attr="send_btn">Send</button>
       </form>
       <div id="price-box" role="dialog" aria-label="Message price" hidden>
         <input at-attr="price_input" placeholder="Free" />
         <button type="button" at-attr="submit_post">Save</button>
       </div>
     </div>
     <script>
       document.querySelector("[at-attr='price_btn']").onclick = () => { document.getElementById("price-box").hidden = false; };
       document.querySelector("[at-attr='submit_post']").onclick = () => {
         document.querySelector("[at-attr='price_input']").dataset.saved = document.querySelector("[at-attr='price_input']").value;
         document.getElementById("price-box").hidden = true;
       };
       ${sendScript}
     </script>`,
  );
}

function chatComposerHtml(): string {
  return pageHtml(
    "Hilo",
    "",
    `<textarea data-fanlink-composer aria-label="Message"></textarea>
     <button type="button" data-fanlink-price aria-label="Price">Price</button>
     <button type="button" data-fanlink-send aria-label="Send">Send</button>
     <input data-fanlink-file type="file" aria-label="Add media" />
     <div id="price-box" role="dialog" aria-label="Message price" hidden>
       <input data-fanlink-amount aria-label="Price amount" placeholder="Free" />
       <button type="button" data-fanlink-price-save>Save</button>
     </div>
     <input type="hidden" data-fanlink-price-value value="" />
     <div data-fanlink-history style="height:80px;overflow:auto"><div style="height:400px">hilo</div></div>
     <script>
       const history = document.querySelector("[data-fanlink-history]");
       history.scrollTop = 200;
       let older = false;
       history.onscroll = async () => {
         if (older || history.scrollTop > 0) return;
         older = true;
         await fetch("/api2/v2/chats/7/messages?before=2");
       };
       document.querySelector("[data-fanlink-price]").onclick = () => { document.getElementById("price-box").hidden = false; };
       document.querySelector("[data-fanlink-price-save]").onclick = () => {
         document.querySelector("[data-fanlink-price-value]").value = document.querySelector("[data-fanlink-amount]").value;
         document.getElementById("price-box").hidden = true;
       };
       document.querySelector("[data-fanlink-send]").onclick = async () => {
         const body = document.querySelector("[data-fanlink-composer]").value;
         const price = document.querySelector("[data-fanlink-price-value]").value;
         const file = document.querySelector("[data-fanlink-file]").files[0];
         await fetch("/fixture/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, price, file: file ? file.name : "" }) });
         await fetch("/api2/v2/chats/7/messages?order=desc");
       };
     </script>`,
  );
}

const blankHtml = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Blank</title></head><body>blank</body></html>`;

export async function startFixture(mode: FixtureMode = "users-me"): Promise<Fixture> {
  let epoch = 1;
  const hits: FixtureHits = { login: 0, session: 0, dashboard: 0 };
  const extraMessages: Array<{ id: number; text: string; at: string }> = [];
  const sent: Array<{ fan: string; body: string; price: string }> = [];
  const composed: Array<{ body: string; price: string; file: string }> = [];
  const confirmSends = { on: true };
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    void handle(req, res, () => epoch, hits, mode, extraMessages, sent, composed, confirmSends).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
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
    sent,
    composed,
    confirmSends,
    pushFanMessage(text: string) {
      extraMessages.push({
        id: 200 + extraMessages.length,
        text,
        at: "2026-11-05T11:00:00.000Z",
      });
    },
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
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
  extraMessages: Array<{ id: number; text: string; at: string }>,
  sent: Array<{ fan: string; body: string; price: string }>,
  composed: Array<{ body: string; price: string; file: string }>,
  confirmSends: { on: boolean },
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
        transactions: [
          {
            id: "tx-tip",
            createdAt: "2026-11-03T15:00:00.000Z",
            amount: 10,
            net: 8,
            type: "tip",
            currency: "USD",
            user: { id: 7, username: "fanuno" },
            password: "no-guardar",
          },
        ],
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
            subscribedOnData: { subscribedAt: "2026-10-01T00:00:00.000Z", totalSumm: 15.5, autoRenew: true, expiredAt: "2026-12-01T00:00:00.000Z" },
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
  if (req.method === "GET" && url.pathname === "/api2/v2/chats") {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    const latest = extraMessages.at(-1);
    if (url.searchParams.get("page") === "2") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        list: [
          { id: 8, withUser: { id: 8, username: "fanexp", name: "Fan Exp" }, unreadMessagesCount: 0, lastMessage: { id: 80, text: "antiguo", createdAt: "2026-10-01T10:00:00.000Z", fromUser: { id: 8 } } },
        ],
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        password: "no-guardar",
        list: [
          {
            id: 7,
            withUser: { id: 7, username: "fanuno", name: "Fan Uno" },
            unreadMessagesCount: latest ? 1 : 0,
            lastMessage: latest
              ? { id: latest.id, text: latest.text, createdAt: latest.at, fromUser: { id: 7 } }
              : { id: 100, text: "Hola, ¿sigues ahí?", createdAt: "2026-11-05T10:00:00.000Z", fromUser: { id: 7 } },
          },
        ],
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api2/v2/chats/7/messages") {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    if (url.searchParams.get("before") === "2") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        list: [{
          id: 1,
          text: "el primero",
          createdAt: "2026-11-01T10:00:00.000Z",
          fromUser: { id: 42 },
          isFavorite: true,
          isFromQueue: true,
          replyToMessage: { id: 9, text: "cita" },
          media: [{ type: "video", duration: 12, canView: true, isOpened: true, files: { thumb: { url: "https://cdn.example/thumb.jpg" } } }],
        }],
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        list: [
          { id: 100, text: "Hola, ¿sigues ahí?", createdAt: "2026-11-05T10:00:00.000Z", fromUser: { id: 7 } },
          { id: 101, text: "Sí, dime.", createdAt: "2026-11-05T10:05:00.000Z", fromUser: { id: 42 }, price: 5, purchased: true },
          ...extraMessages.map((item) => ({
            id: item.id,
            text: item.text,
            createdAt: item.at,
            fromUser: { id: 7 },
          })),
          ...(confirmSends.on ? composed.map((item, index) => ({
            id: 300 + index,
            text: item.body,
            createdAt: "2026-11-06T12:00:00.000Z",
            fromUser: { id: 42 },
            price: item.price ? Number(item.price) : undefined,
            isMine: true,
          })) : []),
        ],
      }),
    );
    return;
  }
  if (req.method === "GET" && /^\/api2\/v2\/chats\/(?:1|2|3|4|6|9)\/messages$/.test(url.pathname)) {
    if (!accepted(req, epoch())) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    const slow = url.searchParams.get("slow") === "1";
    if (url.searchParams.get("hang") === "1") {
      res.writeHead(200, { "content-type": "application/json" });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (slow) await new Promise((resolve) => setTimeout(resolve, 13_000));
    res.end(JSON.stringify({
      list: confirmSends.on ? composed.map((item, index) => ({
        id: 300 + index,
        text: item.body,
        createdAt: "2026-11-06T12:00:00.000Z",
        fromUser: { id: 42 },
        price: item.price ? Number(item.price) : undefined,
        isMine: true,
      })) : [],
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/fixture/vault") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ list: [{ id: "v1", type: "photo", title: "playa" }] }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/8") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("stuck"));
    return;
  }
  if (req.method === "POST" && /^\/api2\/v2\/chats\/(?:0|5)\/messages$/.test(url.pathname)) {
    if (url.pathname.endsWith("/chats/0/messages")) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      list: composed.map((item, index) => ({
        id: 300 + index,
        text: item.body,
        createdAt: new Date().toISOString(),
        fromUser: { id: 42 },
        isMine: true,
      })),
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/0") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("reject", "0"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/5") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("posting", "5"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/1") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("hang", "1"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/2") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("verylate", "2"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/3") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("late", "3"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/6") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("slow", "6"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/4") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml("enter", "4"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/9") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, ofChatHtml());
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/full") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, pageHtml(
      "Chats",
      "",
      `<div data-fanlink-chats style="height:80px;overflow:auto"><div style="height:400px">lista</div></div>
       <script>
         const box = document.querySelector("[data-fanlink-chats]");
         box.scrollTop = 0;
         let more = false;
         box.onscroll = async () => {
           if (more || box.scrollTop < 40) return;
           more = true;
           await fetch("/api2/v2/chats?page=2");
         };
       </script>`,
    ));
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/chat/7") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(res, chatComposerHtml());
    return;
  }
  if (req.method === "POST" && url.pathname === "/fixture/compose") {
    const raw = await readBodyText(req);
    const body = JSON.parse(raw) as { body?: string; price?: string; file?: string };
    composed.push({ body: body.body ?? "", price: body.price ?? "", file: body.file ?? "" });
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(
      res,
      pageHtml(
        "Chats",
        `<script>fetch("/api2/v2/chats?skip=0&token=sekret");</script>`,
        `<article data-fanlink-chat data-id="9" data-fan-id="9" data-handle="domfan" data-name="DOM" data-excerpt="desde el DOM" data-at="2026-11-05T09:00:00.000Z" data-unread="0">DOM</article>`,
      ),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/my/chats/7") {
    if (!accepted(req, epoch())) {
      redirect(res, "/login");
      return;
    }
    html(
      res,
      pageHtml("Hilo", `<script>fetch("/api2/v2/chats/7/messages?order=desc&token=sekret");</script>`, `<h1>Hilo</h1>`),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/simulate-send") {
    html(
      res,
      pageHtml(
        "Envío simulado",
        "",
        `<form method="POST" action="/simulate-send"><input name="fan" /><textarea name="body"></textarea><input name="price" /><button type="submit">Enviar</button></form>`,
      ),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/simulate-send") {
    const raw = await readBodyText(req);
    const params = new URLSearchParams(raw);
    sent.push({
      fan: params.get("fan") ?? "",
      body: params.get("body") ?? "",
      price: params.get("price") ?? "",
    });
    redirect(res, "/simulate-sent");
    return;
  }
  if (req.method === "GET" && url.pathname === "/simulate-sent") {
    html(res, pageHtml("Enviado", "", "<p>ok</p>"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/tall") {
    html(res, pageHtml("Alto", "", `<div style="height:5000px">sin chat</div>`));
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
  return readBodyText(req).then(() => undefined);
}

function readBodyText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
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
    chatsUrl: `${origin}/my/chats`,
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
