import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { claimOutboundMatch, saveChatRead } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = [
  "0007_of_reads.sql",
  "0008_sync_schedule.sql",
  "0009_of_chats.sql",
  "0013_chat_price.sql",
  "0018_chat_preview.sql",
  "0019_chat_author.sql",
  "0020_chat_card.sql",
  "0021_fan_profile.sql",
  "0022_message_media.sql",
  "0024_outbound_schedule.sql",
  "0025_outbound_send.sql",
];

test("la 0033 deja un borrador por mensaje aunque ya hubiera duplicados", async () => {
  const db = new PGlite();
  for (const file of schema) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  await db.exec(`
    insert into staff_profile (user_id, display_name, role) values
      ('ana', 'Ana', 'chatter'),
      ('luis', 'Luis', 'chatter');
    insert into of_chat_message (
      creator_id, message_key, thread_key, from_fan, body, sent_at, synced_at
    ) values (
      'c1', 'm-1', '7', false, 'hola', '2026-11-06T12:00:30.000Z', '2026-11-06T12:01:00.000Z'
    );
    insert into of_chat_outbound (id, creator_id, author_id, body, created_at, matched_message_key) values
      ('lejos', 'c1', 'ana', 'hola', '2026-11-06T12:00:00.000Z', 'm-1'),
      ('cerca', 'c1', 'luis', 'hola', '2026-11-06T12:00:28.000Z', 'm-1'),
      ('viejo', 'c1', 'ana', 'sin hora', '2026-11-06T11:00:00.000Z', 'm-2'),
      ('nuevo', 'c1', 'luis', 'sin hora', '2026-11-06T11:30:00.000Z', 'm-2'),
      ('otro', 'c2', 'ana', 'hola', '2026-11-06T12:00:00.000Z', 'm-1');
  `);
  const migration = await readFile(path.join(root, "migrations", "0033_outbound_match_unique.sql"), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const rows = await db.query<{ id: string; matched_message_key: string | null }>(
    "select id, matched_message_key from of_chat_outbound order by id",
  );
  const keyOf = new Map(rows.rows.map((row) => [row.id, row.matched_message_key]));
  assert.equal(keyOf.get("cerca"), "m-1");
  assert.equal(keyOf.get("lejos"), null);
  assert.equal(keyOf.get("viejo"), "m-2");
  assert.equal(keyOf.get("nuevo"), null);
  assert.equal(keyOf.get("otro"), "m-1");
  const author = await db.query<{ author_id: string | null }>(
    "select author_id from of_chat_message where message_key = 'm-1'",
  );
  assert.equal(author.rows[0]?.author_id, null);
  await assert.rejects(
    db.exec("insert into of_chat_outbound (id, creator_id, author_id, body, matched_message_key) values ('dup', 'c1', 'ana', 'hola', 'm-1')"),
  );
  await db.close();
});

test("el segundo borrador no se queda el mensaje y la lectura sigue guardada", async () => {
  const db = new PGlite();
  for (const file of schema) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  await db.exec(await readFile(path.join(root, "migrations", "0033_outbound_match_unique.sql"), "utf8"));
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('ana', 'Ana', 'chatter'), ('luis', 'Luis', 'chatter')");
  await db.exec(`
    insert into of_chat_outbound (id, creator_id, thread_key, fan_key, author_id, body, created_at) values
      ('ana-1', 'c1', '7', '7', 'ana', 'hola', '2026-11-06T12:00:00.000Z'),
      ('luis-1', 'c1', '7', '7', 'luis', 'hola', '2026-11-06T12:00:20.000Z')
  `);
  const sql = sqlOf(db);
  const lines: string[] = [];
  const previous = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await sql.query("begin");
    assert.equal(await claimOutboundMatch(sql, "c1", "ana-1", "m-1"), true);
    assert.equal(await claimOutboundMatch(sql, "c1", "luis-1", "m-1"), false);
    await sql.query("commit");
  } finally {
    console.info = previous;
  }
  assert.equal(lines.some((line) => line.includes("emparejamiento descartado") && line.includes("borrador=luis-1")), true);
  const kept = await sql.query<{ id: string }>(
    "select id from of_chat_outbound where matched_message_key = 'm-1'",
  );
  assert.deepEqual(kept.map((row) => row.id), ["ana-1"]);

  let blows = 0;
  const guarded: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      if (blows === 0 && text.includes("set matched_message_key")) {
        blows += 1;
        const error = new Error("duplicate key value violates unique constraint");
        (error as { code?: string }).code = "23505";
        throw error;
      }
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await saveChatRead(guarded, "c1", {
      reason: null,
      jsonPaths: [],
      threads: [],
      messages: [{
        messageKey: "m-leido",
        threadKey: "7",
        fanKey: "7",
        body: "hola",
        sentAt: "2026-11-06T12:00:30.000Z",
        priceCents: null,
        purchased: null,
        seen: null,
        automatic: false,
        fromFan: false,
        fromUserId: "me",
      }],
    });
  } finally {
    console.info = previous;
  }
  const stored = await sql.query<{ message_key: string }>(
    "select message_key from of_chat_message where creator_id = 'c1' and message_key = 'm-leido'",
  );
  assert.equal(stored.length, 1);
  assert.equal(lines.some((line) => line.includes("codigo=23505") && line.includes("borrador=luis-1")), true);
  await db.close();
});

