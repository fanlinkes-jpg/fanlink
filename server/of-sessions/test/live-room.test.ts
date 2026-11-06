import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import { attachLiveView } from "../live/attach.ts";
import { stopLiveRooms, useLiveOpener } from "../live/room.ts";
import { issueLiveTicket } from "../live/tickets.ts";

test("el socket da el control al primero, rechaza el quinto y lo cede al soltar", async () => {
  useLiveOpener({
    async borrow() {
      return { context: {} as never, release: async () => undefined };
    },
    async open() {
      return { async send() {}, acceptFile() {}, async stop() {} };
    },
  });
  const server = createServer();
  attachLiveView(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const open: WebSocket[] = [];
  try {
    const first = await join(port, origin, "ana-control");
    const second = await join(port, origin, "luis-visor");
    const third = await join(port, origin, "nora-visor");
    const fourth = await join(port, origin, "pia-visor");
    open.push(first.socket, second.socket, third.socket, fourth.socket);
    assert.deepEqual([first.role, second.role, third.role, fourth.role], ["control", "view", "view", "view"]);
    assert.equal(await closed(port, origin, "quinto"), true);
    assert.equal(await closed(port, "http://evil.example", "ajena"), true);
    assert.equal(await closed(port, origin, "url", "/api/live-view?ticket=no-en-la-url"), true);
    const handed = nextRole(second.socket);
    first.socket.send(JSON.stringify({ type: "release" }));
    assert.equal(await handed, "control");
  } finally {
    for (const socket of open) socket.close();
    await stopLiveRooms();
    useLiveOpener(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function ticketFor(userId: string): string {
  return issueLiveTicket({
    userId,
    accountId: "acc-sala",
    creatorId: "c",
    threadKey: "7",
    fanKey: "7",
    accountUserId: "42",
  });
}

function join(port: number, origin: string, userId: string): Promise<{ socket: WebSocket; role: string }> {
  const ticket = ticketFor(userId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("la sala no contestó")), 2_000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/live-view`, { headers: { origin } });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", ticket })));
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      if (!text.startsWith("{")) return;
      const status = JSON.parse(text) as { role?: string };
      if (!status.role) return;
      clearTimeout(timer);
      resolve({ socket, role: status.role });
    });
  });
}

function nextRole(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no llegó el relevo")), 2_000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      const text = typeof data === "string" ? data : data.toString();
      const status = JSON.parse(text) as { role?: string };
      resolve(status.role ?? "");
    });
  });
}

function closed(port: number, origin: string, userId: string, path = "/api/live-view"): Promise<boolean> {
  const ticket = ticketFor(userId);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 2_000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { origin } });
    const finish = (value: boolean) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    socket.on("error", () => finish(true));
    socket.on("close", () => finish(true));
    socket.on("open", () => {
      if (!path.includes("ticket=")) socket.send(JSON.stringify({ type: "auth", ticket }));
    });
  });
}
