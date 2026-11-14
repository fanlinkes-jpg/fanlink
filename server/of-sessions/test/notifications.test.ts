import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { countFanlinkUnread, listNotificationRows, markNotificationPage, markNotificationsSeen, notificationPageFor, saveNotificationRead } from "../sync/notification-store.ts";
import { dashboardCreatorIds } from "../../../src/lib/dashboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("guardar no borra lo ya leído y no inventa un cuerpo", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "n1", kind: "like", body: "hola", fanKey: "7", fanName: "Ana", threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false },
        { key: "n2", kind: "ppv", body: null, fanKey: null, fanName: null, threadKey: "77", amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    assert.equal(await markNotificationsSeen(sql, "c-alba", "dueña", ["n1"]), 1);
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "n1", kind: "like", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: null, pending: false },
        { key: "n2", kind: "other", body: null, fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña")).rows;
    const first = rows.find((row) => row.key === "n1");
    assert.equal(first?.body, "hola");
    assert.equal(first?.fanName, "Ana");
    assert.ok(first?.seenAt);
    const second = rows.find((row) => row.key === "n2");
    assert.equal(second?.kind, "ppv");
    assert.equal(second?.body, null);
    assert.equal(second?.seenAt, null);
    const otherPerson = (await listNotificationRows(sql, "c-alba", "chatter")).rows.find((row) => row.key === "n1");
    assert.equal(otherPerson?.seenAt, null);
  } finally {
    await pg.close();
  }
});

test("la lista pagina y olvida lo que pasa de 90 días", async () => {
  const { pg, sql } = await database();
  try {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        { key: "vieja", kind: "like", body: "antigua", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: old, pending: false },
        { key: "a", kind: "like", body: "a", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-03T10:00:00.000Z", pending: false },
        { key: "b", kind: "like", body: "b", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-04T10:00:00.000Z", pending: false },
        { key: "c", kind: "like", body: "c", fanKey: null, fanName: null, threadKey: null, amountCents: null, occurredAt: "2026-11-05T10:00:00.000Z", pending: false },
      ],
    });
    const first = await listNotificationRows(sql, "c-alba", "dueña", { limit: 2 });
    assert.deepEqual(first.rows.map((row) => row.key), ["c", "b"]);
    assert.ok(first.nextCursor);
    const second = await listNotificationRows(sql, "c-alba", "dueña", { limit: 2, cursor: first.nextCursor });
    assert.deepEqual(second.rows.map((row) => row.key), ["a"]);
    assert.equal(second.rows.some((row) => row.key === "vieja"), false);
  } finally {
    await pg.close();
  }
});

test("agencia y desconocido no pasan a un tipo que vea el chatter", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        item("ag", "agency", "2026-11-05T10:00:00.000Z"),
        item("un", "other", "2026-11-05T09:00:00.000Z"),
      ],
    });
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [item("ag", "tip", "2026-11-05T10:00:00.000Z"), item("un", "like", "2026-11-05T09:00:00.000Z")],
    });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows;
    assert.equal(rows.find((row) => row.key === "ag")?.kind, "agency");
    assert.equal(rows.find((row) => row.key === "un")?.kind, "other");
  } finally {
    await pg.close();
  }
});