test("dos conexiones no deshacen el emparejamiento si chocan en el mismo mensaje", async (t) => {
  const databaseUrl = process.env.FANLINK_TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip("sin FANLINK_TEST_DATABASE_URL");
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const creatorId = `race-${stamp}`;
  const ana = `ana-${stamp}`;
  const luis = `luis-${stamp}`;
  const leftId = `left-${stamp}`;
  const rightId = `right-${stamp}`;
  const messageKey = `m-${stamp}`;
  const held: pg.PoolClient[] = [];
  try {
    const setup = await pool.connect();
    held.push(setup);
    const index = await setup.query<{ name: string | null }>(
      "select to_regclass('public.of_chat_outbound_matched_key') as name",
    );
    assert.ok(index.rows[0]?.name, "falta el índice único de la 0033");
    await setup.query(
      "insert into staff_profile (user_id, display_name, role, perms) values ($1, 'Ana', 'member', '[]'::jsonb), ($2, 'Luis', 'member', '[]'::jsonb)",
      [ana, luis],
    );
    await setup.query(
      `insert into of_chat_outbound (id, creator_id, author_id, body, created_at) values
       ($1, $3, $4, 'hola', '2026-11-06T12:00:00.000Z'),
       ($2, $3, $5, 'hola', '2026-11-06T12:00:05.000Z')`,
      [leftId, rightId, creatorId, ana, luis],
    );
    setup.release();
    held.pop();
    const left = await pool.connect();
    held.push(left);
    const right = await pool.connect();
    held.push(right);
    const claimInTx = async (client: pg.PoolClient, draftId: string): Promise<boolean> => {
      await client.query("set statement_timeout = '8s'");
      await client.query("begin");
      try {
        const ok = await claimOutboundMatch(clientSql(client), creatorId, draftId, messageKey);
        await client.query("commit");
        return ok;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    };
    const [first, second] = await Promise.all([
      claimInTx(left, leftId),
      claimInTx(right, rightId),
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const kept = await left.query<{ total: number }>(
      "select count(*)::int as total from of_chat_outbound where creator_id = $1 and matched_message_key = $2",
      [creatorId, messageKey],
    );
    assert.equal(Number(kept.rows[0]?.total), 1);
  } finally {
    for (const client of held.splice(0)) {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    await pool.query("delete from of_chat_outbound where creator_id = $1", [creatorId]).catch(() => undefined);
    await pool.query("delete from staff_profile where user_id = any($1::text[])", [[ana, luis]]).catch(() => undefined);
    await pool.end();
  }
});

function sqlOf(db: PGlite): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}

function clientSql(client: pg.PoolClient): ReadSql {
  return {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query(text, params);
      return result.rows as T[];
    },
  };
}
