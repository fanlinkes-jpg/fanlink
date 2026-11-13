import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import { attachLiveView } from "../live/attach.ts";
import { liveHoldsAccount, stopLiveForAccount } from "../live/hold.ts";
import { stopLiveRooms, useLiveOpener } from "../live/room.ts";
import { issueLiveTicket } from "../live/tickets.ts";

// El bucle que se veía al cargar OnlyFans: una sala que no llegó a abrir (o que
// se quedó sin visores) seguía en memoria con la cuenta retenida. Los lectores de
// fondo devolvían «sincronización en curso» para siempre, el siguiente visor
// entraba en una sala sin imagen y Conectar abría un segundo Chromium sobre el
// mismo perfil.

test("si OnlyFans no abre, la sala no se queda a medias ni retiene la cuenta", async () => {
  let opens = 0;
  let releases = 0;
  useLiveOpener({
    async borrow() {
      return { context: {} as never, release: async () => { releases += 1; } };
    },
    async open() {
      opens += 1;
      if (opens === 1) throw new Error("Target page, context or browser has been closed");
      return { async send() {}, acceptFile() {}, async stop() {} };
    },
  });
  const { server, port, origin } = await listen();
  try {
    const first = await join(port, origin, "ana", "acc-roto");
    assert.equal(first.kind, "bye");
    assert.equal(liveHoldsAccount("acc-roto"), false, "la cuenta sigue retenida tras el fallo");
    assert.equal(releases, 1, "el perfil prestado no se soltó");
    const second = await join(port, origin, "ana", "acc-roto");
    assert.equal(second.kind, "status", "el segundo intento entra en la sala rota");
    assert.equal(opens, 2, "el segundo intento no vuelve a abrir OnlyFans");
    second.socket?.close();
  } finally {
    await stopLiveRooms();
    useLiveOpener(null);
    await close(server);
  }
});

test("sin visores la sala se cierra tras la espera; volver a tiempo no abre otra", async () => {
  const before = process.env.FANLINK_LIVE_GRACE_MS;
  process.env.FANLINK_LIVE_GRACE_MS = "150";
  let opens = 0;
  let stops = 0;
  let releases = 0;
  useLiveOpener({
    async borrow() {
      return { context: {} as never, release: async () => { releases += 1; } };
    },
    async open() {
      opens += 1;
      return { async send() {}, acceptFile() {}, async stop() { stops += 1; } };
    },
  });
  const { server, port, origin } = await listen();
  try {
    const first = await join(port, origin, "ana", "acc-gracia");
    first.socket?.close();
    await wait(40);
    const back = await join(port, origin, "ana", "acc-gracia");
    assert.equal(back.kind, "status");
    assert.equal(opens, 1, "un corte breve abre otra página");
    back.socket?.close();
    await wait(400);
    assert.equal(liveHoldsAccount("acc-gracia"), false, "la sala vacía sigue reteniendo la cuenta");
    assert.equal(stops, 1);
    assert.equal(releases, 1);
  } finally {
    if (before == null) delete process.env.FANLINK_LIVE_GRACE_MS;
    else process.env.FANLINK_LIVE_GRACE_MS = before;
    await stopLiveRooms();
    useLiveOpener(null);
    await close(server);
  }
});

test("Conectar cierra la vista en directo de esa cuenta antes de abrir el login", async () => {
  let releases = 0;
  useLiveOpener({
    async borrow() {
      return { context: {} as never, release: async () => { releases += 1; } };
    },
    async open() {
      return { async send() {}, acceptFile() {}, async stop() {} };
    },
  });
  const { server, port, origin } = await listen();
  try {
    const viewer = await join(port, origin, "ana", "acc-login");
    assert.equal(liveHoldsAccount("acc-login"), true);
    const bye = nextText(viewer.socket!);
    await stopLiveForAccount("acc-login");
    assert.equal(liveHoldsAccount("acc-login"), false);
    assert.equal(releases, 1);
    assert.match(await bye, /bye/);
  } finally {
    await stopLiveRooms();
    useLiveOpener(null);
    await close(server);
  }
});

async function listen(): Promise<{ server: Server; port: number; origin: string }> {
  const server = createServer();
  attachLiveView(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return { server, port, origin: `http://127.0.0.1:${port}` };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function join(port: number, origin: string, userId: string, accountId: string): Promise<{ kind: "status" | "bye" | "closed"; socket: WebSocket | null }> {
  const ticket = issueLiveTicket({ userId, accountId, creatorId: "c", threadKey: "inbox", fanKey: null, accountUserId: "42" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("la sala no contestó")), 2_000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/live-view`, { headers: { origin } });
    let done = false;
    const finish = (kind: "status" | "bye" | "closed") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ kind, socket: kind === "status" ? socket : null });
    };
    socket.on("error", () => finish("closed"));
    socket.on("close", () => finish("closed"));
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", ticket })));
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      if (!text.startsWith("{")) return;
      const status = JSON.parse(text) as { type?: string; role?: string };
      if (status.type === "bye") finish("bye");
      else if (status.role) finish("status");
    });
  });
}

function nextText(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      if (text.includes("bye")) resolve(text);
    });
    socket.on("close", () => resolve("bye (cerrado)"));
  });
}
