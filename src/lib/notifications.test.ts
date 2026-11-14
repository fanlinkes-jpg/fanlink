import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  decodeNotificationCursor,
  filterNotifications,
  isNotificationResponseUrl,
  mergeKind,
  mergeNotifications,
  notificationKey,
  notificationLabels,
  notificationSha256,
  notificationBellCount,
  ofReadType,
  parseNotificationCounts,
  visibleMarkScope,
  parseNotificationPayload,
  isRecentFan,
  notificationStamp,
  renewLabel,
  spanishNotificationText,
  relativeNotificationWhen,
  redactedNotificationUrl,
  tabOf,
  unreadCount,
  canReadCreatorNotifications,
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
  assert.equal(byKey.get("n3")?.kind, "tag");
  const tabs = parseNotificationPayload({
    list: [
      { id: "e1", type: "tags", text: "te etiquetó", createdAt: "2026-11-09T10:00:00.000Z", user: { id: 1, name: "Ana" } },
      { id: "e2", type: "expired", text: "caducó", createdAt: "2026-11-09T10:00:00.000Z", user: { id: 2, name: "Luis" } },
      { id: "e3", type: "comments", text: "comentó", createdAt: "2026-11-09T10:00:00.000Z", user: { id: 3, name: "Paz" } },
    ],
  });
  assert.equal(tabs.find((row) => row.key === "e1")?.kind, "tag");
  assert.equal(tabs.find((row) => row.key === "e2")?.kind, "subscription");
  assert.equal(tabs.find((row) => row.key === "e3")?.kind, "comment");
  assert.equal(tabOf("ppv"), "purchases");
  assert.equal(tabOf("tag"), "tags");
  assert.equal(tabOf("like"), "likes");
  assert.equal(tabOf("comment"), "comments");
  assert.equal(tabOf("mention"), "mentions");
  assert.equal(tabOf("tip"), "tips");
  assert.equal(tabOf("promotion"), "promotions");
  assert.equal(tabOf("message"), "promotions");
  assert.equal(tabOf("system"), "onlyfans");
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

test("el chatter solo ve las notificaciones de sus cuentas y la dueña ve todas", () => {
  const rows = [
    record("propia", { kind: "like", creatorId: "c-alba" }),
    record("ajena", { kind: "like", creatorId: "c-nora" }),
  ];
  assert.equal(canReadCreatorNotifications(chatter, "c-alba"), true);
  assert.equal(canReadCreatorNotifications(chatter, "c-nora"), false);
  assert.deepEqual(visibleNotifications(rows, chatter, "c-alba").map((row) => row.key), ["propia"]);
  assert.deepEqual(visibleNotifications(rows, chatter, "c-nora"), []);
  assert.equal(canReadCreatorNotifications(owner, "c-nora"), true);
  assert.equal(canReadCreatorNotifications(owner, "c-alba"), true);
  assert.deepEqual(visibleNotifications(rows, owner, "c-nora").map((row) => row.key), ["ajena"]);
  assert.deepEqual(visibleNotifications(rows, owner, "c-alba").map((row) => row.key), ["propia"]);
});

