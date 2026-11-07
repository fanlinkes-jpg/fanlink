import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "node:test";
import { attributeLiveSend, liveSendAttributable, liveSendMatchesGesture } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";
import {
  LIVE_MAX_PAYLOAD,
  claimControl,
  deskCommand,
  draftAfterKey,
  draftAfterPaste,
  liveControlAllowed,
  liveFps,
  liveLog,
  liveOriginAllowed,
  liveOutgoingSocketBlocked,
  liveRequestAllowed,
  liveRoomKey,
  liveSocketGuardSource,
  liveTypingEnabled,
  liveUpgradeAllowed,
  liveViewerAccepted,
  liveViewGate,
  mapPointer,
  parseLiveEvent,
  releaseControl,
  releaseIdleController,
  takeLiveEventSlot,
} from "../live/desk.ts";

const account = { creatorId: "9ikis52", accountId: "acc", handle: "bigpoppa1111", userId: "42", label: "Prueba" };

test("la vista en directo sigue apagada sin el flag o fuera de la allowlist", () => {
  assert.equal(liveViewGate(undefined, "9ikis52", account).allowed, false);
  assert.equal(liveViewGate("true", "", account).allowed, false);
  assert.equal(liveViewGate("true", "otra", account).allowed, false);
  assert.equal(liveViewGate("true", "@bigpoppa1111", account).allowed, true);
});

test("la pestaña no sale de OnlyFans ni de su CDN", () => {
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/chats/chat/28022478"), true);
  assert.equal(liveRequestAllowed("https://cdn2.onlyfans.com/v.mp4"), true);
  assert.equal(liveRequestAllowed("https://static2.onlyfans.com/theme/onlyfans/spa/app.js"), true);
  assert.equal(liveRequestAllowed("https://example.com/"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com.evil/x"), false);
  assert.equal(liveRequestAllowed("about:blank"), true);
});

test("un miembro no llega a statements, estadísticas, banca, pagos ni ajustes", () => {
  for (const path of ["/my/statements", "/my/statistics", "/my/banking", "/my/payouts", "/my/settings", "/my/settings/profile", "/my/payments"]) {
    assert.equal(liveRequestAllowed(`https://onlyfans.com${path}`), false, path);
    assert.equal(liveRequestAllowed(`https://onlyfans.com/api2/v2${path}`), false, path);
  }
  assert.equal(liveRequestAllowed("https://onlyfans.com/my/chats/chat/28022478"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/28022478/messages"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/users/me"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/init"), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/users/me", "POST", true), false);
  assert.equal(liveRequestAllowed("https://cdn2.onlyfans.com/my/statements"), false);
});

test("sin FANLINK_ENABLE_SEND no hay teclado, Enter ni archivos", () => {
  assert.equal(liveTypingEnabled("false"), false);
  assert.equal(liveTypingEnabled(undefined), false);
  assert.equal(liveTypingEnabled("true"), true);
  const viewport = { width: 800, height: 600 };
  assert.equal(deskCommand({ type: "key", key: "Enter", code: "Enter", down: true }, viewport, false), null);
  assert.equal(deskCommand({ type: "text", text: "hola" }, viewport, false), null);
  assert.equal(deskCommand({ type: "mouse", action: "move", x: 1, y: 1, canvasWidth: 10, canvasHeight: 10 }, viewport, false)?.method, "Input.dispatchMouseEvent");
  assert.equal(liveControlAllowed(false, "control", "key"), false);
  assert.equal(liveControlAllowed(false, "control", "text"), false);
  assert.equal(liveControlAllowed(false, "control", "file"), false);
  assert.equal(liveControlAllowed(false, "control", "mouse"), false);
  assert.equal(liveControlAllowed(false, "control", "mouse", "scroll"), true);
  assert.equal(liveControlAllowed(false, "control", "mouse", "thread"), true);
  assert.equal(liveControlAllowed(false, "control", "wheel", "scroll"), true);
  assert.equal(liveControlAllowed(true, "view", "key"), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/messages", "POST", false), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/users", "POST", false), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/users", "PUT", false), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/messages", "DELETE", false), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/likes", "PUT", false), false);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/messages", "POST", true), true);
  assert.equal(liveRequestAllowed("https://onlyfans.com/api2/v2/chats/1/messages", "GET", false), true);
  assert.equal(liveRequestAllowed("https://unknown.onlyfans.com/secret"), false);
  assert.equal(liveRequestAllowed("https://api2.onlyfans.com/api2/v2/chats/1/messages"), true);
  assert.equal(liveRequestAllowed("https://ws2.onlyfans.com/ws2/", "POST", false), false);
  assert.equal(liveRequestAllowed("https://ws2.onlyfans.com/socket.io/", "PUT", false), false);
  assert.equal(liveRequestAllowed("wss://ws2.onlyfans.com/ws2/", "GET", false), true);
});

