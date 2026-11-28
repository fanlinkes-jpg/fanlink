import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { markOutboundDryRun } from "../sync/chat-store.ts";
import { buildPpvPost, deliverPpvPost, ppvDryRun, ppvPreviewMissing } from "../send/ppv-api.ts";
import { historyAdvance, historyCandidates, historyLoopEnabled, olderChatMessagesPath, orphanHistoryThreads } from "../sync/history.ts";
import { fanIsOnline, fanListedOnline, fanShowsOnline, lastSeenLabel, showOnlineDot } from "../../../src/lib/online-dot.ts";
import { fanPurchaseSeries } from "../sync/fan-purchases.ts";
import { sealedOutbound } from "../send/chat-message.ts";
import { purchaseHeading } from "../../../src/lib/purchase-detail.ts";
import { purchasedPpvSeries } from "../../../src/lib/composer-tools.ts";
import { accountApiBusy, clearAccountChatPace, withAccountApi } from "../sync/api-list-pace.ts";

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
  const priced = buildPpvPost({ fanId: "411378187", text: "pago", priceCents: 1799, mediaIds: ["501"], previewIds: [] });
  assert.equal(priced.ok, false);
  if (!priced.ok) assert.equal(priced.reason, "No está la vista previa");
  assert.equal(ppvPreviewMissing(1799, 1, 0), true);
  assert.equal(ppvPreviewMissing(0, 1, 0), false);
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
  let refusedCalls = 0;
  const refused = await deliverPpvPost({
    fanId: "88",
    text: "hola",
    priceCents: 1799,
    mediaIds: ["7"],
    previewIds: [],
    dryRun: false,
    request: async () => {
      refusedCalls += 1;
      return { status: 200, json: { id: 1 }, retryAfterMs: 0 };
    },
  });
  assert.equal(refusedCalls, 0);
  assert.equal(refused.reason, "No está la vista previa");
  assert.equal(refused.messageId, null);
  const blocked = await deliverPpvPost({
    fanId: "88",
    text: "hola",
    priceCents: 500,
    mediaIds: ["7"],
    previewIds: ["7"],
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
  const justNow = new Date(Date.now() - 30_000).toISOString();
  assert.equal(fanIsOnline(null, justNow, Date.now()), true);
  assert.equal(fanIsOnline(null, fiveMin, Date.now()), false);
  assert.equal(fanListedOnline(["411378187"], "411378187", "411378187"), true);
  assert.equal(fanShowsOnline(null, fiveMin, Date.now(), true), true);
  assert.equal(fanShowsOnline(null, fiveMin, Date.now(), false), false);
  assert.equal(showOnlineDot(fanShowsOnline(null, justNow, Date.now(), false)), true);
  assert.deepEqual(orphanHistoryThreads(["591849192", "387943185", "591849192"], []).map((row) => row.threadKey), ["591849192", "387943185"]);
  assert.equal(sealedOutbound({ status: "error", errorReason: "Envío en seco", ofMessageKey: null, matchedMessageKey: null }), true);
  assert.equal(sealedOutbound({ status: "error", errorReason: "No se envió", ofMessageKey: null, matchedMessageKey: null }), false);
  const heading = purchaseHeading("ARCADAS Y CORRIDA EN EL BALCÓN\ntexto");
  assert.equal(heading.title, "ARCADAS Y CORRIDA EN EL BALCÓN");
  assert.equal(heading.rest, "texto");
  assert.deepEqual(purchaseHeading("", 1999), { title: "Mensaje de pago · $19.99", rest: "" });
  const long = purchaseHeading("Un solo bloque larguísimo sin saltos de línea ni punto final todavía");
  assert.ok(long.title.length <= 60 && long.title.length > 0);
  assert.ok(long.rest.length > 0);
  const four = purchasedPpvSeries([], [[
    { sentAt: "2026-05-19T12:00:00.000Z", priceCents: 2499 },
    { sentAt: "2026-07-01T12:00:00.000Z", priceCents: 3900 },
    { sentAt: "2026-10-11T08:00:00.000Z", priceCents: 1299 },
    { sentAt: "2026-10-11T18:00:00.000Z", priceCents: 2499 },
  ], [
    { sentAt: "2026-05-19T12:00:00.000Z", priceCents: 2499 },
    { sentAt: "2026-07-01T12:00:00.000Z", priceCents: 3900 },
  ]]);
  assert.equal(four.points.length, 4);
  assert.equal(four.maxCents, 3900);
});

