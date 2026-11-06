import assert from "node:assert/strict";
import { test } from "node:test";
import { creatorIdsForChats, type TeamAccess } from "./access-policy.ts";
import { creatorIdsForReads } from "./dashboard-config.ts";
import { assertChatFanCardThreadLimit, chatFanCardFor, chatFanCardsFrom, fanCardTransactions, fanThreadsForCards, isLatestFanCardRequest, type ChatFanRead } from "./chat-fan-cards.ts";

const chatter: TeamAccess = { userId: "chatter", role: "member", perms: ["mensajes"], creatorIds: ["c-alba"] };

test("un chatter ve la ficha completa en una cuenta que no tiene asignada", () => {
  const accounts = [{ creatorId: "c-alba" }, { creatorId: "c-nora" }];
  const allowed = creatorIdsForChats(chatter, accounts.flatMap((account) => (account.creatorId ? [account.creatorId] : [])));
  assert.deepEqual(creatorIdsForReads(chatter, accounts, "chat"), ["c-alba"]);
  const cards = chatFanCardsFrom([noraRead()], allowed);
  const card = chatFanCardFor(cards, "c-nora", "fan-9");
  assert.ok(card);
  assert.equal(card.status, "active");
  assert.equal(card.subscribedAt, "2026-01-15T00:00:00.000Z");
  assert.equal(card.expiresAt, "2026-12-15T00:00:00.000Z");
  assert.equal(card.renewAuto, true);
  assert.equal(card.spentCents, 4200);
  assert.deepEqual(card.purchases, [
    { occurredAt: "2026-11-02T10:00:00.000Z", amountCents: 900, kind: "message" },
    { occurredAt: "2026-11-02T11:00:00.000Z", amountCents: 300, kind: "post" },
  ]);
  assert.deepEqual(card.tips, [{ occurredAt: "2026-11-03T10:00:00.000Z", amountCents: 500 }]);
  assert.deepEqual(fanCardTransactions(card).filter((row) => row.kind === "post"), [
    { occurredAt: "2026-11-02T11:00:00.000Z", grossCents: 300, kind: "post" },
  ]);
});

test("listChatFanCards rechaza más de 500 hilos", () => {
  assertChatFanCardThreadLimit(500);
  assert.throws(() => assertChatFanCardThreadLimit(501), /500/);
});

test("una respuesta vieja de fichas no pisa a la más reciente", () => {
  assert.equal(isLatestFanCardRequest(1, 2), false);
  assert.equal(isLatestFanCardRequest(2, 2), true);
});

test("la ficha solo pide los hilos visibles", () => {
  const threads = fanThreadsForCards([
    { creatorId: "c-nora", fanKey: "fan-9" },
    { creatorId: "c-nora", fanKey: "fan-9" },
    { creatorId: "c-nora", fanKey: null },
    { creatorId: "c-alba", fanKey: "fan-1" },
  ]);
  assert.deepEqual(threads, [
    { creatorId: "c-nora", fanKey: "fan-9" },
    { creatorId: "c-alba", fanKey: "fan-1" },
  ]);
  const cards = chatFanCardsFrom([noraRead(), albaRead()], ["c-alba", "c-nora"], [{ creatorId: "c-nora", fanKey: "fan-9" }]);
  assert.deepEqual(cards.map((card) => card.fanKey), ["fan-9"]);
});

test("la ficha del chat no lleva cifras agregadas de la agencia", () => {
  const allowed = creatorIdsForChats(chatter, ["c-nora"]);
  const cards = chatFanCardsFrom([noraRead()], allowed);
  const card = chatFanCardFor(cards, "c-nora", "fan-9");
  assert.ok(card);
  const payload = JSON.stringify(cards);
  assert.equal(payload.includes("999999"), false);
  assert.equal(payload.includes("800000"), false);
  assert.equal(payload.includes("payout"), false);
  assert.equal("earnings" in card, false);
  assert.equal("netCents" in card, false);
  assert.deepEqual(card.purchases.map((row) => row.kind), ["message", "post"]);
  assert.equal(card.tips.every((row) => row.amountCents === 500), true);
});

function noraRead(): ChatFanRead & { earnings: Array<{ amountCents: number }>; transactions: Array<{ fanKey: string | null; occurredAt: string; grossCents: number; netCents: number; kind: string }> } {
  return {
    creatorId: "c-nora",
    earnings: [{ amountCents: 999999 }],
    fans: [
      {
        fanKey: "fan-9",
        status: "active",
        subscribedAt: "2026-01-15T00:00:00.000Z",
        expiresAt: "2026-12-15T00:00:00.000Z",
        renewAuto: true,
        spentCents: 4200,
      },
    ],
    transactions: [
      { fanKey: "fan-9", occurredAt: "2026-11-02T10:00:00.000Z", grossCents: 900, netCents: 800000, kind: "message" },
      { fanKey: "fan-9", occurredAt: "2026-11-02T11:00:00.000Z", grossCents: 300, netCents: 200, kind: "post" },
      { fanKey: "fan-9", occurredAt: "2026-11-03T10:00:00.000Z", grossCents: 500, netCents: 400, kind: "tip" },
      { fanKey: null, occurredAt: "2026-11-04T10:00:00.000Z", grossCents: 999999, netCents: 800000, kind: "message" },
    ],
  };
}

function albaRead(): ChatFanRead {
  return {
    creatorId: "c-alba",
    fans: [
      {
        fanKey: "fan-1",
        status: "expired",
        subscribedAt: null,
        expiresAt: null,
        renewAuto: false,
        spentCents: 100,
      },
    ],
  };
}