test("el borrador acumula las teclas y el borrado", () => {
  let body = "";
  for (const key of ["h", "o", "l", "a"]) body = draftAfterKey(body, key, true);
  assert.equal(body, "hola");
  body = draftAfterKey(body, "a", false);
  assert.equal(body, "hola");
  body = draftAfterKey(body, "Backspace", true);
  body = draftAfterKey(body, "Backspace", false);
  assert.equal(body, "hol");
  body = draftAfterKey(body, "Enter", true);
  assert.equal(body, "hol");
  body = draftAfterPaste(body, "a");
  body = draftAfterKey(body, "🙂", true);
  body = draftAfterKey(body, "Delete", true);
  assert.equal(body, "hola");
});

test("en solo lectura no sale un frame por /ws", () => {
  assert.equal(liveOutgoingSocketBlocked("wss://ws2.onlyfans.com/ws2/?x=1", false), true);
  assert.equal(liveOutgoingSocketBlocked("wss://ws.onlyfans.com/socket.io/", false), true);
  assert.equal(liveOutgoingSocketBlocked("wss://ws2.onlyfans.com/ws2/", true), false);
  assert.equal(liveOutgoingSocketBlocked("https://onlyfans.com/api2/v2/chats/1/messages", false), false);
  const quiet = socketSends(liveSocketGuardSource(false));
  quiet("wss://ws2.onlyfans.com/ws2/", "escribir");
  quiet("wss://ws2.onlyfans.com/api2/v2/chats/1/messages", "leer");
  assert.deepEqual(quiet.sent, ["leer"]);
  const typing = socketSends(liveSocketGuardSource(true));
  typing("wss://ws2.onlyfans.com/ws2/", "escribir");
  assert.deepEqual(typing.sent, ["escribir"]);
});

test("el ratón del canvas cae en el viewport y Enter no es texto", () => {
  assert.deepEqual(mapPointer(10, 20, { width: 100, height: 100 }, { width: 1000, height: 500 }), { x: 100, y: 100 });
  const mouse = deskCommand({
    type: "mouse",
    action: "down",
    x: 10,
    y: 20,
    canvasWidth: 100,
    canvasHeight: 100,
    button: "left",
  }, { width: 1000, height: 500 });
  assert.equal(mouse?.method, "Input.dispatchMouseEvent");
  assert.equal(mouse?.params.x, 100);
  assert.equal(mouse?.params.y, 100);
  const enter = deskCommand({ type: "key", key: "Enter", code: "Enter", down: true }, { width: 800, height: 600 });
  assert.equal(enter?.method, "Input.dispatchKeyEvent");
  assert.equal(enter?.params.windowsVirtualKeyCode, 13);
  assert.equal(enter?.params.type, "keyDown");
  const letter = deskCommand({ type: "key", key: "a", code: "KeyA", down: true }, { width: 800, height: 600 });
  assert.equal(letter?.method, "Input.insertText");
  const paste = deskCommand({ type: "text", text: "hola secreto" }, { width: 800, height: 600 });
  assert.equal(paste?.method, "Input.insertText");
  const line = liveLog("control", { accountId: "acc", userId: "ana", fps: 4 });
  assert.equal(line.includes("hola"), false);
  assert.match(line, /\[fanlink:live\] control cuenta=acc control=ana fps=4/);
});

test("el evento del cliente tiene esquema, tope y límite por segundo", () => {
  assert.equal(parseLiveEvent("no-json"), null);
  assert.equal(parseLiveEvent(JSON.stringify({ type: "otro" })), null);
  assert.equal(parseLiveEvent("x".repeat(LIVE_MAX_PAYLOAD + 1)), null);
  const enter = parseLiveEvent(JSON.stringify({ type: "key", key: "Enter", code: "Enter", down: true }));
  assert.equal(enter?.type, "key");
  const stamps: number[] = [];
  for (let index = 0; index < 40; index += 1) assert.equal(takeLiveEventSlot(stamps, 1_000), true);
  assert.equal(takeLiveEventSlot(stamps, 1_000), false);
  assert.equal(takeLiveEventSlot(stamps, 2_100), true);
});

test("ceder el control no echa a quien mira y cada hilo va aparte", () => {
  const idle = releaseIdleController("ana", ["ana", "luis"]);
  assert.equal(idle.closeViewers, false);
  assert.equal(idle.holder, "luis");
  const alone = releaseIdleController("ana", ["ana"]);
  assert.equal(alone.holder, null);
  assert.equal(alone.closeViewers, false);
  assert.notEqual(liveRoomKey("acc", "7"), liveRoomKey("acc", "8"));
  assert.equal(liveViewerAccepted(3), true);
  assert.equal(liveViewerAccepted(4), false);
  assert.equal(liveFps("100"), 4);
  assert.equal(liveFps("8"), 8);
});

