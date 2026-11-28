import assert from "node:assert/strict";
import { test } from "node:test";
import { cutHoursFromEnv, cutLabel, dueForCut, lastCut, nextCut, onlineSnapshotMinFromEnv, alertsModeFromEnv } from "./dashboard-cuts.ts";

// 28/11/2026: Madrid está en UTC+1.
test("cortes por defecto 00:00, 08:00 y 16:00 Europe/Madrid", () => {
  assert.deepEqual(cutHoursFromEnv(undefined), [0, 8, 16]);
  assert.deepEqual(cutHoursFromEnv(""), [0, 8, 16]);
  assert.deepEqual(cutHoursFromEnv("16, 8,0,99"), [0, 8, 16]);
  assert.deepEqual(cutHoursFromEnv("6,18"), [6, 18]);
  assert.equal(cutHoursFromEnv("off"), null);
});

test("último y próximo corte en hora de Madrid", () => {
  const now = new Date("2026-11-28T10:00:00Z"); // 11:00 Madrid
  assert.equal(lastCut(now).toISOString(), "2026-11-28T07:00:00.000Z");
  assert.equal(nextCut(now).toISOString(), "2026-11-28T15:00:00.000Z");
  const night = new Date("2026-11-28T22:30:00Z"); // 23:30 Madrid
  assert.equal(lastCut(night).toISOString(), "2026-11-28T15:00:00.000Z");
  assert.equal(nextCut(night).toISOString(), "2026-11-28T23:00:00.000Z");
  const early = new Date("2026-11-27T23:10:00Z"); // 00:10 del 28 en Madrid
  assert.equal(lastCut(early).toISOString(), "2026-11-27T23:00:00.000Z");
});

test("una cuenta solo vuelve a leerse cuando pasa un corte nuevo", () => {
  const now = new Date("2026-11-28T10:00:00Z");
  assert.equal(dueForCut(null, now), true);
  assert.equal(dueForCut("2026-11-28T06:59:00Z", now), true);
  assert.equal(dueForCut("2026-11-28T07:05:00Z", now), false);
});

test("etiqueta «Actualizado»", () => {
  const now = new Date("2026-11-28T10:00:00Z");
  assert.equal(cutLabel("2026-11-28T07:00:00Z", now), "hoy 08:00");
  assert.equal(cutLabel("2026-11-27T23:00:00Z", now), "hoy 00:00");
  assert.equal(cutLabel("2026-11-27T15:00:00Z", now), "ayer 16:00");
  assert.equal(cutLabel("2026-11-25T07:00:00Z", now), "25/11 08:00");
  assert.equal(cutLabel("x", now), "Sin datos");
});

test("fans online y alertas configurables, por defecto solo en cortes / en vivo sin pedir a OnlyFans", () => {
  assert.equal(onlineSnapshotMinFromEnv(undefined), 0);
  assert.equal(onlineSnapshotMinFromEnv("5"), 15);
  assert.equal(onlineSnapshotMinFromEnv("60"), 60);
  assert.equal(alertsModeFromEnv(undefined), "live");
  assert.equal(alertsModeFromEnv("cuts"), "cuts");
});
