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
  onlyfansPostLink,
  spanishNotificationText,
  relativeNotificationWhen,
  redactedNotificationUrl,
  NOTIFICATION_KINDS,
  NOTIFICATION_TABS,
  notesForCreator,
  noticeFace,
  noticesForOfTab,
  ofListType,
  ofTabListNote,
  ofNoticeTotal,
  noticeIdsMissingAvatar,
  noticeAvatarTrace,
  noticeFanId,
  noticePayloadTraces,
  directoryAvatarReport,
  hashFanId,
  usersListPath,
  avatarsFromUserMap,
  applyDirectoryAvatars,
  noticeTabFresh,
  notificationReplyLine,
  renewStatusLabel,
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
  assert.equal(parseNotificationCounts({ counters: { all: 6, tip: 2 } })?.all, 6);
  assert.equal(parseNotificationCounts({ all: { unread: 7 } })?.all, 7);
  assert.equal(parseNotificationCounts({ all: { count: 9, total: 3 } }), null);
  assert.equal(counts?.onlyfans, 2);
  assert.equal(parseNotificationCounts({ all: 1 })?.purchases, null);
  assert.equal(notificationBellCount({ markOnOnlyfans: true, counts, fanlinkTotal: null, role: "owner" }).count, 4);
  assert.equal(notificationBellCount({ markOnOnlyfans: true, counts, fanlinkTotal: null, role: "member" }).count, 4);
  assert.equal(notificationBellCount({ markOnOnlyfans: true, counts: null, fanlinkTotal: 3, role: "owner" }).count, null);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, fanlinkTotal: null, role: "member" }).count, null);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, fanlinkTotal: null, role: "owner" }).count, null);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts: null, fanlinkTotal: 0, role: "owner" }).count, 0);
  assert.equal(notificationBellCount({ markOnOnlyfans: false, counts, fanlinkTotal: 8, role: "member" }).count, 8);
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
  assert.equal(withPost[0]?.postLink, "https://onlyfans.com/99887766");
  assert.equal(withPost[0]?.postText, null);
  const withText = parseNotificationPayload({
    list: [{
      id: "com-texto",
      type: "commented",
      text: "qué buen post",
      replacePairs: { "{POST_TEXT}": "mira esta foto" },
      user: { id: 8, name: "Luz" },
    }],
  });
  assert.equal(withText[0]?.postText, "mira esta foto");
  assert.equal(withText[0]?.postLink, null);
  const bare = parseNotificationPayload({
    list: [{ id: "com2", type: "commented", text: "solo texto", postId: "99887766", user: { id: 5, name: "Dio" } }],
  });
  assert.equal(bare[0]?.postLink, null);
  assert.equal(bare[0]?.postText, null);
  assert.equal(bare[0]?.body, "solo texto");
  assert.equal(onlyfansPostLink("https://onlyfans.com/99887766"), "https://onlyfans.com/99887766");
  assert.equal(onlyfansPostLink("https://www.onlyfans.com/99887766"), "https://www.onlyfans.com/99887766");
  for (const hostile of [
    "https://onlyfans.com.evil.com/99887766",
    "http://onlyfans.com/99887766",
    "javascript:alert(1)",
    "//onlyfans.com/99887766",
    "//evil.com",
  ]) {
    assert.equal(onlyfansPostLink(hostile), null, hostile);
  }
});