test("el chatter no recibe páginas vacías ni la cuenta de otra persona", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [
        item("ag1", "agency", "2026-11-05T12:00:00.000Z"),
        item("ag2", "agency", "2026-11-05T11:00:00.000Z"),
        item("tip", "tip", "2026-11-05T10:00:00.000Z"),
        item("ppv", "ppv", "2026-11-04T10:00:00.000Z"),
      ],
    });
    await saveNotificationRead(sql, "c-nora", {
      captured: true,
      reason: null,
      items: [item("ajena", "tip", "2026-11-05T10:00:00.000Z")],
    });
    const page = await listNotificationRows(sql, "c-alba", "chatter", { role: "member", limit: 2 });
    assert.deepEqual(page.rows.map((row) => row.kind), ["tip", "ppv"]);
    const chatter = { userId: "chatter", role: "member" as const, creatorIds: ["c-alba"] };
    const foreign = await notificationPageFor(sql, chatter, "c-nora");
    assert.deepEqual(foreign.items, []);
    await assert.rejects(() => markNotificationPage(sql, chatter, "c-nora", ["tip"]), /cuenta/);
    const own = await notificationPageFor(sql, chatter, "c-alba", null);
    assert.deepEqual(own.items.map((row) => row.kind), ["tip", "ppv"]);
    assert.equal(own.items[0]?.amountCents, 500);
    const still = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows.find((row) => row.key === "tip");
    assert.equal(still?.seenAt, null);
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      counts: { all: 0, subscriptions: 0, purchases: 0, tips: 0, tags: 0, comments: 0, mentions: 0, likes: 0, promotions: 0, onlyfans: 0 },
      items: [item("tip", "tip", "2026-11-05T10:00:00.000Z")],
    });
    const cleared = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows.find((row) => row.key === "tip");
    assert.equal(cleared?.ofUnread, false);
    assert.deepEqual(dashboardCreatorIds(chatter, [{ creatorId: "c-alba" }, { creatorId: "c-nora" }]), ["c-alba"]);
    const first = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner", cursor: "no-es-json" });
    const clean = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" });
    assert.deepEqual(first.rows.map((row) => row.key), clean.rows.map((row) => row.key));
  } finally {
    await pg.close();
  }
});

test("el total de Fanlink no es la página y una lista caída no es 0", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      status: 200,
      motivo: "ok",
      reason: null,
      counts: null,
      items: [1, 2, 3].map((n) => ({
        key: `n${n}`,
        kind: "like" as const,
        body: "hola",
        fanKey: String(n),
        fanName: "Ana",
        threadKey: null,
        amountCents: null,
        occurredAt: `2026-11-1${n}T10:00:00.000Z`,
        pending: false,
      })),
    });
    const page = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner", limit: 1 });
    assert.equal(page.rows.length, 1);
    assert.equal(await countFanlinkUnread(sql, "c-alba", "dueña", "owner"), 3);
    const listed = await notificationPageFor(sql, { userId: "dueña", role: "owner", creatorIds: ["c-alba"] }, "c-alba");
    assert.equal(listed.fanlinkUnread, 3);
    await saveNotificationRead(sql, "c-alba", { captured: false, motivo: "no se pudo leer", reason: "no se pudo leer", status: 429, items: [] });
    const limited = await notificationPageFor(sql, { userId: "dueña", role: "owner", creatorIds: ["c-alba"] }, "c-alba");
    assert.equal(limited.fanlinkUnread, 3);
    await saveNotificationRead(sql, "c-alba", { captured: false, motivo: "no se pudo leer", reason: "no se pudo leer", status: 500, items: [] });
    const failed = await notificationPageFor(sql, { userId: "dueña", role: "owner", creatorIds: ["c-alba"] }, "c-alba");
    assert.equal(failed.fanlinkUnread, null);
  } finally {
    await pg.close();
  }
});

test("un chatter no cuenta la agencia en el total de Fanlink", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      status: 200,
      motivo: "ok",
      reason: null,
      items: [
        item("ag", "agency", "2026-11-13T10:00:00.000Z"),
        item("lk", "like", "2026-11-13T11:00:00.000Z"),
      ],
    });
    assert.equal(await countFanlinkUnread(sql, "c-alba", "dueña", "owner"), 2);
    assert.equal(await countFanlinkUnread(sql, "c-alba", "chatter", "member"), 1);
  } finally {
    await pg.close();
  }
});

test("una 0046 ya aplicada recibe el enlace del comentario y el insert sigue", async () => {
  const pg = new PGlite();
  const oldCard = `
    alter table of_notification add column if not exists fan_handle text;
    alter table of_notification add column if not exists avatar_url text;
    alter table of_notification add column if not exists fan_lists text;
    alter table of_notification add column if not exists renew_auto boolean;
    alter table of_notification add column if not exists fan_seen_at timestamptz;
    alter table of_notification add column if not exists post_ref text;
  `;
  try {
    await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
    await pg.exec(await readFile(path.join(root, "migrations/0047_notification_counts.sql"), "utf8"));
    await pg.exec(oldCard);
    await pg.exec(await readFile(path.join(root, "migrations/0048_notification_post.sql"), "utf8"));
    await pg.exec(await readFile(path.join(root, "migrations/0048_notification_post.sql"), "utf8"));
    const sql = {
      query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    };
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      status: 200,
      motivo: "ok",
      reason: null,
      items: [{
        key: "com",
        kind: "comment",
        body: "qué buen post",
        fanKey: "4",
        fanName: "Cleo",
        threadKey: null,
        amountCents: null,
        occurredAt: "2026-11-13T10:00:00.000Z",
        pending: false,
        postLink: "https://onlyfans.com/99887766",
        postText: "mira esta foto",
      }],
    });
    const row = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows.find((item) => item.key === "com");
    assert.equal(row?.postLink, "https://onlyfans.com/99887766");
    assert.equal(row?.postText, "mira esta foto");
  } finally {
    await pg.close();
  }
});

