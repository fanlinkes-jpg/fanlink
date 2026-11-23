import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseChatMessages, ppvFieldTrace, purchasedFlag } from "../sync/chats.ts";
import { saveNotificationRead, listNotificationRows } from "../sync/notification-store.ts";
import { fetchPurchaseMessage, purchaseMessagePath, queueMessagePath, readMirroredPurchase, savePurchasedMessage } from "../sync/purchase-message.ts";
import { rememberDedupeKey, sentMessageForDedupe } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";
import { messageLinkSpans, messageRefFromNotice, parseNotificationPayload, purchaseFieldTrace, redactNoticePath, stableNoticeKey } from "../../../src/lib/notifications.ts";
import { purchasedPpvSeries, moneyLabel } from "../../../src/lib/composer-tools.ts";
import { purchaseComposeDraft, purchaseDetailModel } from "../../../src/lib/purchase-detail.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const href = "https://onlyfans.com/my/chats/chat/411378187?firstId=9001&sign=sekret";
const html = `bought your <a href="${href}">message</a>`;

test("el aviso de compra guarda el id del mensaje y no se duplica por pestaña", () => {
  const notice = {
    id: "compra-1",
    type: "purchases",
    createdAt: "2026-11-01T00:00:00.000Z",
    text: html,
    replacePairs: { FAN: "AlexP" },
  };
  const fromTab = parseNotificationPayload([notice], { listType: "purchases" })[0];
  const fromAll = parseNotificationPayload([notice], {})[0];
  assert.ok(fromTab);
  assert.equal(fromTab.messageRef, "t:411378187/m:9001");
  assert.equal(fromTab.key, fromAll?.key);
  assert.equal(stableNoticeKey(`${fromTab.key}\u001fpurchases`), fromTab.key);
  assert.equal(messageRefFromNotice({ replacePairs: { LINK: `<a href="${href}">message</a>` } }), "t:411378187/m:9001");
  const spans = messageLinkSpans(fromTab.body, fromTab.messageRef ?? null);
  assert.equal(spans.some((part) => part.link && part.text.toLowerCase() === "message"), true);
});

test("la traza de compra solo nombra claves y tapa los números del href", () => {
  const line = purchaseFieldTrace({
    id: "1",
    type: "purchases",
    text: html,
    replacePairs: { FAN: "AlexP" },
    cookie: "sekret",
    sign: "otro",
  });
  assert.match(line, /^\[fanlink:notif\] compra campos=/);
  assert.match(line, /href=\/my\/chats\/chat\/<n>$/);
  assert.equal(line.includes("sekret"), false);
  assert.equal(line.includes("AlexP"), false);
  assert.equal(line.includes("cookie"), false);
  assert.match(line, /replacePairs\.FAN/);
  assert.equal(redactNoticePath(href), "/my/chats/chat/<n>");
  const previous = process.env.FANLINK_LIVE_VIEW_DEBUG;
  const seen: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    seen.push(args.map((item) => String(item)).join(" "));
  };
  try {
    delete process.env.FANLINK_LIVE_VIEW_DEBUG;
    parseNotificationPayload([{ id: "1", type: "purchases", text: html, createdAt: "2026-11-01T00:00:00.000Z" }]);
    assert.equal(seen.length, 0);
    process.env.FANLINK_LIVE_VIEW_DEBUG = "true";
    parseNotificationPayload([{ id: "1", type: "purchases", text: html, createdAt: "2026-11-01T00:00:00.000Z", replacePairs: { FAN: "AlexP" } }]);
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /\[fanlink:notif\] compra campos=/);
    assert.equal((seen[0] ?? "").includes("sekret"), false);
  } finally {
    console.info = original;
    if (previous == null) delete process.env.FANLINK_LIVE_VIEW_DEBUG;
    else process.env.FANLINK_LIVE_VIEW_DEBUG = previous;
  }
});