test("filtra por pestaña, texto y fechas, y cuenta no leídas", () => {
  const rows = [
    record("a", { kind: "like", body: "Ana indicó me gusta", occurredAt: "2026-11-04T10:00:00.000Z", fanName: "Ana", seenAt: null }),
    record("b", { kind: "comment", body: "comentario", occurredAt: "2026-11-02T10:00:00.000Z", seenAt: "2026-11-06T00:00:00.000Z" }),
    record("c", { kind: "message", body: null, occurredAt: null, seenAt: null }),
  ];
  assert.deepEqual(filterNotifications(rows, { tab: "likes", text: "ana", from: "", to: "" }).rows.map((row) => row.key), ["a"]);
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
  assert.equal(mergeKind("agency", "tip"), "agency");
  assert.equal(mergeKind("agency", "ppv"), "agency");
  assert.equal(mergeKind("other", "like"), "other");
  assert.equal(mergeKind("other", "message"), "other");
  assert.equal(mergeKind("other", "tip"), "other");
  const payout = parseNotificationPayload({ list: [{ id: "p1", type: "payout", text: "Pago de la agencia $80", createdAt: "2026-11-05T10:00:00.000Z", amount: 80 }] });
  assert.equal(payout[0]?.kind, "agency");
  const unknown = parseNotificationPayload({ list: [{ id: "u1", type: "bonus", text: "Has ganado $12", createdAt: "2026-11-05T10:00:00.000Z", amount: 12 }] });
  assert.equal(unknown[0]?.kind, "other");
  assert.equal(visibleNotifications([record("u1", { kind: "other", amountCents: 1200, body: "Has ganado $12" })], chatter, "c-alba").length, 0);
  const sameTime = parseNotificationPayload({
    list: [
      { type: "like", text: "uno", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } },
      { type: "like", text: "dos", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } },
      { type: "like", text: "  uno  ", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } },
    ],
  });
  assert.equal(sameTime.length, 1);
  assert.equal(sameTime[0]?.key.includes("uno"), false);
  assert.equal(sameTime[0]?.key.includes("dos"), false);
  const spaced = notificationKey({
    id: null,
    kind: "like",
    rawType: "like",
    occurredAt: "2026-11-05T10:00:00.000Z",
    fanKey: "7",
    threadKey: null,
    body: "uno   dos",
  });
  const tight = notificationKey({
    id: null,
    kind: "like",
    rawType: "like",
    occurredAt: "2026-11-05T10:00:00.000Z",
    fanKey: "7",
    threadKey: null,
    body: "uno dos",
  });
  assert.equal(spaced, tight);
  assert.equal(spaced?.includes("uno"), false);
  const edited = parseNotificationPayload({
    list: [{ type: "like", text: "uno retocado", createdAt: "2026-11-05T10:00:00.000Z", user: { id: 7 } }],
  });
  assert.equal(edited[0]?.key, sameTime[0]?.key);
  const retouched = notificationKey({
    id: null,
    kind: "like",
    rawType: "like",
    occurredAt: "2026-11-05T10:00:00.000Z",
    fanKey: "7",
    threadKey: null,
    body: "texto retocado",
  });
  const original = notificationKey({
    id: null,
    kind: "like",
    rawType: "like",
    occurredAt: "2026-11-05T10:00:00.000Z",
    fanKey: "7",
    threadKey: null,
    body: "texto original",
  });
  assert.equal(retouched, original);
  const longId = `${"a".repeat(130)}x`;
  const longA = notificationKey({ id: longId, kind: "like", rawType: "like", occurredAt: null, fanKey: null, threadKey: null });
  const longB = notificationKey({ id: `${"a".repeat(130)}y`, kind: "like", rawType: "like", occurredAt: null, fanKey: null, threadKey: null });
  const digest = createHash("sha256").update(longId).digest("hex").slice(0, 32);
  assert.equal(longA, `${longId.slice(0, 80)}\u001f${digest}`);
  assert.equal(notificationSha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(notificationSha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(notificationSha256("abc"), createHash("sha256").update("abc").digest("hex"));
  assert.equal(notificationSha256(""), createHash("sha256").update("").digest("hex"));
  assert.notEqual(longA, longB);
  assert.equal(decodeNotificationCursor("no-es-json"), null);
  assert.equal(decodeNotificationCursor('{"at":"ayer","key":"x"}'), null);
  assert.equal(redactedNotificationUrl("https://onlyfans.com/api2/v2/users/notifications?offset=0&token=sekret"), "https://onlyfans.com/api2/v2/users/notifications");
  assert.equal(redactedNotificationUrl("https://user:secret@onlyfans.com/api2/v2/users/notifications"), null);
  const now = new Date("2026-11-13T12:00:00.000Z");
  assert.equal(relativeNotificationWhen("2026-11-13T10:00:00.000Z", now), "hace 2 h");
  assert.equal(relativeNotificationWhen("2026-11-12T11:00:00.000Z", now), "hace 1 d");
  assert.equal(relativeNotificationWhen("2026-11-10T12:00:00.000Z", now), "hace 3 d");
  assert.notEqual(relativeNotificationWhen("2026-11-10T12:00:00.000Z", now), "Reciente (24h)");
  const aged = notificationLabels(record("vieja", { kind: "like", occurredAt: "2026-11-10T12:00:00.000Z" }), "owner", now);
  assert.equal(aged?.when, "hace 3 d");
  const counts = parseNotificationCounts({ all: 4, subscribed: 1, purchases: 1, tip: 1, commented: 0, mentioned: 0, favorited: 0, message: 1, deactivated_media: 2 });
  assert.equal(counts?.all, 4);
  assert.equal(counts?.subscriptions, 1);
  assert.equal(counts?.tips, 1);
  assert.equal(counts?.promotions, 1);
  assert.equal(counts?.tags, null);
  assert.equal(counts?.onlyfans, 2);
  assert.equal(parseNotificationCounts({ all: 1 })?.purchases, null);
  const bellRows = [
    record("ag", { kind: "agency", ofUnread: true }),
    record("tip", { kind: "tip", ofUnread: true }),
  ];
  assert.equal(notificationBellCount({ markOnOnlyfans: true, counts, rows: bellRows, role: "owner" }).count, 4);
  assert.equal(notificationBellCount({ markOnOnlyfans: true, counts, rows: bellRows, role: "member" }).count, 6);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, rows: bellRows, role: "member" }).count, 1);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, rows: bellRows, role: "owner" }).count, 2);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, rows: [record("ag", { kind: "agency", seenAt: "2026-11-13T00:00:00.000Z", ofUnread: true })], role: "owner" }).count, 0);
  assert.equal(ofReadType("agency"), null);
  assert.equal(ofReadType("other"), null);
  assert.equal(ofReadType("tip"), "tip");
  assert.deepEqual(visibleMarkScope(["agency", "tip"], "member", true), { all: false, types: ["tip"] });
  assert.deepEqual(visibleMarkScope(["agency", "tip"], "owner", true), { all: true, types: ["tip"] });
  const own = parseNotificationPayload({
    list: [
      { id: "fan", type: "subscribed", text: "{NAME} subscribed", createdAt: "2026-11-12T12:00:00.000Z", replacePairs: { "{NAME}": "Ana" }, user: { id: 7, name: "Ana", subscribedOn: true } },
      { id: "mia", type: "subscribed", text: "Your subscription to {NAME} has expired", createdAt: "2026-11-10T12:00:00.000Z", replacePairs: { "{NAME}": "Otra" }, user: { id: 99, name: "Otra", subscribedBy: true, subscribedOn: false } },
      { id: "yo", type: "subscribed", text: "aviso", createdAt: "2026-11-11T12:00:00.000Z", user: { id: 100, name: "Creadora" } },
      { id: "promo", type: "message", text: "{NAME} has a promotion", createdAt: "2026-11-09T12:00:00.000Z", replacePairs: { "{NAME}": "Promo" }, user: { id: 55, name: "Promo", subscribedBy: true } },
    ],
  }, { accountUserId: "100" });
  assert.equal(own.find((row) => row.key === "fan")?.fanKey, "7");
  assert.equal(own.find((row) => row.key === "fan")?.kind, "subscription");
  assert.equal(tabOf(own.find((row) => row.key === "fan")!.kind), "subscriptions");
  assert.equal(own.find((row) => row.key === "mia")?.fanKey, null);
  assert.equal(tabOf(own.find((row) => row.key === "mia")!.kind), "promotions");
  assert.equal(own.find((row) => row.key === "yo")?.fanKey, null);
  assert.equal(own.find((row) => row.key === "promo")?.fanKey, null);
  assert.equal(tabOf(own.find((row) => row.key === "promo")!.kind), "promotions");
});