test("el socket exige el origen de la app y no lleva el ticket en la URL", () => {
  assert.equal(liveOriginAllowed("http://127.0.0.1:8080", "127.0.0.1:8080"), true);
  assert.equal(liveOriginAllowed("https://evil.example", "127.0.0.1:8080"), false);
  assert.equal(liveOriginAllowed(undefined, "127.0.0.1:8080"), false);
  assert.equal(liveUpgradeAllowed("/api/live-view", "http://127.0.0.1:8080", "127.0.0.1:8080"), true);
  assert.equal(liveUpgradeAllowed("/api/live-view?ticket=secreto", "http://127.0.0.1:8080", "127.0.0.1:8080"), false);
  assert.equal(liveUpgradeAllowed("/api/live-view", "https://evil.example", "127.0.0.1:8080"), false);
});

test("un mensaje viejo no cambia de autor", async () => {
  assert.equal(liveSendAttributable({
    messageId: "m-viejo",
    sentAt: "2020-01-01T00:00:00.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: null,
  }), false);
  assert.equal(liveSendAttributable({
    messageId: "m-nuevo",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: "otra",
  }), false);
  assert.equal(liveSendAttributable({
    messageId: "m-nuevo",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: null,
  }), true);
  assert.equal(liveSendMatchesGesture({
    messageId: "m-nuevo",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: null,
    gestureAt: null,
    now: "2026-11-06T12:00:06.000Z",
    body: "hola",
    draftBody: "hola",
  }), false);
  assert.equal(liveSendMatchesGesture({
    messageId: "m-nuevo",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: null,
    gestureAt: "2026-11-06T12:00:04.000Z",
    now: "2026-11-06T12:00:06.000Z",
    body: "hola",
    draftBody: "adios",
  }), false);
  assert.equal(liveSendMatchesGesture({
    messageId: "m-nuevo",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    existingAuthorId: null,
    gestureAt: "2026-11-06T12:00:04.000Z",
    now: "2026-11-06T12:00:06.000Z",
    body: "hola",
    draftBody: "Hola",
  }), true);

  const calls: string[] = [];
  const historical: ReadSql = {
    async query<T>(text: string): Promise<T[]> {
      calls.push(text);
      if (text.includes("select author_id")) return [{ author_id: null, sent_at: "2020-01-01T00:00:00.000Z" }] as T[];
      return [] as T[];
    },
  };
  assert.equal(await attributeLiveSend(historical, {
    id: "out-1",
    creatorId: "c",
    threadKey: "7",
    fanKey: "7",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    messageId: "m-viejo",
    createdAt: "2026-11-06T12:00:05.000Z",
    sentAt: "2020-01-01T00:00:00.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    gestureAt: "2026-11-06T12:00:04.000Z",
    observedAt: "2026-11-06T12:00:06.000Z",
    draftBody: "hola",
  }), false);
  assert.equal(calls.some((text) => text.includes("update of_chat_message")), false);
  assert.equal(calls.some((text) => text.includes("insert into of_chat_outbound")), false);

  const freshCalls: string[] = [];
  const fresh: ReadSql = {
    async query<T>(text: string): Promise<T[]> {
      freshCalls.push(text);
      return [] as T[];
    },
  };
  assert.equal(await attributeLiveSend(fresh, {
    id: "out-2",
    creatorId: "c",
    threadKey: "7",
    fanKey: "7",
    authorId: "ana",
    body: "hola",
    priceCents: null,
    messageId: "m-nuevo",
    createdAt: "2026-11-06T12:00:05.000Z",
    sentAt: "2026-11-06T12:00:05.000Z",
    controlSince: "2026-11-06T12:00:00.000Z",
    gestureAt: "2026-11-06T12:00:04.000Z",
    observedAt: "2026-11-06T12:00:06.000Z",
    draftBody: "hola",
  }), true);
  assert.equal(freshCalls.some((text) => text.includes("insert into of_chat_outbound")), true);
  const update = freshCalls.find((text) => text.includes("update of_chat_message"));
  assert.match(update ?? "", /author_id is null/);
  assert.match(update ?? "", /sent_at >=/);
});

test("solo un visor tiene el control de la cuenta", () => {
  const first = claimControl(null, "ana");
  assert.equal(first.role, "control");
  const second = claimControl(first.holder, "luis");
  assert.equal(second.role, "view");
  assert.equal(second.holder, "ana");
  const freed = releaseControl(second.holder, "ana", ["ana", "luis"]);
  assert.equal(freed.holder, "luis");
  assert.equal(freed.next, "luis");
});

function socketSends(source: string): { (url: string, data: string): void; sent: string[] } {
  const sent: string[] = [];
  class Socket {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
    send(data: string) {
      sent.push(data);
    }
  }
  const context = vm.createContext({
    window: { WebSocket: Socket },
    location: { origin: "https://onlyfans.com" },
    URL,
    decodeURIComponent,
  });
  vm.runInContext(source, context);
  const send = (url: string, data: string) => {
    const socket = new context.window.WebSocket(url);
    socket.send(data);
  };
  send.sent = sent;
  return send;
}
