import assert from "node:assert/strict";
import { test } from "node:test";
import { fanProfiles, rankFans } from "./fan-metrics.ts";

test("el perfil del fan no inventa gasto ni PPV", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const [profile] = fanProfiles({
    now,
    ppvSynced: true,
    fans: [{
      fanKey: "7",
      name: "Fan Uno",
      status: "active",
      subscribedAt: "2026-10-01T00:00:00.000Z",
      renewAuto: false,
      spentCents: 1000,
      lastInteractionAt: "2026-11-05T10:00:00.000Z",
    }],
    purchases: [{ fanKey: "7", occurredAt: "2026-11-03T15:00:00.000Z", grossCents: 1000 }],
    ppv: [{ fanKey: "7", priceCents: 500, purchased: true }, { fanKey: "7", priceCents: 500, purchased: false }],
  });
  assert.equal(profile?.ltvCents, 1000);
  assert.equal(profile?.spend30Cents, null);
  assert.equal(profile?.ppvReceived, 2);
  assert.equal(profile?.ppvBought, 1);
  assert.equal(profile?.segments.includes("risk"), true);
  const empty = fanProfiles({
    now,
    ppvSynced: false,
    fans: [{ fanKey: "8", name: null, status: "active", subscribedAt: null, renewAuto: null, spentCents: null, lastInteractionAt: null }],
    purchases: [],
    ppv: [],
  });
  assert.equal(empty[0]?.ltvCents, null);
  assert.equal(empty[0]?.ppvReceived, null);
  assert.equal(rankFans([empty[0]!, profile!])[0]?.fanKey, "7");
});
