import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { ONLINE_DEDUPE_MS, claimOnlineOutbound, noteStaleOnlineSends, onlineDedupeKey, parseOnlineBatchId, resolveStaleOnlineSend } from "../send/online-claim.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("el candado y sending_at corren en una sola conexión", async () => {
  const db = new PGlite();
  try {
    const names = (await readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
    for (const name of names) await db.exec(await readFile(path.join(root, "migrations", name), "utf8"));
    const sql: ReadSql = {
      async query<T>(text: string, params?: unknown[]): Promise<T[]> {
        const result = await db.query<T>(text, params);
        return result.rows;
      },
    };
    const authorId = `autor-${randomUUID()}`;
    await sql.query(
      "insert into staff_profile (user_id, display_name, role, perms) values ($1, 'Ana', 'member', '[]'::jsonb)",
      [authorId],
    );
    const nowMs = Date.now();
    const batchId = randomUUID();
    assert.equal(parseOnlineBatchId(""), null);
    assert.equal(parseOnlineBatchId(batchId), batchId);
    const claimed = await claimOnlineOutbound(sql, {
      creatorId: "cuenta",
      fanKey: "7",
      authorId,
      body: "hola",
      priceCents: null,
      mediaIds: [],
      nowMs,
      batchId,
    });
    assert.equal(claimed.state, "nuevo");
    const row = await sql.query<{ status: string; sending_at: Date | string | null }>(
      "select status, sending_at from of_chat_outbound where id = $1",
      [claimed.id],
    );
    assert.equal(row[0]?.status, "sending");
    assert.ok(row[0]?.sending_at);
    const otherPrice = await claimOnlineOutbound(sql, {
      creatorId: "cuenta",
      fanKey: "7",
      authorId,
      body: "hola",
      priceCents: 500,
      mediaIds: [9],
      nowMs,
      batchId,
    });
    assert.equal(otherPrice.state, "comprobar");
    assert.equal(await resolveStaleOnlineSend(sql, claimed.id, "error"), false);
    await sql.query("update of_chat_outbound set sending_at = $2 where id = $1", [claimed.id, new Date(nowMs - 11 * 60_000).toISOString()]);
    assert.equal((await noteStaleOnlineSends(sql, nowMs)).includes(claimed.id), true);
    assert.equal(await resolveStaleOnlineSend(sql, claimed.id, "sent"), true);
  } finally {
    await db.close();
  }
});

test("dos lotes a la vez no crean dos filas del mismo fan y texto", async (t) => {
  const databaseUrl = process.env.FANLINK_TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip("sin FANLINK_TEST_DATABASE_URL");
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creatorId = `cuenta-${stamp}`;
  const authorId = `autor-${stamp}`;
  const body = `hola ${stamp}`;
  const nowMs = Date.now();
  const left = await pool.connect();
  const right = await pool.connect();
  try {
    await left.query(
      "insert into staff_profile (user_id, display_name, role, perms) values ($1, 'Ana', 'member', '[]'::jsonb) on conflict (user_id) do nothing",
      [authorId],
    );
    const shared = { creatorId, authorId, body, priceCents: null as number | null, mediaIds: [] as number[], nowMs };
    for (let round = 0; round < 10; round += 1) {
      const fanKey = String(round);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let opened: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        opened = resolve;
      });
      const firstClaim = claimOnlineOutbound(sqlOf(left), {
        ...shared,
        fanKey,
        batchId: randomUUID(),
        afterLock: async () => {
          opened();
          await held;
        },
      });
      await started;
      const secondClaim = claimOnlineOutbound(sqlOf(right), { ...shared, fanKey, batchId: randomUUID() });
      await delay(30);
      release();
      const [first, second] = await Promise.all([firstClaim, secondClaim]);
      assert.deepEqual([first.state, second.state].sort(), ["comprobar", "nuevo"]);
      const rows = await left.query<{ n: number; status: string }>(
        "select count(*)::int as n, min(status) as status from of_chat_outbound where creator_id = $1 and fan_key = $2 and body = $3",
        [creatorId, fanKey, body],
      );
      assert.equal(Number(rows.rows[0]?.n), 1);
      assert.equal(rows.rows[0]?.status, "sending");
    }
    const fanKey = "77";
    const reused = randomUUID();
    const again = await claimOnlineOutbound(sqlOf(left), { ...shared, fanKey, batchId: reused });
    assert.equal(again.state, "nuevo");
    const sameId = await claimOnlineOutbound(sqlOf(left), { ...shared, fanKey, batchId: reused, priceCents: 500, mediaIds: [9] });
    assert.equal(sameId.state, "comprobar");
    const repeated = await claimOnlineOutbound(sqlOf(left), { ...shared, fanKey, batchId: randomUUID() });
    assert.equal(repeated.state, "comprobar");
    assert.notEqual(
      onlineDedupeKey({ text: body, priceCents: null, mediaIds: [] }),
      onlineDedupeKey({ text: body, priceCents: 500, mediaIds: [9] }),
    );
    const priced = await claimOnlineOutbound(sqlOf(left), { ...shared, fanKey, batchId: randomUUID(), priceCents: 500, mediaIds: [9] });
    assert.equal(priced.state, "nuevo");
    await left.query("update of_chat_outbound set status = 'sent' where id = $1", [again.id]);
    const later = await claimOnlineOutbound(sqlOf(left), { ...shared, fanKey, batchId: randomUUID(), nowMs: nowMs + ONLINE_DEDUPE_MS + 1_000 });
    assert.equal(later.state, "nuevo");
    await left.query("update of_chat_outbound set dedupe_key = null where id = $1", [priced.id]);
    assert.equal((await noteStaleOnlineSends(sqlOf(left), nowMs)).includes(priced.id), false);
    assert.equal(await resolveStaleOnlineSend(sqlOf(left), priced.id, "error"), false);
    await left.query("update of_chat_outbound set dedupe_key = $2, sending_at = $3 where id = $1", [
      priced.id,
      onlineDedupeKey({ text: body, priceCents: 500, mediaIds: [9] }),
      new Date(nowMs - 11 * 60_000).toISOString(),
    ]);
    assert.equal(await resolveStaleOnlineSend(sqlOf(left), priced.id, "error"), false);
    const stale = await noteStaleOnlineSends(sqlOf(left), nowMs);
    assert.equal(stale.includes(priced.id), true);
    const still = await left.query<{ status: string; error_reason: string }>("select status, error_reason from of_chat_outbound where id = $1", [priced.id]);
    assert.equal(still.rows[0]?.status, "sending");
    assert.equal(still.rows[0]?.error_reason, "Hay que resolver");
    assert.equal(await resolveStaleOnlineSend(sqlOf(left), priced.id, "error"), true);
  } finally {
    await left.query("delete from of_chat_outbound where creator_id = $1", [creatorId]).catch(() => undefined);
    await left.query("delete from staff_profile where user_id = $1", [authorId]).catch(() => undefined);
    left.release();
    right.release();
    await pool.end();
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlOf(client: pg.PoolClient): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query(text, params);
      return result.rows as T[];
    },
  };
}
