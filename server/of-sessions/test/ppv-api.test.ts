import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPpvPost, deliverPpvPost, ppvDryRun } from "../send/ppv-api.ts";
import { historyAdvance, historyCandidates, historyLoopEnabled, olderChatMessagesPath } from "../sync/history.ts";
import { lastSeenLabel, showOnlineDot } from "../../../src/lib/online-dot.ts";
import { accountApiBusy, clearAccountChatPace, withAccountApi } from "../sync/api-list-pace.ts";
import { purchaseTitle } from "../../../src/lib/purchase-detail.ts";

test("el PPV se arma para api2 y el seco no llama al POST", async () => {
  const built = buildPpvPost({
    fanId: "411378187",
    text: "ARCADAS",
    priceCents: 1999,
    mediaIds: ["501", "502"],
    previewIds: ["501"],
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.path, "/api2/v2/chats/411378187/messages");
  assert.deepEqual(built.body.mediaFiles, [501, 502]);
  assert.deepEqual(built.body.previews, [501]);
  assert.equal(Math.round(built.body.price * 100), 1999);
  assert.equal(buildPpvPost({ fanId: "411378187", text: "x", priceCents: 500, mediaIds: ["501"], previewIds: ["9"] }).ok, false);
  assert.equal(ppvDryRun({ FANLINK_SEND_DRY_RUN: "true" }), true);
  let called = 0;
  const lines: string[] = [];
  const dry = await deliverPpvPost({
    fanId: "88",
    text: "hola",
    priceCents: 500,
    mediaIds: ["7"],
    previewIds: ["7"],
    dryRun: true,
    request: async () => {
      called += 1;
      return { status: 200, json: { id: 1 }, retryAfterMs: 0 };
    },
    log: (line) => lines.push(line),
  });
  assert.equal(called, 0);
  assert.equal(dry.dryRun, true);
  assert.match(lines[0] ?? "", /dry-run price=5 mediaFiles=7 previews=7/);
  assert.equal((lines[0] ?? "").includes("cookie"), false);
  const posted = await deliverPpvPost({
    fanId: "88",
    text: "hola",
    priceCents: 0,
    mediaIds: ["7"],
    previewIds: [],
    dryRun: false,
    request: async () => ({ status: 200, json: { id: 42 }, retryAfterMs: 0 }),
  });
  assert.equal(posted.messageId, "42");
  const blocked = await deliverPpvPost({
    fanId: "88",
    text: "hola",
    priceCents: 500,
    mediaIds: ["7"],
    previewIds: [],
    dryRun: false,
    request: async () => ({ status: 429, json: null, retryAfterMs: 1500 }),
  });
  assert.equal(blocked.reason, "OnlyFans respondió 429");
  assert.equal(blocked.messageId, null);
});

test("el histórico sigue los hilos abiertos y los que no tienen mensajes", () => {
  const rows = historyCandidates([
    { threadKey: "591849192", cursor: "10", done: false, stored: 3 },
    { threadKey: "387943185", cursor: "4", done: true, stored: 0 },
    { threadKey: "listo", cursor: "1", done: true, stored: 8 },
  ]);
  assert.deepEqual(rows.map((row) => row.threadKey), ["591849192", "387943185"]);
  assert.equal(rows[1]?.cursor, null);
  const full = Array.from({ length: 10 }, (_, index) => ({
    messageKey: String(index),
    sentAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  assert.equal(historyAdvance({ previousCursor: "20", incoming: full, hasMore: false }).done, false);
  assert.equal(historyAdvance({ previousCursor: "20", incoming: full.slice(0, 2), hasMore: false }).done, true);
  const path = olderChatMessagesPath("591849192", "10");
  assert.equal(path.includes("read"), false);
  assert.equal(historyLoopEnabled(undefined), true);
  assert.equal(historyLoopEnabled("false"), false);
  assert.equal(showOnlineDot(true), true);
  assert.equal(showOnlineDot(false), false);
  assert.equal(showOnlineDot(null), false);
  const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(lastSeenLabel(fiveMin, Date.now(), false), "Visto hace 5 min");
  assert.equal(lastSeenLabel(fiveMin, Date.now(), true), null);
  assert.equal(lastSeenLabel(null, Date.now(), false), null);
  assert.equal(purchaseTitle("ARCADAS Y CORRIDA EN EL BALCÓN"), "ARCADAS Y CORRIDA EN EL BALCÓN");
});

test("el histórico no se cuela delante de una lectura en vivo", async () => {
  clearAccountChatPace();
  let release: () => void = () => undefined;
  const held = withAccountApi("cuenta-viva", () => new Promise<void>((resolve) => {
    release = resolve;
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(accountApiBusy("cuenta-viva"), true);
  assert.equal(accountApiBusy("otra"), false);
  release();
  await held;
  assert.equal(accountApiBusy("cuenta-viva"), false);
});