test("la ficha usa listas, renovación y reciente solo si la API los trae", () => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  const rows = parseNotificationPayload({
    list: [{
      id: "ficha",
      type: "subscribed",
      createdAt: "2026-11-13T10:00:00.000Z",
      text: "subscribed to your profile!",
      user: {
        id: 9,
        name: "Ana",
        username: "ana",
        avatar: "https://cdn.example/a.jpg",
        lastSeen: "2026-11-13T11:00:00.000Z",
        listsStates: [
          { name: "Low Spenders-CVI", hasUser: true, type: "custom" },
          { name: "Oculta", hasUser: false, type: "custom" },
        ],
        subscribedOnData: { autoRenew: true },
      },
    }],
  });
  const row = rows[0];
  assert.ok(row);
  assert.deepEqual(row.lists, ["Low Spenders-CVI"]);
  assert.equal(row.renewAuto, true);
  assert.equal(row.fanHandle, "ana");
  assert.equal(row.avatarUrl, "https://cdn.example/a.jpg");
  assert.equal(isRecentFan(row.fanSeenAt, now), true);
  assert.equal(spanishNotificationText(row.body), "se ha suscrito a tu perfil");
  assert.equal(renewLabel(row.renewAuto), "Renovación sí");
  assert.equal(renewLabel(false), "Renovación no");
  assert.ok(notificationStamp(row.occurredAt)?.includes("2026"));
});

test("sin listas, renovación ni lastSeen no se inventan", () => {
  const rows = parseNotificationPayload({
    list: [{ id: "vacia", type: "subscribed", createdAt: "2026-11-01T10:00:00.000Z", text: "hola", user: { id: 3, name: "Bo" } }],
  });
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.lists, null);
  assert.equal(row.renewAuto, null);
  assert.equal(row.fanSeenAt, null);
  assert.equal(row.postRef, null);
  assert.equal(isRecentFan(row.fanSeenAt, Date.now()), false);
  assert.equal(renewLabel(row.renewAuto), null);
  assert.equal(spanishNotificationText(row.body), "hola");
});

test("un comentario guarda el texto y la publicación si vienen", () => {
  const withPost = parseNotificationPayload({
    list: [{
      id: "com",
      type: "commented",
      createdAt: "2026-11-13T10:00:00.000Z",
      text: "qué buen post",
      replacePairs: { "{POST_LINK}": "https://onlyfans.com/99887766" },
      user: { id: 4, name: "Cleo" },
    }],
  });
  assert.equal(withPost[0]?.kind, "comment");
  assert.equal(tabOf(withPost[0]!.kind), "comments");
  assert.equal(withPost[0]?.body, "qué buen post");
  assert.equal(withPost[0]?.postRef, "99887766");
  const bare = parseNotificationPayload({
    list: [{ id: "com2", type: "commented", text: "solo texto", user: { id: 5, name: "Dio" } }],
  });
  assert.equal(bare[0]?.postRef, null);
  assert.equal(bare[0]?.body, "solo texto");
});

test("lastSeen de hace días no cuenta como reciente", () => {
  const rows = parseNotificationPayload({
    list: [{ id: "viejo", type: "tip", createdAt: "2026-11-13T10:00:00.000Z", user: { id: 6, name: "Eva", lastSeen: "2026-11-01T10:00:00.000Z" } }],
  });
  assert.equal(isRecentFan(rows[0]?.fanSeenAt, Date.parse("2026-11-13T12:00:00.000Z")), false);
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
