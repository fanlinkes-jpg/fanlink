import type { RawData, WebSocket } from "ws";
import { getSql } from "../../../src/lib/db.ts";
import { getOfSessionManager } from "../../../src/lib/of-sessions-runtime.server.ts";
import { attributeLiveSend, liveSendAttributable } from "../sync/chat-store.ts";
import {
  claimControl,
  liveControlAllowed,
  liveFps,
  liveLog,
  liveRoomKey,
  liveTypingEnabled,
  liveViewerAccepted,
  parseLiveEvent,
  releaseControl,
  releaseIdleController,
  takeLiveEventSlot,
  type LiveRole,
} from "./desk.ts";
import { startLiveCast, type LiveCast } from "./session.ts";
import { takeLiveTicket, type LiveTicket } from "./tickets.ts";

type Viewer = { socket: WebSocket; userId: string; role: LiveRole; stamps: number[] };

type Room = {
  key: string;
  accountId: string;
  ticket: LiveTicket;
  viewers: Viewer[];
  holder: string | null;
  heldSince: string | null;
  holderUsedAt: number;
  cast: LiveCast | null;
  release: (() => Promise<void>) | null;
  controlTimer: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();

/** El ticket llega en el primer mensaje, no en la URL. */
export function acceptLiveSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.close();
      resolve();
    }, 5_000);
    const onMessage = (data: RawData, isBinary: boolean) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      if (isBinary) {
        socket.close();
        resolve();
        return;
      }
      const text = typeof data === "string" ? data : data.toString("utf8");
      const event = parseLiveEvent(text);
      if (!event || event.type !== "auth") {
        socket.close();
        resolve();
        return;
      }
      void joinLive(socket, event.ticket).then(resolve, () => {
        socket.close();
        resolve();
      });
    };
    socket.on("message", onMessage);
  });
}

export async function joinLive(socket: WebSocket, ticketId: string): Promise<void> {
  const ticket = takeLiveTicket(ticketId);
  if (!ticket) {
    socket.close();
    return;
  }
  const room = await ensureRoom(ticket);
  if (!liveViewerAccepted(room.viewers.length)) {
    socket.close();
    return;
  }
  const claimed = claimControl(room.holder, ticket.userId);
  if (claimed.role === "control" && room.heldSince == null) {
    room.heldSince = new Date().toISOString();
    room.holderUsedAt = Date.now();
  }
  room.holder = claimed.holder;
  const viewer: Viewer = { socket, userId: ticket.userId, role: claimed.role, stamps: [] };
  room.viewers.push(viewer);
  sendJson(socket, statusOf(room, viewer.role));
  if (claimed.role === "control") {
    console.info(liveLog("control", { accountId: room.accountId, userId: ticket.userId, fps: liveFps(process.env.FANLINK_LIVE_FPS) }));
    armControlTimer(room);
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
    if (freed.holder !== room.holder) applyHolder(room, freed.holder);
    if (room.viewers.length === 0) scheduleStop(room);
  });
}

async function ensureRoom(ticket: LiveTicket): Promise<Room> {
  const key = liveRoomKey(ticket.accountId, ticket.threadKey);
  const existing = rooms.get(key);
  if (existing) {
    existing.ticket = ticket;
    return existing;
  }
  const room: Room = {
    key,
    accountId: ticket.accountId,
    ticket,
    viewers: [],
    holder: null,
    heldSince: null,
    holderUsedAt: Date.now(),
    cast: null,
    release: null,
    controlTimer: null,
    idle: null,
  };
  rooms.set(key, room);
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
      const controller = room.viewers.find((viewer) => viewer.role === "control" && liveTypingEnabled());
      if (controller) sendJson(controller.socket, { type: "file" });
    },
    onOwnMessage: (message) => {
      const holder = room.holder;
      const since = room.heldSince;
      if (!holder || !since) return;
      if (!liveSendAttributable({ messageId: message.messageId, sentAt: message.sentAt, controlSince: since, existingAuthorId: null })) return;
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
        sentAt: message.sentAt,
        controlSince: since,
      })).catch(() => undefined);
    },
  }).catch(async (error: unknown) => {
    await borrowed.release().catch(() => undefined);
    rooms.delete(key);
    throw error;
  });
  return room;
}

