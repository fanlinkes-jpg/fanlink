import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { deliverDrafts } from "../campaigns/deliver.ts";
import { fansInSegment, previewBody, sendGate } from "../campaigns/segment.ts";
import { startFixture } from "./fixture-site.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");

const fans = [
  { fanKey: "7", name: "Fan Uno", status: "active" as const, spentCents: 1500, lastInteractionAt: "2026-11-05T10:00:00.000Z" },
  { fanKey: "8", name: "Fan Exp", status: "expired" as const, spentCents: 0, lastInteractionAt: "2026-01-02T00:00:00.000Z" },
  { fanKey: "9", name: "Fan Quieto", status: "active" as const, spentCents: 100, lastInteractionAt: "2026-08-01T00:00:00.000Z" },
];

test("los segmentos salen de fans reales y el envío a OnlyFans queda cerrado", () => {
  assert.equal(fansInSegment(fans, "active", { minSpentCents: 1000, quietDays: 30, now: NOW }).length, 2);
  assert.equal(fansInSegment(fans, "expired", { minSpentCents: 0, quietDays: 30, now: NOW })[0]?.fanKey, "8");
  assert.equal(fansInSegment(fans, "spent", { minSpentCents: 1000, quietDays: 30, now: NOW })[0]?.fanKey, "7");
  assert.deepEqual(
    fansInSegment(fans, "quiet", { minSpentCents: 0, quietDays: 30, now: NOW }).map((fan) => fan.fanKey),
    ["9"],
  );
  assert.equal(fansInSegment([{ ...fans[0]!, spentCents: 20_000, renewAuto: false }], "whale", { minSpentCents: 0, quietDays: 30, now: NOW }).length, 1);
  assert.equal(fansInSegment([{ ...fans[0]!, renewAuto: false }], "risk", { minSpentCents: 0, quietDays: 30, now: NOW }).length, 1);
  assert.equal(fansInSegment([{ fanKey: "n", name: "Nuevo", status: "active", spentCents: null, lastInteractionAt: null, subscribedAt: "2026-11-04T00:00:00.000Z" }], "new", { minSpentCents: 0, quietDays: 30, now: NOW }).length, 1);
  assert.equal(previewBody("Hola {nombre}", "Fan Uno"), "Hola Fan Uno");
  assert.equal(sendGate(undefined, "onlyfans.com").reason, "Envío real desactivado");
  assert.equal(sendGate("false", "127.0.0.1").reason, "Envío real desactivado");
  assert.equal(sendGate("true", "onlyfans.com").reason, "No se envía a OnlyFans real.");
  assert.equal(sendGate("true", "127.0.0.1").allowed, true);
});

test("el simulador recibe el borrador solo con el flag y fuera de OnlyFans", { timeout: 60_000 }, async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const blocked = await deliverDrafts(page, {
      flag: "false",
      hostname: "127.0.0.1",
      formUrl: `${fixture.origin}/simulate-send`,
      drafts: [{ fanKey: "7", body: "Hola Fan Uno", priceCents: 500, mediaCount: 0 }],
    });
    assert.equal(blocked.delivered, 0);
    assert.equal(blocked.reason, "Envío real desactivado");
    assert.equal(fixture.sent.length, 0);

    const real = await deliverDrafts(page, {
      flag: "true",
      hostname: "onlyfans.com",
      formUrl: `${fixture.origin}/simulate-send`,
      drafts: [{ fanKey: "7", body: "no", priceCents: 500, mediaCount: 0 }],
    });
    assert.equal(real.delivered, 0);
    assert.equal(fixture.sent.length, 0);

    const ok = await deliverDrafts(page, {
      flag: "true",
      hostname: "127.0.0.1",
      formUrl: `${fixture.origin}/simulate-send`,
      drafts: [{ fanKey: "7", body: "Hola Fan Uno", priceCents: 500, mediaCount: 0 }],
    });
    assert.equal(ok.delivered, 1);
    assert.equal(fixture.sent[0]?.fan, "7");
    assert.equal(fixture.sent[0]?.body, "Hola Fan Uno");
    assert.equal(fixture.sent[0]?.price, "500");
  } finally {
    await browser.close();
    await fixture.close();
  }
});
