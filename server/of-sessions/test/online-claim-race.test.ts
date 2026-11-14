import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { ONLINE_DEDUPE_MS, claimOnlineOutbound, noteStaleOnlineSends, onlineDedupeKey, resolveStaleOnlineSend } from "../send/online-claim.ts";
import type { ReadSql } from "../sync/store.ts";

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
  const fanKey = "77";
  const body = `hola ${stamp}`;
  const nowMs = Date.now();
  const left = await pool.connect();
  const right = await pool.connect();
  try {
    await left.query(
      "insert into staff_profile (user_id, display_name, role, perms) values ($1, 'Ana', 'member', '[]'::jsonb) on conflict (user_id) do nothing",
      [authorId],
    );
    const shared = { creatorId, fanKey, authorId, body, priceCents: null as number | null, mediaIds: [] as number[], nowMs };
    const [first, second] = await Promise.all([
      claimOnlineOutbound(sqlOf(left), { ...shared, batchId: `lote-a-${stamp}` }),
      claimOnlineOutbound(sqlOf(right), { ...shared, batchId: `lote-b-${stamp}` }),
    ]);
    const states = [first.state, second.state].sort();
    assert.deepEqual(states, ["comprobar", "nuevo"]);
    const rows = await left.query<{ n: number; status: string }>(
      "select count(*)::int as n, min(status) as status from of_chat_outbound where creator_id = $1 and fan_key = $2 and body = $3",
      [creatorId, fanKey, body],
    );
    assert.equal(Number(rows.rows[0]?.n), 1);
    assert.equal(rows.rows[0]?.status, "sending");
    const again = await claimOnlineOutbound(sqlOf(left), { ...shared, batchId: `lote-c-${stamp}` });
    assert.equal(again.state, "comprobar");
    assert.notEqual(
      onlineDedupeKey({ text: body, priceCents: null, mediaIds: [] }),
      onlineDedupeKey({ text: body, priceCents: 500, mediaIds: [9] }),
    );
    const priced = await claimOnlineOutbound(sqlOf(left), { ...shared, batchId: `lote-precio-${stamp}`, priceCents: 500, mediaIds: [9] });
    assert.equal(priced.state, "nuevo");
    await left.query("update of_chat_outbound set status = 'sent' where id = $1", [first.id]);
    const later = await claimOnlineOutbound(sqlOf(left), { ...shared, batchId: `lote-luego-${stamp}`, nowMs: nowMs + ONLINE_DEDUPE_MS + 1_000 });
    assert.equal(later.state, "nuevo");
    await left.query("update of_chat_outbound set created_at = $2 where id = $1", [priced.id, new Date(nowMs - 11 * 60_000).toISOString()]);
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

function sqlOf(client: pg.PoolClient): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query(text, params);
      return result.rows as T[];
    },
  };
}