async function onClientMessage(room: Room, viewer: Viewer, raw: string): Promise<void> {
  const event = parseLiveEvent(raw);
  if (!event || event.type === "auth") return;
  if (!takeLiveEventSlot(viewer.stamps, Date.now())) return;
  const typing = liveTypingEnabled();
  if (!liveControlAllowed(typing, viewer.role, event.type)) return;
  if (event.type === "release") {
    const freed = releaseControl(room.holder, viewer.userId, room.viewers.map((item) => item.userId));
    applyHolder(room, freed.holder);
    return;
  }
  if (event.type === "claim") {
    if (room.holder && room.holder !== viewer.userId) return;
    applyHolder(room, viewer.userId);
    return;
  }
  if (event.type === "file") {
    const bytes = event.data ? Buffer.from(event.data, "base64") : null;
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 500_000) {
      room.cast?.acceptFile(null);
      return;
    }
    room.cast?.acceptFile({ name: event.name || "archivo", mimeType: event.mime || "application/octet-stream", buffer: bytes });
    noteControl(room);
    return;
  }
  if (!room.cast) return;
  noteControl(room);
  await room.cast.send(event);
}

function applyHolder(room: Room, holder: string | null): void {
  room.holder = holder;
  room.heldSince = holder ? new Date().toISOString() : null;
  room.holderUsedAt = Date.now();
  for (const viewer of room.viewers) {
    viewer.role = holder != null && viewer.userId === holder ? "control" : "view";
    sendJson(viewer.socket, statusOf(room, viewer.role));
  }
  if (holder) {
    console.info(liveLog("control", { accountId: room.accountId, userId: holder, fps: liveFps(process.env.FANLINK_LIVE_FPS) }));
    armControlTimer(room);
    return;
  }
  if (room.controlTimer) clearTimeout(room.controlTimer);
}

function noteControl(room: Room): void {
  room.holderUsedAt = Date.now();
  armControlTimer(room);
}

function armControlTimer(room: Room): void {
  if (room.controlTimer) clearTimeout(room.controlTimer);
  const idleMs = idleLimit();
  room.controlTimer = setTimeout(() => {
    if (!room.holder || Date.now() - room.holderUsedAt < idleMs - 50) return;
    const freed = releaseIdleController(room.holder, room.viewers.map((item) => item.userId));
    applyHolder(room, freed.holder);
  }, idleMs);
}

function scheduleStop(room: Room): void {
  if (room.idle) clearTimeout(room.idle);
  room.idle = setTimeout(() => {
    if (room.viewers.length === 0) void stopRoom(room);
  }, 5_000);
}

async function stopRoom(room: Room): Promise<void> {
  if (rooms.get(room.key) !== room) return;
  rooms.delete(room.key);
  if (room.idle) clearTimeout(room.idle);
  if (room.controlTimer) clearTimeout(room.controlTimer);
  await room.cast?.stop().catch(() => undefined);
  await room.release?.().catch(() => undefined);
  for (const viewer of room.viewers) viewer.socket.close();
}

function idleLimit(): number {
  const value = Number(process.env.FANLINK_LIVE_IDLE_MS);
  if (!Number.isInteger(value) || value < 15_000 || value > 30 * 60_000) return 90_000;
  return value;
}

function statusOf(room: Room, role: LiveRole): { type: "status"; role: LiveRole; send: boolean; fps: number; holder: boolean } {
  return { type: "status", role, send: liveTypingEnabled(), fps: liveFps(process.env.FANLINK_LIVE_FPS), holder: room.holder != null };
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