test("la ficha guarda listas y renovación y deja null lo que no vino", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      status: 200,
      motivo: "ok",
      reason: null,
      counts: null,
      items: [{
        key: "ficha",
        kind: "subscription",
        body: "se ha suscrito a tu perfil",
        fanKey: "9",
        fanName: "Ana",
        threadKey: null,
        amountCents: null,
        occurredAt: "2026-11-13T10:00:00.000Z",
        pending: false,
        fanHandle: "ana",
        avatarUrl: "https://cdn.example/a.jpg",
        lists: ["Low Spenders-CVI"],
        renewAuto: true,
        fanSeenAt: "2026-11-13T11:00:00.000Z",
        postRef: null,
      }, {
        key: "vacia",
        kind: "comment",
        body: "solo texto",
        fanKey: "5",
        fanName: "Dio",
        threadKey: null,
        amountCents: null,
        occurredAt: "2026-11-13T10:00:00.000Z",
        pending: false,
      }],
    });
    const rows = await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" });
    const card = rows.rows.find((row) => row.key === "ficha");
    const bare = rows.rows.find((row) => row.key === "vacia");
    assert.equal(card?.fanHandle, "ana");
    assert.deepEqual(card?.lists, ["Low Spenders-CVI"]);
    assert.equal(card?.renewAuto, true);
    assert.equal(card?.avatarUrl, "https://cdn.example/a.jpg");
    assert.ok(card?.fanSeenAt);
    assert.equal(bare?.lists, null);
    assert.equal(bare?.renewAuto, null);
    assert.equal(bare?.postRef, null);
    assert.equal(bare?.fanSeenAt, null);
  } finally {
    await pg.close();
  }
});

test("las migraciones de notificaciones se aplican dos veces", async () => {
  const pg = new PGlite();
  try {
    for (const name of ["0034_notifications.sql", "0035_notification_first_seen.sql", "0036_notification_key_text.sql", "0047_notification_counts.sql", "0046_notification_fan_card.sql", "0048_notification_post.sql"]) {
      const sql = await readFile(path.join(root, "migrations", name), "utf8");
      await pg.exec(sql);
      await pg.exec(sql);
    }
    const column = await pg.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'of_notification' and column_name = 'first_seen_at'",
    );
    assert.equal(column.rows[0]?.column_name, "first_seen_at");
  } finally {
    await pg.close();
  }
});

test("una tabla anterior recibe first_seen_at", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table of_notification (
        creator_id text not null,
        notification_key text not null,
        kind text not null,
        body text,
        fan_key text,
        fan_name text,
        thread_key text,
        amount_cents integer,
        occurred_at timestamptz,
        pending boolean not null default false,
        synced_at timestamptz not null,
        origin text not null default 'onlyfans',
        primary key (creator_id, notification_key)
      );
    `);
    await pg.exec(
      "insert into of_notification (creator_id, notification_key, kind, synced_at) values ('c-alba', 'vieja', 'like', '2026-08-01T00:00:00Z')",
    );
    await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
    await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
    const row = await pg.query<{ first_seen_at: Date | string }>(
      "select first_seen_at from of_notification where notification_key = 'vieja'",
    );
    assert.equal(new Date(row.rows[0]?.first_seen_at ?? "").toISOString(), "2026-08-01T00:00:00.000Z");
  } finally {
    await pg.close();
  }
});

test("0035 añade first_seen_at a una tabla que ya existía", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create table of_notification (
        creator_id text not null,
        notification_key text not null,
        kind text not null,
        occurred_at timestamptz,
        synced_at timestamptz not null,
        primary key (creator_id, notification_key)
      );
    `);
    await pg.exec(
      "insert into of_notification (creator_id, notification_key, kind, occurred_at, synced_at) values ('c-alba', 'vieja', 'like', '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')",
    );
    const repair = await readFile(path.join(root, "migrations/0035_notification_first_seen.sql"), "utf8");
    await pg.exec(repair);
    await pg.exec(repair);
    const row = await pg.query<{ first_seen_at: Date | string }>(
      "select first_seen_at from of_notification where notification_key = 'vieja'",
    );
    assert.equal(new Date(row.rows[0]?.first_seen_at ?? "").toISOString(), "2026-07-01T00:00:00.000Z");
  } finally {
    await pg.close();
  }
});

