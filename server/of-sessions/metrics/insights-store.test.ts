import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { summaryOf, type InsightCreator } from "../../../src/lib/dashboard-insights.ts";
import { loadInsightData } from "./insights-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function database() {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-insights-"));
  const pg = new PGlite(dir);
  const files = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pg.exec(await readFile(path.join(root, "migrations", name), "utf8"));
  const sql = { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
  return { pg, sql };
}

const CREATORS: InsightCreator[] = [
  { id: "c-rabbit", name: "Baby Rabbit", tag: null },
  { id: "c-jose", name: "Jose", tag: null },
];
const SINCE = new Date("2026-11-01T00:00:00Z");

test("sin ingresos leídos, las notificaciones de compra son el respaldo de ventas (solo de esa creadora)", async () => {
  const { pg, sql } = await database();
  try {
    const now = "2026-11-27T10:00:00Z";
    // Baby Rabbit: sin lectura de ingresos, con avisos de compra.
    for (const [key, kind, amount, at] of [
      ["n1", "tip", 500, "2026-11-26T10:00:00Z"],
      ["n2", "ppv", 1200, "2026-11-26T11:00:00Z"],
      ["n3", "subscription", 800, "2026-11-27T09:00:00Z"],
      ["n4", "like", 900, "2026-11-27T09:30:00Z"],
    ] as const) {
      await sql.query(
        `insert into of_notification (creator_id, notification_key, kind, amount_cents, occurred_at, synced_at) values ($1, $2, $3, $4, $5, $6)`,
        ["c-rabbit", key, kind, amount, at, now],
      );
    }
    // Jose: ingresos leídos de verdad. Sus avisos NO se suman (doble conteo).
    await sql.query(`insert into of_sync_state (creator_id, origin, earnings_synced_at, last_status) values ('c-jose', 'onlyfans', $1, 'ok')`, [now]);
    await sql.query(`insert into of_earning (creator_id, day, kind, amount_cents, currency, synced_at, origin) values ('c-jose', '2026-11-26', 'total', 10000, 'USD', $1, 'onlyfans')`, [now]);
    await sql.query(`insert into of_notification (creator_id, notification_key, kind, amount_cents, occurred_at, synced_at) values ('c-jose', 'j1', 'tip', 700, '2026-11-26T10:00:00Z', $1)`, [now]);

    const data = await loadInsightData(sql, CREATORS, SINCE);
    assert.deepEqual(data.salesFromNotificationCreatorIds, ["c-rabbit"]);
    assert.deepEqual(data.transactions.map((tx) => [tx.creatorId, tx.kind, tx.grossCents]).sort(), [
      ["c-rabbit", "message", 1200],
      ["c-rabbit", "subscription", 800],
      ["c-rabbit", "tip", 500],
    ]);
    // Total del Dashboard para Baby Rabbit: 5 + 12 + 8 = 25 $ brutos (los «me gusta» no cuentan).
    const query = { from: "2026-11-20", to: "2026-11-27", basis: "gross" as const, granularity: "day" as const };
    const summary = summaryOf({ ...data, creators: [CREATORS[0]!], transactions: data.transactions.filter((tx) => tx.creatorId === "c-rabbit"), earnings: [] }, query, new Date("2026-11-28T00:00:00Z"), new Date("2026-11-28T09:00:00Z"));
    assert.equal(summary.kpis.total.value, 2500);
  } finally {
    await pg.close();
  }
});

test("sin lista de fans leída, los fans salen de los chats sincronizados y se marca de dónde", async () => {
  const { pg, sql } = await database();
  try {
    const at = "2026-11-27T10:00:00Z";
    const insert = `insert into of_chat_thread (creator_id, thread_key, fan_key, fan_handle, fan_name, spent_cents, sub_started_at, sub_expires_at, renew_auto, synced_at)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
    await sql.query(insert, ["c-rabbit", "t1", "f1", "ana", "Ana", 12000, "2026-11-20T00:00:00Z", "2099-01-01T00:00:00Z", true, at]);
    await sql.query(insert, ["c-rabbit", "t2", "f2", "luis", "Luis", 0, "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z", false, at]);
    await sql.query(insert, ["c-rabbit", "t3", "f3", "sin", "Sin suscripción", 300, null, null, null, at]);
    await sql.query(insert, ["c-jose", "t9", "f9", "pepe", "Pepe", 1000, "2026-11-01T00:00:00Z", "2099-01-01T00:00:00Z", true, at]);
    // Jose sí tiene lista de fans leída: sus chats no se usan.
    await sql.query(`insert into of_sync_state (creator_id, origin, fans_synced_at, last_status) values ('c-jose', 'onlyfans', $1, 'ok')`, [at]);
    await sql.query(
      `insert into of_fan_read (creator_id, fan_key, handle, display_name, status, spent_cents, synced_at, origin) values ('c-jose', 'p1', 'p1', 'P1', 'active', 5000, $1, 'onlyfans')`,
      [at],
    );

    const data = await loadInsightData(sql, CREATORS, SINCE);
    assert.deepEqual(data.fansFromChatsCreatorIds, ["c-rabbit"]);
    const rabbit = data.fans.filter((fan) => fan.creatorId === "c-rabbit").map((fan) => [fan.fanKey, fan.status, fan.spentCents]).sort();
    assert.deepEqual(rabbit, [["f1", "active", 12000], ["f2", "expired", 0]]);
    assert.deepEqual(data.fans.filter((fan) => fan.creatorId === "c-jose").map((fan) => fan.fanKey), ["p1"]);
    assert.deepEqual([...data.fansSyncedCreatorIds].sort(), ["c-jose", "c-rabbit"]);
  } finally {
    await pg.close();
  }
});

test("la migración 0069 admite gráficos de directos y referidos", async () => {
  const { pg, sql } = await database();
  try {
    for (const kind of ["stream", "referral"]) {
      await sql.query(`insert into of_earning (creator_id, day, kind, amount_cents, currency, synced_at, origin) values ('c1', '2026-11-26', $1, 100, 'USD', now(), 'onlyfans')`, [kind]);
    }
    await assert.rejects(() => sql.query(`insert into of_earning (creator_id, day, kind, amount_cents, currency, synced_at, origin) values ('c1', '2026-11-26', 'otro', 1, 'USD', now(), 'onlyfans')`));
  } finally {
    await pg.close();
  }
});
