import assert from "node:assert/strict";
import { test } from "node:test";
import { chatterReports } from "./team.ts";

test("la venta cae en el chatter asignado en ese momento", () => {
  const [report] = chatterReports({
    assignments: [{ creatorId: "c-alba", userId: "e-1", startedAt: "2026-11-01T00:00:00.000Z", endedAt: null }],
    sales: [
      { creatorId: "c-alba", at: "2026-11-03T15:00:00.000Z", grossCents: 800, kind: "tip" },
      { creatorId: "c-otra", at: "2026-11-03T15:00:00.000Z", grossCents: 999, kind: "ppv" },
    ],
    messages: [
      { creatorId: "c-alba", threadKey: "7", at: "2026-11-05T10:00:00.000Z", fromFan: true, priceCents: null, purchased: null },
      { creatorId: "c-alba", threadKey: "7", at: "2026-11-05T10:05:00.000Z", fromFan: false, priceCents: 500, purchased: true },
    ],
  });
  assert.equal(report?.grossCents, 800);
  assert.equal(report?.ppvSent, 1);
  assert.equal(report?.ppvBought, 1);
  assert.equal(report?.firstReplyMinutes, 5);
  assert.equal(report?.threads, 1);
});

test("sin chats ni ventas no se inventa un cero", () => {
  const [report] = chatterReports({
    assignments: [{ creatorId: "c-alba", userId: "e-1", startedAt: "2026-11-01T00:00:00.000Z", endedAt: null }],
    sales: [],
    messages: [],
  });
  assert.equal(report?.grossCents, null);
  assert.equal(report?.ppvSent, null);
  assert.equal(report?.firstReplyMinutes, null);
});