test("el envío en seco no queda pendiente ni conserva la clave", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const pg = new PGlite();
  for (const name of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0019_chat_author.sql", "0063_staff_employees.sql", "0065_staff_roles.sql", "0064_outbound_author_name.sql", "0025_outbound_send.sql", "0049_online_broadcast_dedupe.sql"]) {
    await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into staff_profile (user_id, display_name, role, perms) values ('ana', 'Ana', 'member', '[]'::jsonb);
    insert into of_chat_outbound (id, creator_id, author_id, body, status, dedupe_key)
    values ('seco', 'jose', 'ana', 'hola', 'pending', 'clave');
  `);
  const sql = {
    query: async <T>(text: string, params?: unknown[]): Promise<T[]> => (await pg.query<T>(text, params)).rows,
  };
  await markOutboundDryRun(sql, "seco");
  const rows = await pg.query<{ status: string; error_reason: string | null; dedupe_key: string | null }>(
    "select status, error_reason, dedupe_key from of_chat_outbound where id = 'seco'",
  );
  assert.equal(rows.rows[0]?.status, "error");
  assert.equal(rows.rows[0]?.error_reason, "Envío en seco");
  assert.equal(rows.rows[0]?.dedupe_key, null);
  await pg.close();
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

test("Alz2000 suma las compras del aviso que el movimiento no trae", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const pg = new PGlite();
  for (const name of [
    "0007_of_reads.sql",
    "0008_sync_schedule.sql",
    "0009_of_chats.sql",
    "0012_extended_read.sql",
    "0013_chat_price.sql",
    "0034_notifications.sql",
    "0055_notification_of_type.sql",
    "0057_notification_message_ref.sql",
  ]) {
    await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into of_chat_thread (creator_id, thread_key, fan_key, synced_at)
    values ('allison', '411378187', '411378187', now());
    insert into of_transaction (creator_id, tx_key, occurred_at, gross_cents, kind, fan_key, currency, synced_at)
    values
      ('allison', 'mayo', '2026-05-19T12:00:00Z', 2499, 'message', '411378187', 'USD', now()),
      ('allison', 'octubre', '2026-10-11T08:00:00Z', 1299, 'message', '411378187', 'USD', now());
    insert into of_notification (creator_id, notification_key, kind, fan_key, thread_key, amount_cents, occurred_at, synced_at, of_type)
    values
      ('allison', 'julio', 'ppv', '411378187', '411378187', 3900, '2026-07-01T12:00:00Z', now(), 'purchases'),
      ('allison', 'octubre-2', 'ppv', '411378187', '411378187', 2499, '2026-10-11T18:00:00Z', now(), 'purchases'),
      ('allison', 'mayo-dup', 'ppv', '411378187', '411378187', 2499, '2026-05-19T12:00:00Z', now(), 'purchases');
  `);
  const sql = {
    query: async <T>(text: string, params?: unknown[]): Promise<T[]> => (await pg.query<T>(text, params)).rows,
  };
  const series = await fanPurchaseSeries(sql, "allison", "411378187");
  assert.equal(series.points.length, 4);
  assert.equal(series.maxCents, 3900);
  assert.deepEqual(series.points.map((point) => point.priceCents), [2499, 3900, 1299, 2499]);
  await pg.close();
});

test("la ficha lee todos los PPV propios guardados del hilo, con y sin columnas de medios", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const pg = new PGlite();
  for (const name of ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0012_extended_read.sql", "0013_chat_price.sql", "0034_notifications.sql", "0055_notification_of_type.sql", "0057_notification_message_ref.sql"]) {
    await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  }
  await pg.exec(`
    insert into of_chat_thread (creator_id, thread_key, fan_key, synced_at) values ('allison', '9', '9', now());
    insert into of_chat_message (creator_id, message_key, thread_key, fan_key, from_fan, body, sent_at, price_cents, purchased, synced_at)
    values
      ('allison', 'a', '9', '9', false, 'caro', '2026-11-01T10:00:00Z', 6900, null, now()),
      ('allison', 'b', '9', '9', false, 'barato', '2026-11-02T10:00:00Z', 1199, true, now()),
      ('allison', 'c', '9', '9', true, 'fan', '2026-11-02T11:00:00Z', 500, null, now()),
      ('allison', 'd', '9', '9', false, 'gratis', '2026-11-03T10:00:00Z', null, null, now());
  `);
  const sql = { query: async <T>(text: string, params?: unknown[]): Promise<T[]> => (await pg.query<T>(text, params)).rows };
  const series = await fanPurchaseSeries(sql, "allison", "9");
  assert.deepEqual(series.ppvs?.map((row) => [row.messageKey, row.priceCents, row.purchased]), [["b", 1199, true], ["a", 6900, null]]);
  await pg.close();
});