test("cada categoría de OnlyFans tiene su pestaña y no mezcla tipos", () => {
  assert.deepEqual([...NOTIFICATION_TABS], [
    "all",
    "subscriptions",
    "purchases",
    "tips",
    "tags",
    "comments",
    "mentions",
    "likes",
    "promotions",
    "onlyfans",
  ]);
  const rows = NOTIFICATION_KINDS.map((kind) => ({ kind }));
  for (const tab of NOTIFICATION_TABS) {
    if (tab === "all") continue;
    const kinds = rows.filter((row) => tabOf(row.kind) === tab).map((row) => row.kind);
    assert.ok(kinds.length > 0, tab);
    for (const kind of kinds) assert.equal(tabOf(kind), tab);
  }
  assert.deepEqual(rows.filter((row) => tabOf(row.kind) === "likes").map((row) => row.kind), ["like"]);
  assert.deepEqual(rows.filter((row) => tabOf(row.kind) === "comments").map((row) => row.kind), ["comment"]);
  assert.deepEqual(rows.filter((row) => tabOf(row.kind) === "tags").map((row) => row.kind), ["tag"]);
  assert.deepEqual(rows.filter((row) => tabOf(row.kind) === "mentions").map((row) => row.kind), ["mention"]);
  assert.deepEqual(rows.filter((row) => tabOf(row.kind) === "tips").map((row) => row.kind), ["tip"]);
  assert.notEqual(tabOf("like"), tabOf("comment"));
  assert.notEqual(tabOf("like"), "onlyfans");
  assert.notEqual(tabOf("tag"), "onlyfans");
  assert.equal(renewStatusLabel(true), "Renew On");
  assert.equal(renewStatusLabel(false), "Renew Off");
  assert.equal(renewStatusLabel(null), null);
});

test("el panel solo enseña avisos de la creadora activa y la respuesta es de su remitente", () => {
  const notes = [
    { creatorId: "jose", key: "j" },
    { creatorId: "allison", key: "a" },
    { creatorId: "9ikis52", key: "x" },
  ];
  assert.deepEqual(notesForCreator(notes, "jose").map((row) => row.key), ["j"]);
  assert.deepEqual(notesForCreator(notes, "all"), []);
  assert.deepEqual(notesForCreator(notes, null), []);
  const messages = [
    { creatorId: "allison", fanKey: "7", fromFan: false, sentAt: "2026-11-14T12:05:00.000Z", authorName: "Elena", automatic: false },
    { creatorId: "jose", fanKey: "7", fromFan: true, sentAt: "2026-11-14T12:10:00.000Z", authorName: "Fan", automatic: false },
    { creatorId: "jose", fanKey: "7", fromFan: false, sentAt: "2026-11-14T11:00:00.000Z", authorName: "Antes", automatic: false },
    { creatorId: "jose", fanKey: "7", fromFan: false, sentAt: "2026-11-14T12:30:00.000Z", authorName: "Marta", automatic: true },
    { creatorId: "jose", fanKey: "7", fromFan: false, sentAt: "2026-11-14T13:00:00.000Z", authorName: "  ", automatic: false },
    { creatorId: "jose", fanKey: "7", fromFan: false, sentAt: "2026-11-14T14:00:00.000Z", authorName: "Luis", automatic: false },
  ];
  assert.equal(notificationReplyLine({
    creatorId: "jose",
    fanKey: "7",
    occurredAt: "2026-11-14T12:00:00.000Z",
    messages,
  }), "Luis respondió a la notificación");
  assert.equal(notificationReplyLine({
    creatorId: "allison",
    fanKey: "7",
    occurredAt: "2026-11-14T12:00:00.000Z",
    messages,
  }), "Elena respondió a la notificación");
  assert.equal(notificationReplyLine({
    creatorId: "jose",
    fanKey: null,
    occurredAt: "2026-11-14T12:00:00.000Z",
    messages,
  }), null);
});

