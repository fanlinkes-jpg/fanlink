import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterNotifications,
  isNotificationResponseUrl,
  mergeNotifications,
  notificationLabels,
  notificationScrolls,
  parseNotificationPayload,
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

test("un chatter no ve ingresos y solo ve sus cuentas", () => {
  const rows = [
    record("tip", { kind: "tip", amountCents: 500, body: "propina", creatorId: "c-alba" }),
    record("like", { kind: "like", body: "me gusta", creatorId: "c-alba", fanKey: "7" }),
    record("otra", { kind: "like", body: "ajena", creatorId: "c-nora" }),
  ];
  const own = visibleNotifications(rows, chatter, "c-alba");
  assert.deepEqual(own.map((row) => row.key), ["like"]);
  assert.equal(visibleNotifications(rows, chatter, "c-nora").length, 0);
  assert.equal(visibleNotifications(rows, owner, "c-alba").length, 2);
  assert.equal(notificationLabels(rows[0]!, "member"), null);
});

test("filtra por pestaña, texto y fechas, y cuenta no leídas", () => {
  const rows = [
    record("a", { kind: "like", body: "Ana indicó me gusta", occurredAt: "2026-11-04T10:00:00.000Z", fanName: "Ana", seenAt: null }),
    record("b", { kind: "comment", body: "comentario", occurredAt: "2026-11-02T10:00:00.000Z", seenAt: "2026-11-06T00:00:00.000Z" }),
    record("c", { kind: "message", body: null, occurredAt: null, seenAt: null }),
  ];
  assert.deepEqual(filterNotifications(rows, { tab: "interactions", text: "ana", from: "", to: "" }).map((row) => row.key), ["a"]);
  assert.deepEqual(filterNotifications(rows, { tab: "all", text: "", from: "2026-11-03", to: "2026-11-05" }).map((row) => row.key), ["a"]);
  assert.deepEqual(filterNotifications(rows, { tab: "all", text: "", from: "", to: "" }).map((row) => row.key), ["a", "b", "c"]);
  assert.equal(unreadCount(rows), 2);
  const merged = mergeNotifications(
    [{ key: "a", kind: "like", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: null, pending: false }],
    [{ key: "a", kind: "like", body: "ahora", fanKey: "7", fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false }],
  );
  assert.equal(merged[0]?.body, "ahora");
  assert.equal(merged[0]?.fanKey, "7");
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
