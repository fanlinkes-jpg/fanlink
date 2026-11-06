import type { WebSocket } from "ws";
import { getSql } from "../../../src/lib/db.ts";
import { getOfSessionManager } from "../../../src/lib/of-sessions-runtime.server.ts";
import { attributeLiveSend } from "../sync/chat-store.ts";
import { claimControl, liveFps, liveLog, releaseControl, type DeskInput, type LiveRole } from "./desk.ts";
import { startLiveCast, type LiveCast } from "./session.ts";
import { takeLiveTicket, type LiveTicket } from "./tickets.ts";

type Viewer = { socket: WebSocket; userId: string; role: LiveRole };

type Room = {
  accountId: string;
  ticket: LiveTicket;
  viewers: Viewer[];
  holder: string | null;
  cast: LiveCast | null;
  release: (() => Promise<void>) | null;
  idle: ReturnType<typeof setTimeout> | null;
  lastUse: number;
};

const rooms = new Map<string, Room>();

export async function joinLive(socket: WebSocket, ticketId: string): Promise<void> {
  const ticket = takeLiveTicket(ticketId);
  if (!ticket) {
    socket.close();
    return;
  }
  const room = await ensureRoom(ticket);
  const claimed = claimControl(room.holder, ticket.userId);
  room.holder = claimed.holder;
  const viewer: Viewer = { socket, userId: ticket.userId, role: claimed.role };
  room.viewers.push(viewer);
  touch(room);
  sendJson(socket, { type: "status", role: viewer.role, fps: liveFps(process.env.FANLINK_LIVE_FPS) });
  if (claimed.role === "control") {
    console.info(liveLog("control", { accountId: room.accountId, userId: ticket.userId, fps: liveFps(process.env.FANLINK_LIVE_FPS) }));
  }
  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const text = typeof data === "string" ? data : data.toString("utf8");
    void onClientMessage(room, viewer, text).catch((error: unknown) => {
      console.info(liveLog("error", { accountId: room.accountId, detail: error instanceof Error ? error.message : "mensaje" }));
    });
  });
  socket.on("close", () => {
    room.viewers = room.viewers.filter((item) => item !== viewer);
    const freed = releaseControl(room.holder, viewer.userId, room.viewers.map((item) => item.userId));
    room.holder = freed.holder;
    const next = room.viewers.find((item) => item.userId === freed.next);
    if (next) {
      next.role = "control";
      sendJson(next.socket, { type: "status", role: "control", fps: liveFps(process.env.FANLINK_LIVE_FPS) });
      console.info(liveLog("control", { accountId: room.accountId, userId: next.userId, fps: liveFps(process.env.FANLINK_LIVE_FPS) }));
    }
    if (room.viewers.length === 0) scheduleStop(room);
  });
}

async function ensureRoom(ticket: LiveTicket): Promise<Room> {
  const existing = rooms.get(ticket.accountId);
  if (existing) {
    existing.ticket = ticket;
    touch(existing);
    return existing;
  }
  const room: Room = {
    accountId: ticket.accountId,
    ticket,
    viewers: [],
    holder: null,
    cast: null,
    release: null,
    idle: null,
    lastUse: Date.now(),
  };
  rooms.set(ticket.accountId, room);
  const sessions = await getOfSessionManager();
  const borrowed = await sessions.borrowProfile(ticket.accountId);
  room.release = borrowed.release;
  room.cast = await startLiveCast({
    context: borrowed.context,
    accountId: ticket.accountId,
    threadKey: ticket.threadKey,
    fanKey: ticket.fanKey,
    accountUserId: ticket.accountUserId,
    onFrame: (frame) => {
      for (const viewer of room.viewers) {
        if (viewer.socket.readyState === viewer.socket.OPEN) viewer.socket.send(frame.jpeg);
      }
    },
    onFile: () => {
      const controller = room.viewers.find((viewer) => viewer.role === "control");
      if (controller) sendJson(controller.socket, { type: "file" });
    },
    onOwnMessage: (message) => {
      const holder = room.holder;
      if (!holder) return;
      void getSql().then((sql) => attributeLiveSend(sql, {
        id: crypto.randomUUID(),
        creatorId: room.ticket.creatorId,
        threadKey: room.ticket.threadKey,
        fanKey: room.ticket.fanKey,
        authorId: holder,
        body: message.body,
        priceCents: message.priceCents,
        messageId: message.messageId,
        createdAt: new Date().toISOString(),
      })).catch(() => undefined);
    },
  }).catch(async (error: unknown) => {
    await borrowed.release().catch(() => undefined);
    rooms.delete(ticket.accountId);
    throw error;
  });
  return room;
}

async function onClientMessage(room: Room, viewer: Viewer, raw: string): Promise<void> {
  const parsed = JSON.parse(raw) as DeskInput | { type: "file"; name?: string; mime?: string; data?: string };
  if (parsed.type === "file") {
    if (viewer.role !== "control") return;
    const bytes = parsed.data ? Buffer.from(parsed.data, "base64") : null;
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 20_000_000) {
      room.cast?.acceptFile(null);
      return;
    }
    room.cast?.acceptFile({
      name: (parsed.name ?? "archivo").slice(0, 120),
      mimeType: parsed.mime || "application/octet-stream",
      buffer: bytes,
    });
    touch(room);
    return;
  }
  if (viewer.role !== "control" || !room.cast) return;
  touch(room);
  await room.cast.send(parsed);
}

function touch(room: Room): void {
  room.lastUse = Date.now();
  if (room.idle) clearTimeout(room.idle);
  const idleMs = idleLimit();
  room.idle = setTimeout(() => {
    if (Date.now() - room.lastUse < idleMs) return;
    void stopRoom(room);
  }, idleMs);
}

function scheduleStop(room: Room): void {
  if (room.idle) clearTimeout(room.idle);
  room.idle = setTimeout(() => {
    if (room.viewers.length === 0) void stopRoom(room);
  }, 5_000);
}

async function stopRoom(room: Room): Promise<void> {
  if (rooms.get(room.accountId) !== room) return;
  rooms.delete(room.accountId);
  if (room.idle) clearTimeout(room.idle);
  await room.cast?.stop().catch(() => undefined);
  await room.release?.().catch(() => undefined);
  for (const viewer of room.viewers) viewer.socket.close();
}

function idleLimit(): number {
  const value = Number(process.env.FANLINK_LIVE_IDLE_MS);
  if (!Number.isInteger(value) || value < 15_000 || value > 30 * 60_000) return 90_000;
  return value;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