test("un PPV propio pagado se lee por isOpened y el modal da el máximo y la media", () => {
  assert.equal(purchasedFlag({ canPurchase: true, purchased: false, isOpened: true }, 2499, true), true);
  assert.equal(purchasedFlag({ canPurchase: false, purchased: true, isOpened: false }, 2499, true), false);
  assert.equal(purchasedFlag({ purchased: true, canPurchase: true }, 1999, false), true);
  const prices = [24.99, 39, 12.99, 24.99];
  const list = Array.from({ length: 12 }, (_, index) => ({
    id: String(1000 + index),
    text: "clip",
    createdAt: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    price: index < 4 ? prices[index] : 9.99,
    isMine: true,
    fromUser: { id: "acct" },
    canPurchase: true,
    purchased: false,
    isOpened: index < 4,
    isFree: false,
    isFromQueue: false,
    queueId: 0,
  }));
  const trace = ppvFieldTrace(list[0] ?? {});
  assert.match(trace, /isOpened=true,canPurchase=true,purchased=false,isFree=false,isFromQueue=false,queueId=0/);
  const messages = parseChatMessages(list, "411378187", "u1fpdnp", "acct");
  assert.equal(messages.length, 12);
  assert.equal(messages.filter((message) => message.purchased === true).length, 4);
  const series = purchasedPpvSeries(messages);
  assert.equal(series.maxCents, 3900);
  assert.equal(series.avgCents, 2549);
  assert.equal(moneyLabel(series.maxCents), "$39.00");
  assert.equal(moneyLabel(series.avgCents), "$25.49");
});

test("el detalle del mensaje no envía y marca el precio como pagado", () => {
  const model = purchaseDetailModel({ creatorName: "Jose", priceCents: 1999 });
  assert.equal(model.title, "PPV");
  assert.equal(model.price, "$19.99");
  assert.equal(model.tags, "Tags • Jose");
  assert.equal(model.sends, false);
  const quick = purchaseComposeDraft("quick", [{ body: "  " }, { body: "guion" }]);
  assert.equal(quick.text, "guion");
  assert.equal(quick.send, false);
  const reply = purchaseComposeDraft("reply", [{ body: "guion" }]);
  assert.equal(reply.text, "guion");
  assert.equal(reply.send, false);
  assert.equal(purchaseComposeDraft("reply", []).text, "");
});

test("si no está en el espejo se pide el mensaje y se guarda pagado", async () => {
  const db = await database();
  try {
    let calls = 0;
    const blocked = await fetchPurchaseMessage({
      fanId: "88",
      messageId: "42",
      threadKey: "88",
      accountUserId: "acct",
      request: async () => {
        calls += 1;
        return { status: 429, body: null, retryAfterMs: 1500 };
      },
    });
    assert.equal(calls, 1);
    assert.equal(blocked.message, null);
    assert.equal(blocked.retryAfterMs, 1500);
    const paths: string[] = [];
    const loaded = await fetchPurchaseMessage({
      fanId: "88",
      messageId: "42",
      threadKey: "88",
      accountUserId: "acct",
      request: async (requestPath) => {
        paths.push(requestPath);
        if (requestPath.includes("/queue/")) {
          return {
            status: 200,
            retryAfterMs: 0,
            body: {
              id: "42",
              text: "ARCADAS Y CORRIDA EN EL BALCÓN",
              createdAt: "2026-11-02T00:00:00.000Z",
              price: 19.99,
              isMine: true,
              fromUser: { id: "acct" },
              isOpened: true,
              queueId: 7,
            },
          };
        }
        return {
          status: 200,
          retryAfterMs: 0,
          body: {
            list: [{
              id: "42",
              text: "ARCADAS Y CORRIDA EN EL BALCÓN",
              createdAt: "2026-11-02T00:00:00.000Z",
              price: 19.99,
              isMine: true,
              fromUser: { id: "acct" },
              isOpened: true,
              queueId: 7,
              isFromQueue: true,
            }],
          },
        };
      },
    });
    assert.equal(paths[0], purchaseMessagePath("88", "42"));
    assert.equal(paths[1], queueMessagePath("7"));
    assert.equal(loaded.message?.purchased, true);
    assert.equal(loaded.message?.priceCents, 1999);
    assert.match(loaded.message?.body ?? "", /ARCADAS Y CORRIDA EN EL BALCÓN/);
    assert.equal(await readMirroredPurchase(db.sql, "jose", "42"), null);
    if (!loaded.message) throw new Error("falta el mensaje");
    await savePurchasedMessage(db.sql, "jose", loaded.message);
    const stored = await readMirroredPurchase(db.sql, "jose", "42");
    assert.equal(stored?.purchased, true);
    assert.equal(stored?.priceCents, 1999);
    assert.match(stored?.body ?? "", /BALCÓN/);
  } finally {
    await db.pg.close();
  }
});

