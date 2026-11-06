import assert from "node:assert/strict";
import { test } from "node:test";
import { chatterReports } from "../metrics/team.ts";
import { fanListSettled, takeContiguousTransactions } from "../sync/collect.ts";
import { planFanExpiry } from "../sync/store.ts";
import { fanProfiles } from "../../../src/lib/fan-metrics.ts";
import { seedEmployeeStat } from "../../../src/lib/employee-metrics.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");

test("un scroll que sigue creciendo al paso 12 no caduca fans", () => {
  assert.equal(fanListSettled({ stable: false, count: 80, hadError: false }), false);
  assert.equal(fanListSettled({ stable: true, count: 5000, hadError: false }), false);
  assert.equal(fanListSettled({ stable: true, count: 10, hadError: true }), false);
  assert.equal(fanListSettled({ stable: true, count: 10, hadError: false }), true);
  const held = planFanExpiry(["a", "b", "c", "d"], ["a"], false);
  assert.deepEqual(held.expire, []);
});

test("no se expira más del 30 % de los fans activos", () => {
  const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const cut = planFanExpiry(many, ["a", "b", "c", "d", "e", "f"], true);
  assert.deepEqual(cut.expire, []);
  assert.match(cut.warning ?? "", /expirad/);
  const few = planFanExpiry(many, ["a", "b", "c", "d", "e", "f", "g", "h"], true);
  assert.deepEqual(few.expire, ["i", "j"]);
  assert.equal(few.warning, null);
});

test("con solape no se atribuyen PPV, hilos ni la primera respuesta", () => {
  const reports = chatterReports({
    assignments: [
      { creatorId: "c-alba", userId: "a", startedAt: "2026-11-01T00:00:00.000Z", endedAt: null },
      { creatorId: "c-alba", userId: "b", startedAt: "2026-11-01T00:00:00.000Z", endedAt: null },
    ],
    sales: [{ creatorId: "c-alba", at: "2026-11-03T12:00:00.000Z", grossCents: 800, kind: "ppv" }],
    messages: [
      { creatorId: "c-alba", threadKey: "7", at: "2026-11-05T10:00:00.000Z", fromFan: true, priceCents: null, purchased: null },
      { creatorId: "c-alba", threadKey: "7", at: "2026-11-05T10:05:00.000Z", fromFan: false, priceCents: 500, purchased: true },
    ],
  });
  for (const report of reports) {
    assert.equal(report.grossCents, null);
    assert.equal(report.ppvSent, null);
    assert.equal(report.ppvBought, null);
    assert.equal(report.firstReplyMinutes, null);
    assert.equal(report.threads, null);
  }
});

test("el LTV usa el gasto de la ficha si las transacciones no cubren el historial", () => {
  const [profile] = fanProfiles({
    now: NOW,
    ppvSynced: false,
    fans: [{
      fanKey: "7",
      name: "Fan",
      status: "active",
      subscribedAt: "2026-01-01T00:00:00.000Z",
      renewAuto: null,
      spentCents: 5000,
      lastInteractionAt: "2026-11-01T00:00:00.000Z",
    }],
    purchases: [{ fanKey: "7", occurredAt: "2026-11-03T15:00:00.000Z", grossCents: 1000 }],
    ppv: [],
  });
  assert.equal(profile?.ltvCents, 5000);
  assert.equal(profile?.spend30Cents, null);
});

test("el PPV del fan es null si esa persona no tiene mensajes de una lectura correcta", () => {
  const fan = {
    fanKey: "7",
    name: "Fan",
    status: "active" as const,
    subscribedAt: "2026-10-01T00:00:00.000Z",
    renewAuto: null,
    spentCents: null,
    lastInteractionAt: null,
  };
  const [withoutRead] = fanProfiles({
    now: NOW,
    ppvSynced: false,
    fans: [fan],
    purchases: [],
    ppv: [{ fanKey: "7", priceCents: 500, purchased: true }],
  });
  const [noMessages] = fanProfiles({
    now: NOW,
    ppvSynced: true,
    fans: [fan],
    purchases: [],
    ppv: [],
  });
  assert.equal(withoutRead?.ppvReceived, null);
  assert.equal(noMessages?.ppvReceived, null);
});

test("la persona semilla no enseña mensajes ni ventas locales", () => {
  assert.equal(seedEmployeeStat("Tú", "4"), "Sin datos");
  assert.equal(seedEmployeeStat("Lucía", "4"), "4");
});

test("el tope de 400 no adelanta el cursor por delante de un hueco", () => {
  const rows = Array.from({ length: 401 }, (_, index) => ({
    occurredAt: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
    txKey: `tx-${String(index).padStart(4, "0")}`,
    grossCents: 100,
  }));
  const newestFirst = [...rows].reverse();
  const kept = takeContiguousTransactions(newestFirst, null);
  assert.equal(kept.length, 400);
  assert.equal(kept[0]?.txKey, "tx-0000");
  assert.equal(kept[399]?.txKey, "tx-0399");
  const next = { at: kept[399]!.occurredAt, key: kept[399]!.txKey };
  const rest = takeContiguousTransactions(newestFirst, next);
  assert.equal(rest.length, 1);
  assert.equal(rest[0]?.txKey, "tx-0400");
});
