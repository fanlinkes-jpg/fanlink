import type { BrowserContext } from "playwright";
import type { RawData, WebSocket } from "ws";
import { attributeLiveSend, liveSendMatchesGesture } from "../sync/chat-store.ts";
import {
  claimControl,
  draftAfterKey,
  draftAfterPaste,
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
import { noteLiveHold, releaseLiveHold } from "./hold.ts";
import { takeLiveTicket, type LiveTicket } from "./tickets.ts";

type Viewer = { socket: WebSocket; userId: string; role: LiveRole; stamps: number[] };

type Room = {
  key: string;
  accountId: string;
  ticket: LiveTicket;
  viewers: Viewer[];
  holder: string | null;
  heldSince: string | null;
  lastGestureAt: string | null;
  draftBody: string;
  holderUsedAt: number;
  cast: LiveCast | null;
  release: (() => Promise<void>) | null;
  controlTimer: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();

type LiveOpener = {
  borrow: (accountId: string) => Promise<{ context: BrowserContext; release: () => Promise<void> }>;
  open: typeof startLiveCast;
};

let liveOpener: LiveOpener | null = null;

/** El test de la sala sustituye el Chromium. En producción queda vacío. */
export function useLiveOpener(opener: LiveOpener | null): void {
  liveOpener = opener;
}

export async function stopLiveRooms(): Promise<void> {
  await Promise.all([...rooms.values()].map((room) => stopRoom(room)));
}

async function borrowAccount(accountId: string): Promise<{ context: BrowserContext; release: () => Promise<void> }> {
  const { getOfSessionManager } = await import("../../../src/lib/of-sessions-runtime.server.ts");
  return (await getOfSessionManager()).borrowProfile(accountId);
}

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
    refuseLive(socket, "live", "El pase del directo no vale. Recarga la página.");
    return;
  }
  try {
    const room = await ensureRoom(ticket);
    if (!liveViewerAccepted(room.viewers.length)) {
      refuseLive(socket, room.accountId, "Ya hay demasiada gente en esta página.");
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
  } catch (error) {
    refuseLive(socket, ticket.accountId, liveFailureText(error));
  }
}

function refuseLive(socket: WebSocket, accountId: string, reason: string): void {
  console.info(liveLog("error", { accountId, detail: reason }));
  sendJson(socket, { type: "bye", reason });
  socket.close();
}

function liveFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : "No se pudo abrir OnlyFans";
  const line = message.split("\n")[0] ?? message;
  return line.replace(/\/Users\/\S+/g, "…").slice(0, 160);
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
    lastGestureAt: null,
    draftBody: "",
    holderUsedAt: Date.now(),
    cast: null,
    release: null,
    controlTimer: null,
    idle: null,
  };
  rooms.set(key, room);
  noteLiveHold(ticket.accountId);
  try {
    const borrowed = liveOpener
      ? await liveOpener.borrow(ticket.accountId)
      : await borrowAccount(ticket.accountId);
    room.release = borrowed.release;
    const openCast = liveOpener?.open ?? startLiveCast;
    room.cast = await openCast({
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
        const observedAt = new Date().toISOString();
        if (!liveSendMatchesGesture({
          messageId: message.messageId,
          sentAt: message.sentAt,
          controlSince: since,
          existingAuthorId: null,
          gestureAt: room.lastGestureAt,
          now: observedAt,
          body: message.body,
          draftBody: room.draftBody,
        })) return;
        void import("../../../src/lib/db.ts").then(async ({ getSql }) => attributeLiveSend(await getSql(), {
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
          gestureAt: room.lastGestureAt,
          observedAt,
          draftBody: room.draftBody,
        })).catch(() => undefined);
      },
    });
  } catch (error) {
    releaseLiveHold(ticket.accountId);
    await room.release?.().catch(() => undefined);
    room.release = null;
    rooms.delete(key);
    throw error;
  }
  return room;
}

async function onClientMessage(room: Room, viewer: Viewer, raw: string): Promise<void> {
  const event = parseLiveEvent(raw);
  if (!event || event.type === "auth") return;
  if (!takeLiveEventSlot(viewer.stamps, Date.now())) return;
  const typing = liveTypingEnabled();
  if ((event.type === "mouse" || event.type === "wheel") && viewer.role === "control" && room.cast) {
    if (event.type === "wheel" || (event.type === "mouse" && event.action === "move")) {
      if (!liveControlAllowed(typing, viewer.role, event.type, "scroll")) return;
    }
    if (typing && event.type === "mouse" && event.action === "down") room.lastGestureAt = new Date().toISOString();
    noteControl(room);
    await room.cast.send(event);
    return;
  }
  if (!liveControlAllowed(typing, viewer.role, event.type)) return;
  if (typing && event.type === "key" && event.key === "Enter") room.lastGestureAt = new Date().toISOString();
  if (typing && event.type === "key") room.draftBody = draftAfterKey(room.draftBody, event.key, event.down);
  if (typing && event.type === "text") room.draftBody = draftAfterPaste(room.draftBody, event.text);
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
  room.lastGestureAt = null;
  room.draftBody = "";
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
  if (rooms.get(room.key) !== room) return;
  if (room.idle) clearTimeout(room.idle);
  room.idle = setTimeout(() => {
    if (room.viewers.length === 0) void stopRoom(room);
  }, 5_000);
}

async function stopRoom(room: Room): Promise<void> {
  if (rooms.get(room.key) !== room) return;
  rooms.delete(room.key);
  releaseLiveHold(room.accountId);
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