test("cada pestaña usa el type de OnlyFans y no mezcla compras con propinas", () => {
  const rows = [
    { ofType: null, key: "todo" },
    { ofType: "purchases", key: "compra" },
    { ofType: "tip", key: "propina" },
    { ofType: "message", key: "directo", body: "emisión en directo" },
  ];
  assert.equal(ofListType("purchases"), "purchases");
  assert.equal(ofListType("tips"), "tip");
  assert.equal(ofListType("promotions"), "message");
  assert.equal(ofListType("tags"), null);
  assert.equal(ofListType("all"), null);
  assert.deepEqual(noticesForOfTab(rows, "purchases").map((row) => row.key), ["compra"]);
  assert.deepEqual(noticesForOfTab(rows, "tips").map((row) => row.key), ["propina"]);
  assert.deepEqual(noticesForOfTab(rows, "promotions").map((row) => row.key), ["directo"]);
  assert.deepEqual(noticesForOfTab(rows, "all").map((row) => row.key), ["todo"]);
  assert.deepEqual(noticesForOfTab(rows, "tags"), []);
  assert.match(ofTabListNote({ tab: "tags", unread: 2, listed: 0 }) ?? "", /2 no leídas/);
  assert.match(ofTabListNote({ tab: "promotions", unread: 3, listed: 1 }) ?? "", /3 no leídas/);
  assert.equal(ofTabListNote({ tab: "tips", unread: 1, listed: 1 }), null);
  const live = parseNotificationPayload({
    list: [{ id: "live", type: "message", text: "emisión en directo", createdAt: "2026-11-13T10:00:00.000Z" }],
  }, { listType: "message" });
  assert.equal(live[0]?.ofType, "message");
  assert.deepEqual(noticesForOfTab(live, "promotions").map((row) => row.key), [live[0]?.key]);
  assert.deepEqual(noticesForOfTab(live, "tips"), []);
});

test("la foto sale del fromUser si el user no la trae, y un lote rellena las que faltan", () => {
  const parsed = parseNotificationPayload({
    list: [{
      id: "sin",
      type: "subscribed",
      createdAt: "2026-11-13T10:00:00.000Z",
      user: { id: 9, username: "u9" },
      fromUser: { id: 9, avatarThumbs: { c144: "https://cdn.example/u9.jpg" } },
    }],
  });
  assert.equal(parsed[0]?.avatarUrl, "https://cdn.example/u9.jpg");
  assert.deepEqual(noticeIdsMissingAvatar([
    { fanKey: "9", avatarUrl: "https://cdn.example/u9.jpg" },
    { fanKey: "4", avatarUrl: null },
    { fanKey: "no", avatarUrl: null },
  ]), ["4"]);
  assert.equal(usersListPath(["4", "8"]), "/api2/v2/users/list?cl[]=4&cl[]=8");
  const filled = applyDirectoryAvatars(
    [{ fanKey: "4", avatarUrl: null }, { fanKey: "8", avatarUrl: "https://cdn.example/keep.jpg" }],
    new Map([["4", "https://cdn.example/4.jpg"]]),
  );
  assert.equal(filled[0]?.avatarUrl, "https://cdn.example/4.jpg");
  assert.equal(filled[1]?.avatarUrl, "https://cdn.example/keep.jpg");
  assert.equal(noticeTabFresh(1_000, 1_000 + 44_000), true);
  assert.equal(noticeTabFresh(1_000, 1_000 + 46_000), false);
});

test("el badge verde usa el total de OnlyFans, no las no vistas en Fanlink", () => {
  assert.equal(ofNoticeTotal({ all: 3, subscriptions: 0, purchases: null, tips: null, tags: null, comments: null, mentions: null, likes: null, promotions: null, onlyfans: 3 }), 3);
  assert.equal(ofNoticeTotal({ all: null, subscriptions: null, purchases: null, tips: null, tags: null, comments: null, mentions: null, likes: null, promotions: null, onlyfans: 3 }), 3);
  assert.equal(notificationBellCount({
    markOnOnlyfans: false,
    counts: { all: 3, subscriptions: null, purchases: null, tips: null, tags: null, comments: null, mentions: null, likes: null, promotions: null, onlyfans: 3 },
    fanlinkTotal: 0,
    role: "owner",
  }).count, 0);
});

