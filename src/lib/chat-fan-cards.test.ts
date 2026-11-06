import assert from "node:assert/strict";
import { test } from "node:test";
import { creatorIdsForChats, type TeamAccess } from "./access-policy.ts";
import { creatorIdsForReads } from "./dashboard-config.ts";
import { chatFanCardFor, chatFanCardsFrom, type ChatFanRead } from "./chat-fan-cards.ts";

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
  assert.deepEqual(card.purchases, [{ occurredAt: "2026-11-02T10:00:00.000Z", amountCents: 900 }]);
  assert.deepEqual(card.tips, [{ occurredAt: "2026-11-03T10:00:00.000Z", amountCents: 500 }]);
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
  assert.equal(card.purchases.every((row) => row.amountCents === 900), true);
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
      { fanKey: "fan-9", occurredAt: "2026-11-03T10:00:00.000Z", grossCents: 500, netCents: 400, kind: "tip" },
      { fanKey: null, occurredAt: "2026-11-04T10:00:00.000Z", grossCents: 999999, netCents: 800000, kind: "message" },
    ],
  };
}
