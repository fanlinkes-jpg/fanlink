import assert from "node:assert/strict";
import { test } from "node:test";
import { chatterReports, type TeamMessage } from "./team.ts";

function message(partial: Partial<TeamMessage> & Pick<TeamMessage, "at" | "fromFan" | "authorId">): TeamMessage {
  return {
    creatorId: "c-alba",
    threadKey: "7",
    fanKey: "7",
    priceCents: null,
    purchased: null,
    ...partial,
  };
}

test("la venta cae en quien escribió el mensaje", () => {
  const [report] = chatterReports({
    sales: [
      { creatorId: "c-alba", fanKey: "7", at: "2026-11-03T15:00:00.000Z", grossCents: 800, kind: "tip" },
      { creatorId: "c-otra", fanKey: "9", at: "2026-11-03T15:00:00.000Z", grossCents: 999, kind: "ppv" },
    ],
    messages: [
      message({ at: "2026-11-03T14:00:00.000Z", fromFan: false, authorId: "e-1" }),
      message({ at: "2026-11-05T10:00:00.000Z", fromFan: true, authorId: null }),
      message({ at: "2026-11-05T10:05:00.000Z", fromFan: false, authorId: "e-1", priceCents: 500, purchased: true }),
    ],
  });
  assert.equal(report?.userId, "e-1");
  assert.equal(report?.grossCents, 800);
  assert.equal(report?.ppvSent, 1);
  assert.equal(report?.ppvBought, 1);
  assert.equal(report?.firstReplyMinutes, 5);
  assert.equal(report?.threads, 1);
});

test("sin autor no se inventa un cero", () => {
  const reports = chatterReports({ sales: [], messages: [] });
  assert.equal(reports.length, 0);
});