test("0036 quita el hash del texto y deja una sola clave", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
    const bare = `like\u001flike\u001f2026-11-05T10:00:00.000Z\u001f7\u001f`;
    const older = `${bare}\u001f${"a".repeat(32)}`;
    const newer = `${bare}\u001f${"b".repeat(32)}`;
    await pg.query(
      `insert into of_notification (creator_id, notification_key, kind, body, synced_at) values
       ('c-alba', $1, 'like', 'uno', now()),
       ('c-alba', $2, 'like', 'uno retocado', now())`,
      [older, newer],
    );
    await pg.query(
      "insert into of_notification_seen (creator_id, notification_key, user_id, seen_at) values ('c-alba', $1, 'dueña', now())",
      [older],
    );
    const repair = await readFile(path.join(root, "migrations/0036_notification_key_text.sql"), "utf8");
    await pg.exec(repair);
    await pg.exec(repair);
    const rows = await pg.query<{ notification_key: string }>("select notification_key from of_notification");
    assert.deepEqual(rows.rows.map((row) => row.notification_key), [bare]);
    const seen = await pg.query<{ notification_key: string }>("select notification_key from of_notification_seen");
    assert.deepEqual(seen.rows.map((row) => row.notification_key), [bare]);
  } finally {
    await pg.close();
  }
});

test("0036 conserva la marca de leído de la fila que se borra", async () => {
  const pg = await migrated();
  try {
    const bare = `like\u001flike\u001f2026-11-05T10:00:00.000Z\u001f7\u001f`;
    const kept = `${bare}\u001f${"b".repeat(32)}`;
    const dropped = `${bare}\u001f${"a".repeat(32)}`;
    await pg.query(
      `insert into of_notification (creator_id, notification_key, kind, first_seen_at, synced_at) values
       ('c-alba', $1, 'like', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'),
       ('c-alba', $2, 'like', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z')`,
      [kept, dropped],
    );
    await pg.query(
      "insert into of_notification_seen (creator_id, notification_key, user_id, seen_at) values ('c-alba', $1, 'chatter', '2026-11-06T00:00:00Z')",
      [dropped],
    );
    await applyTwice(pg);
    const seen = await pg.query<{ notification_key: string; user_id: string }>(
      "select notification_key, user_id from of_notification_seen",
    );
    assert.deepEqual(seen.rows, [{ notification_key: bare, user_id: "chatter" }]);
  } finally {
    await pg.close();
  }
});

