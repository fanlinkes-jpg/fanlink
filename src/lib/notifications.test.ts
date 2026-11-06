import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterNotifications,
  isNotificationResponseUrl,
  mergeKind,
  mergeNotifications,
  notificationKey,
  notificationLabels,
  notificationReadBusy,
  notificationScrolls,
  parseNotificationPayload,
  redactedNotificationUrl,
  tabOf,
  unreadCount,
  visibleNotifications,
  SIN_DATOS,
  type NotificationRecord,
} from "./notifications.ts";

const owner = { role: "owner" as const, creatorIds: [] };
const chatter = { role: "member" as const, creatorIds: ["c-alba"] };

test("solo se reconoce la respuesta de notificaciones, sin query", () => {
  assert.equal(isNotificationResponseUrl("https://onlyfans.com/api2/v2/users/notifications?offset=0&token=sekret"), true);
  assert.equal(isNotificationResponseUrl("https://onlyfans.com/api2/v2/earnings/chart?token=sekret"), false);
  assert.equal(isNotificationResponseUrl("https://onlyfans.com/my/notifications"), false);
  assert.equal(notificationScrolls(9), 1);
  assert.equal(notificationScrolls(0), 0);
});

test("lee tipos conocidos y deja el resto en Sin datos", () => {
  const rows = parseNotificationPayload({
    list: [
      { id: "n1", type: "tip", text: "Juan dejó propina", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7, name: "Juan" }, amount: 5 },
      { id: "n2", type: "paided_message", createdAt: "2026-11-05T11:00:00.000Z", chatId: "77" },
      { id: "n3", type: "tag", text: "Etiqueta pendiente de Luis", createdAt: "2026-11-03T10:00:00.000Z", status: "pending", user: { id: 4, name: "Luis" } },
      { id: "n4", type: "photo", createdAt: "2026-11-01T10:00:00.000Z" },
      { type: "like" },
    ],
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  assert.equal(byKey.get("n1")?.kind, "tip");
  assert.equal(byKey.get("n1")?.amountCents, 500);
  assert.equal(byKey.get("n1")?.fanName, "Juan");
  assert.equal(byKey.get("n2")?.kind, "ppv");
  assert.equal(byKey.get("n2")?.body, null);
  assert.equal(byKey.get("n2")?.threadKey, "77");
  assert.equal(byKey.get("n2")?.amountCents, null);
  assert.equal(byKey.get("n3")?.pending, true);
  assert.equal(tabOf("ppv"), "purchases");
  assert.equal(tabOf("tag"), "tags");
  assert.equal(byKey.get("n4")?.kind, "other");
  assert.equal(byKey.has("like"), false);
  const labels = notificationLabels(record("n2", byKey.get("n2")!), "owner");
  assert.equal(labels?.body, SIN_DATOS);
  assert.equal(labels?.amount, SIN_DATOS);
  assert.equal(labels?.destination, "thread");
});

test("el chatter ve el gasto del fan y no las ganancias de la agencia", () => {
  const rows = [
    record("tip", { kind: "tip", amountCents: 500, body: "propina", creatorId: "c-alba", fanKey: "7" }),
    record("ppv", { kind: "ppv", amountCents: 400, body: "compra", creatorId: "c-alba", fanKey: "7" }),
    record("sub", { kind: "subscription", amountCents: 1000, body: "suscripción", creatorId: "c-alba", fanKey: "7" }),
    record("like", { kind: "like", body: "me gusta", creatorId: "c-alba", fanKey: "7" }),
    record("pago", { kind: "agency", amountCents: 8000, body: "Pago de la agencia", creatorId: "c-alba" }),
    record("raro", { kind: "other", amountCents: 1200, body: "Has ganado $12", creatorId: "c-alba" }),
    record("otra", { kind: "tip", amountCents: 500, body: "ajena", creatorId: "c-nora", fanKey: "9" }),
  ];
  const own = visibleNotifications(rows, chatter, "c-alba");
  assert.deepEqual(own.map((row) => row.key), ["tip", "ppv", "sub", "like"]);
  assert.equal(notificationLabels(rows[0]!, "member")?.amount, "$5.00");
  assert.equal(notificationLabels(rows[1]!, "member")?.amount, "$4.00");
  assert.equal(notificationLabels(rows[2]!, "member")?.amount, "$10.00");
  assert.equal(notificationLabels(rows[4]!, "member"), null);
  assert.equal(notificationLabels(rows[5]!, "member"), null);
  assert.equal(visibleNotifications(rows, chatter, "c-nora").length, 0);
  assert.equal(visibleNotifications(rows, owner, "c-alba").some((row) => row.kind === "agency"), true);
});

test("filtra por pestaña, texto y fechas, y cuenta no leídas", () => {
  const rows = [
    record("a", { kind: "like", body: "Ana indicó me gusta", occurredAt: "2026-11-04T10:00:00.000Z", fanName: "Ana", seenAt: null }),
    record("b", { kind: "comment", body: "comentario", occurredAt: "2026-11-02T10:00:00.000Z", seenAt: "2026-11-06T00:00:00.000Z" }),
    record("c", { kind: "message", body: null, occurredAt: null, seenAt: null }),
  ];
  assert.deepEqual(filterNotifications(rows, { tab: "interactions", text: "ana", from: "", to: "" }).rows.map((row) => row.key), ["a"]);
  const ranged = filterNotifications(rows, { tab: "all", text: "", from: "2026-11-03", to: "2026-11-05" });
  assert.deepEqual(ranged.rows.map((row) => row.key), ["a"]);
  assert.deepEqual(ranged.undated.map((row) => row.key), ["c"]);
  assert.deepEqual(filterNotifications(rows, { tab: "all", text: "", from: "", to: "" }).rows.map((row) => row.key), ["a", "b", "c"]);
  assert.equal(filterNotifications(rows, { tab: "all", text: "", from: "", to: "" }).undated.length, 0);
  assert.equal(unreadCount(rows), 2);
  const merged = mergeNotifications(
    [{ key: "a", kind: "like", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: null, pending: false }],
    [{ key: "a", kind: "like", body: "ahora", fanKey: "7", fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false }],
  );
  assert.equal(merged[0]?.body, "ahora");
  assert.equal(merged[0]?.fanKey, "7");
  assert.equal(mergeKind("tip", "other"), "tip");
  assert.equal(mergeKind("other", "tip"), "tip");
  const payout = parseNotificationPayload({ list: [{ id: "p1", type: "payout", text: "Pago de la agencia $80", createdAt: "2026-11-05T10:00:00.000Z", amount: 80 }] });
  assert.equal(payout[0]?.kind, "agency");
  const unknown = parseNotificationPayload({ list: [{ id: "u1", type: "bonus", text: "Has ganado $12", createdAt: "2026-11-05T10:00:00.000Z", amount: 12 }] });
  assert.equal(unknown[0]?.kind, "other");
  assert.equal(visibleNotifications([record("u1", { kind: "other", amountCents: 1200, body: "Has ganado $12" })], chatter, "c-alba").length, 0);
  const sameTime = parseNotificationPayload({
    list: [
      { type: "like", text: "uno", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } },
      { type: "like", text: "dos", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } },
    ],
  });
  assert.equal(sameTime.length, 2);
  const longA = notificationKey({ id: `${"a".repeat(130)}x`, kind: "like", rawType: "like", occurredAt: null, fanKey: null, threadKey: null, body: null });
  const longB = notificationKey({ id: `${"a".repeat(130)}y`, kind: "like", rawType: "like", occurredAt: null, fanKey: null, threadKey: null, body: null });
  assert.notEqual(longA, longB);
  assert.ok((longA ?? "").length <= 120);
  assert.equal(redactedNotificationUrl("https://onlyfans.com/api2/v2/users/notifications?offset=0&token=sekret"), "https://onlyfans.com/api2/v2/users/notifications");
  assert.equal(redactedNotificationUrl("https://user:secret@onlyfans.com/api2/v2/users/notifications"), null);
  assert.equal(notificationReadBusy(["otra-cuenta"], "c-alba"), false);
  assert.equal(notificationReadBusy(["c-alba"], "c-alba"), true);
});

function record(key: string, extra: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    creatorId: "c-alba",
    key,
    kind: "other",
    body: null,
    fanKey: null,
    fanName: null,
    threadKey: null,
    amountCents: null,
    occurredAt: null,
    pending: false,
    seenAt: null,
    ...extra,
  };
}