test("Renew On sale del usuario de la suscripción o de la ficha", () => {
  const fromSubscription = parseNotificationPayload({
    list: [{ id: "sub", type: "subscribed", createdAt: "2026-11-13T10:00:00.000Z", user: { id: 4, name: "Nora", username: "nora", subscribedByData: { renewedAuto: true } } }],
  });
  assert.equal(fromSubscription[0]?.renewAuto, true);
  const prolonged = parseNotificationPayload({
    list: [{ id: "pro", type: "subscribed", createdAt: "2026-11-13T10:00:00.000Z", user: { id: 5, name: "Luz", subscribedOnData: { subscribedOnAutoprolong: false, renewedAt: "2026-11-01T00:00:00.000Z" } } }],
  });
  assert.equal(prolonged[0]?.renewAuto, false);
  const fromThumb = parseNotificationPayload({
    list: [{ id: "foto", type: "tip", createdAt: "2026-11-13T10:00:00.000Z", user: { id: 8, name: "Lia", avatarThumbs: { thumb: "https://cdn.example/lia.jpg" } } }],
  });
  assert.equal(fromThumb[0]?.avatarUrl, "https://cdn.example/lia.jpg");
  assert.deepEqual(noticeFace({
    avatarUrl: null,
    renewAuto: null,
    threadAvatar: "https://cdn.example/ficha.jpg",
    threadRenew: null,
    cardRenew: false,
  }), { avatarUrl: "https://cdn.example/ficha.jpg", renewAuto: false });
});

test("la foto de una compra sale del subscriber, del enlace numérico o del lote", () => {
  const bought = parseNotificationPayload({
    list: [{
      id: "compra",
      type: "paided_message",
      createdAt: "2026-11-13T10:00:00.000Z",
      text: "pagó",
      replacePairs: { "{NAME}": "<a href=\"https://onlyfans.com/u7022542\">Ben</a>" },
      data: { subscriber: { id: 7022542, name: "Ben" } },
    }],
  });
  assert.equal(bought[0]?.fanKey, "7022542");
  assert.equal(bought[0]?.avatarUrl, null);
  const linked = parseNotificationPayload({
    list: [{
      id: "enlace",
      type: "subscribed",
      createdAt: "2026-11-13T10:00:00.000Z",
      text: "alta",
      replacePairs: { "{SUBSCRIBER_LINK}": "https://onlyfans.com/482191" },
    }],
  });
  assert.equal(linked[0]?.fanKey, "482191");
  const handleOnly = parseNotificationPayload({
    list: [{
      id: "usuario",
      type: "subscribed",
      createdAt: "2026-11-13T10:00:00.000Z",
      text: "alta",
      replacePairs: { "{NAME}": "https://onlyfans.com/u7022542" },
    }],
  });
  assert.equal(handleOnly[0]?.fanKey, null);
  const raw = {
    id: "compra",
    type: "paided_message",
    createdAt: "2026-11-13T10:00:00.000Z",
    user: { id: 482191 },
    replacePairs: { "{NAME}": "https://onlyfans.com/u7022542" },
  };
  const trace = noticeAvatarTrace(raw);
  assert.equal(trace.hash, hashFanId("482191"));
  assert.equal(trace.campos.includes("user.avatar:ausente"), true);
  assert.equal(trace.campos.includes("482191") || trace.campos.includes("cdn.example") || trace.hash?.includes("482191"), false);
  const lines = noticePayloadTraces({ list: [raw] });
  assert.equal(lines.some((line) => line.includes("482191") || line.includes("http")), false);
  assert.equal(noticeFanId({ user: 15 }), "15");
  const directory = {
    list: [
      { id: 4, avatarThumbs: { c50: "https://cdn.example/4.jpg" } },
      { id: 5, name: "Sin" },
    ],
  };
  assert.equal(avatarsFromUserMap(directory).get("4"), "https://cdn.example/4.jpg");
  const report = directoryAvatarReport(directory);
  assert.equal(report.shape, "lista");
  assert.equal(report.devueltos, 2);
  assert.equal(report.conFoto, 1);
  assert.equal(report.sinFoto, 1);
  assert.deepEqual(report.sinFotoHashes, [hashFanId("5")]);
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