test("la migración 0057 une la compra duplicada y se puede aplicar dos veces", async () => {
  const db = await database({ skip: new Set(["0057_notification_message_ref.sql"]) });
  try {
    await db.pg.exec(`
      insert into of_notification (
        creator_id, notification_key, kind, body, fan_name, synced_at, origin, of_type
      ) values
        ('jose', 'buy-1', 'ppv', 'AlexP bought your message', 'AlexP', now(), 'onlyfans', null),
        ('jose', E'buy-1\\x1fpurchases', 'ppv', null, null, now(), 'onlyfans', 'purchases');
      insert into of_notification_seen (creator_id, notification_key, user_id, seen_at)
      values ('jose', E'buy-1\\x1fpurchases', 'ana', now());
    `);
    await db.pg.exec(await readFile(path.join(root, "migrations/0057_notification_message_ref.sql"), "utf8"));
    await db.pg.exec(await readFile(path.join(root, "migrations/0057_notification_message_ref.sql"), "utf8"));
    const rows = await db.pg.query<{ notification_key: string; of_type: string | null; fan_name: string | null }>(
      "select notification_key, of_type, fan_name from of_notification where creator_id = 'jose'",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.notification_key, "buy-1");
    assert.equal(rows.rows[0]?.of_type, "purchases");
    assert.equal(rows.rows[0]?.fan_name, "AlexP");
    const seen = await db.pg.query<{ notification_key: string }>(
      "select notification_key from of_notification_seen where creator_id = 'jose'",
    );
    assert.equal(seen.rows[0]?.notification_key, "buy-1");
    await saveNotificationRead(db.sql, "jose", {
      captured: true,
      reason: null,
      items: [{
        key: "buy-1",
        kind: "ppv",
        body: "AlexP bought your message",
        fanKey: "88",
        fanName: "AlexP",
        threadKey: "88",
        amountCents: 1999,
        occurredAt: "2026-11-02T00:00:00.000Z",
        pending: false,
        messageRef: "t:88/m:42",
      }],
    });
    const listed = (await listNotificationRows(db.sql, "jose", "ana")).rows.find((row) => row.key === "buy-1");
    assert.equal(listed?.messageRef, "t:88/m:42");
  } finally {
    await db.pg.close();
  }
});

test("reintentar no abre otro envío si el dedupe_key ya salió", async () => {
  const db = await database();
  try {
    await db.pg.exec(`
      insert into staff_profile (user_id, display_name, role, perms) values ('ana', 'Ana', 'member', '[]'::jsonb);
      insert into of_chat_outbound (id, creator_id, author_id, body, status, of_message_key, dedupe_key)
      values ('ya', 'jose', 'ana', 'hola', 'sent', 'm-ya', 'clave');
      insert into of_chat_outbound (id, creator_id, author_id, body, status, dedupe_key)
      values ('nuevo', 'jose', 'ana', 'hola', 'pending', 'clave');
    `);
    assert.equal(await sentMessageForDedupe(db.sql, "jose", "clave"), "m-ya");
    await rememberDedupeKey(db.sql, "nuevo", "clave-2");
    const updated = await db.pg.query<{ dedupe_key: string }>("select dedupe_key from of_chat_outbound where id = 'nuevo'");
    assert.equal(updated.rows[0]?.dedupe_key, "clave-2");
  } finally {
    await db.pg.close();
  }
});

async function database(options?: { skip?: Set<string> }): Promise<{ pg: PGlite; sql: ReadSql }> {
  const pg = new PGlite();
  const dir = path.join(root, "migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    if (options?.skip?.has(file)) continue;
    await pg.exec(await readFile(path.join(dir, file), "utf8"));
  }
  const sql: ReadSql = {
    query: async (text, params) => {
      const result = await pg.query(text, params);
      return result.rows as never;
    },
  };
  return { pg, sql };
}