test("0036 choca con una clave nueva que ya existe", async () => {
  const pg = await migrated();
  try {
    const bare = `like\u001flike\u001f2026-11-05T10:00:00.000Z\u001f7\u001f`;
    const hashed = `${bare}\u001f${"c".repeat(32)}`;
    await pg.query(
      `insert into of_notification (creator_id, notification_key, kind, body, first_seen_at, synced_at) values
       ('c-alba', $1, 'like', 'nueva', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z'),
       ('c-alba', $2, 'like', 'vieja', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [bare, hashed],
    );
    await pg.query(
      "insert into of_notification_seen (creator_id, notification_key, user_id, seen_at) values ('c-alba', $1, 'chatter', '2026-10-02T00:00:00Z')",
      [hashed],
    );
    await applyTwice(pg);
    const rows = await pg.query<{ notification_key: string; body: string; first_seen_at: Date | string }>(
      "select notification_key, body, first_seen_at from of_notification",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.notification_key, bare);
    assert.equal(rows.rows[0]?.body, "vieja");
    assert.equal(new Date(rows.rows[0]?.first_seen_at ?? "").toISOString(), "2026-10-01T00:00:00.000Z");
    const seen = await pg.query<{ notification_key: string }>("select notification_key from of_notification_seen");
    assert.deepEqual(seen.rows.map((row) => row.notification_key), [bare]);
  } finally {
    await pg.close();
  }
});

test("0036 conserva el first_seen_at más antiguo", async () => {
  const pg = await migrated();
  try {
    const bare = `like\u001flike\u001f2026-11-05T10:00:00.000Z\u001f7\u001f`;
    const laterHash = `${bare}\u001f${"a".repeat(32)}`;
    const earlierHash = `${bare}\u001f${"f".repeat(32)}`;
    await pg.query(
      `insert into of_notification (creator_id, notification_key, kind, first_seen_at, synced_at) values
       ('c-alba', $1, 'like', '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z'),
       ('c-alba', $2, 'like', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [laterHash, earlierHash],
    );
    await applyTwice(pg);
    const rows = await pg.query<{ notification_key: string; first_seen_at: Date | string }>(
      "select notification_key, first_seen_at from of_notification",
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]?.notification_key, bare);
    assert.equal(new Date(rows.rows[0]?.first_seen_at ?? "").toISOString(), "2026-10-01T00:00:00.000Z");
  } finally {
    await pg.close();
  }
});

test("reaplicar 0036 no recorta una clave nueva de más de 120 caracteres", async () => {
  const pg = await migrated();
  try {
    const full = ["like", "lk", "2026-11-05T10:00:00.000Z", "fan", "t".repeat(100)].join("\u001f");
    assert.ok(full.length > 120);
    const stored = `${full.slice(0, 80)}\u001f${"d".repeat(32)}`;
    assert.equal(stored.length, 113);
    assert.equal(stored[80], "\u001f");
    await pg.query(
      "insert into of_notification (creator_id, notification_key, kind, synced_at) values ('c-alba', $1, 'like', now())",
      [stored],
    );
    await applyTwice(pg);
    const rows = await pg.query<{ notification_key: string }>("select notification_key from of_notification");
    assert.deepEqual(rows.rows.map((row) => row.notification_key), [stored]);
  } finally {
    await pg.close();
  }
});

test("un aviso sin fecha caduca desde la primera vez que se vio", async () => {
  const { pg, sql } = await database();
  try {
    await saveNotificationRead(sql, "c-alba", {
      captured: true,
      reason: null,
      items: [item("suelto", "like", null)],
    });
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    await sql.query("update of_notification set first_seen_at = $2 where creator_id = $1 and notification_key = $3", [
      "c-alba",
      old,
      "suelto",
    ]);
    await saveNotificationRead(sql, "c-alba", { captured: true, reason: null, items: [] });
    const rows = (await listNotificationRows(sql, "c-alba", "dueña", { role: "owner" })).rows;
    assert.equal(rows.some((row) => row.key === "suelto"), false);
  } finally {
    await pg.close();
  }
});

async function migrated() {
  const pg = new PGlite();
  await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
  return pg;
}

async function applyTwice(pg: PGlite) {
  const repair = await readFile(path.join(root, "migrations/0036_notification_key_text.sql"), "utf8");
  await pg.exec(repair);
  await pg.exec(repair);
}

function item(key: string, kind: "agency" | "other" | "tip" | "ppv" | "like", occurredAt: string | null) {
  return {
    key,
    kind,
    body: kind,
    fanKey: "7",
    fanName: "Ana",
    threadKey: null,
    amountCents: 500,
    occurredAt,
    pending: false,
  };
}

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-notifications-"));
  const pg = new PGlite(dir);
  await pg.exec(await readFile(path.join(root, "migrations/0034_notifications.sql"), "utf8"));
  await pg.exec(await readFile(path.join(root, "migrations/0047_notification_counts.sql"), "utf8"));
  await pg.exec(await readFile(path.join(root, "migrations/0046_notification_fan_card.sql"), "utf8"));
  await pg.exec(await readFile(path.join(root, "migrations/0048_notification_post.sql"), "utf8"));
  const sql = {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
  return { pg, sql };
}
