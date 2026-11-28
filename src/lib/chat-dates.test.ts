import assert from "node:assert/strict";
import { test } from "node:test";
import { dateSeparatorLabel, dayKey, withDateSeparators } from "./chat-dates.ts";

const now = Date.parse("2026-11-28T10:00:00Z");

test("el separador dice Hoy, Ayer o la fecha corta, con año si es de otro año", () => {
  assert.equal(dateSeparatorLabel("2026-11-28T08:00:00Z", now), "Hoy");
  assert.equal(dateSeparatorLabel("2026-11-27T20:00:00Z", now), "Ayer");
  assert.equal(dateSeparatorLabel("2026-11-20T08:00:00Z", now), "20 nov");
  assert.equal(dateSeparatorLabel("2025-03-02T08:00:00Z", now), "2 mar 2025");
  assert.equal(dateSeparatorLabel("no es fecha", now), null);
});

test("el día cuenta en hora de Madrid, no en UTC", () => {
  // 23:30 UTC del 20 ya es el 21 en Madrid (UTC+1).
  assert.equal(dayKey("2026-11-20T23:30:00Z"), dayKey("2026-11-21T00:10:00Z"));
  assert.notEqual(dayKey("2026-11-20T22:30:00Z"), dayKey("2026-11-20T23:30:00Z"));
});

test("solo el primer mensaje de cada día lleva separador", () => {
  const rows = withDateSeparators([
    { sentAt: "2026-11-20T08:00:00Z" },
    { sentAt: "2026-11-20T09:00:00Z" },
    { sentAt: "2026-11-21T09:00:00Z" },
    { sentAt: null },
  ], now);
  assert.deepEqual(rows.map((row) => row.separator), ["20 nov", null, "21 nov", null]);
  assert.deepEqual(withDateSeparators([], now), []);
});
