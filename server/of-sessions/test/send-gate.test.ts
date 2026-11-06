import assert from "node:assert/strict";
import { test } from "node:test";
import { accountOnAllowlist, chatSendGate, confirmedOwnMessage, createSendLimiter, humanTypeDelay, sendPace } from "../send/gate.ts";
import type { ChatMessage } from "../sync/chats.ts";

const allowed = { creatorId: "9ikis52", accountId: "acc-9", handle: "bigpoppa1111", userId: "42", label: "Prueba" };

test("el envío real exige el flag y la cuenta de la lista", () => {
  assert.equal(chatSendGate(undefined, "9ikis52,@bigpoppa1111", allowed).reason, "Envío real desactivado");
  assert.equal(chatSendGate("true", "", allowed).reason, "Envío real desactivado");
  assert.equal(chatSendGate("true", "9ikis52", { ...allowed, creatorId: "otra", handle: "otra", userId: "1", accountId: "acc-otra", label: "Otra" }).reason, "Esta cuenta no puede enviar.");
  assert.equal(chatSendGate("true", "@bigpoppa1111", allowed).allowed, true);
  assert.equal(accountOnAllowlist("9ikis52, bigpoppa1111", allowed), true);
  assert.equal(chatSendGate("true", "42", { ...allowed, creatorId: "crm-1" }).allowed, true);
});

test("el ritmo deja un hueco y no confirma un mensaje del fan ni otro precio", () => {
  const now = 1_000_000;
  assert.equal(sendPace([now - 10_000], now, 1).waitMs, 50_000);
  assert.equal(sendPace([now - 10_000], now, 4).waitMs, 0);
  const base = humanTypeDelay(() => 0.5);
  assert.ok(base >= 40 && base <= 200);
  const slow = humanTypeDelay(() => 0.05);
  assert.ok(slow >= 200);
  const fan: ChatMessage = message("m-fan", true, "hola", null);
  const other: ChatMessage = message("m-other", false, "hola", 900);
  const own: ChatMessage = message("m-own", false, "Hola", 500);
  assert.equal(confirmedOwnMessage([fan, other], "hola", 500), null);
  assert.equal(confirmedOwnMessage([fan, own], "hola", 500)?.messageId, "m-own");
});

test("una cuenta envía de uno en uno", async () => {
  const limiter = createSendLimiter();
  const order: string[] = [];
  let now = 0;
  const sleeps: number[] = [];
  const run = (name: string) => limiter.run("acc-9", async () => {
    order.push(name);
    return name;
  }, { perMinute: 1, now: () => now, sleep: async (ms) => { sleeps.push(ms); } });
  const first = run("a");
  const second = run("b");
  assert.equal(await first, "a");
  assert.equal(await second, "b");
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 60_000);
});

function message(messageKey: string, fromFan: boolean, body: string, priceCents: number | null): ChatMessage {
  return {
    messageKey,
    threadKey: "7",
    fanKey: "7",
    fromFan,
    fromUserId: fromFan ? "7" : "42",
    seen: null,
    automatic: null,
    body,
    sentAt: "2026-11-06T12:00:00.000Z",
    priceCents,
    purchased: null,
    mediaCount: null,
    mediaSeconds: null,
    mediaPreview: null,
  };
}
