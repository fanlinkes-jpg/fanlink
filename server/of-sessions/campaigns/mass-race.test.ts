import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";
import { composeMass } from "../../../src/lib/mass/index.ts";
import type { ReadSql } from "../sync/store.ts";
import { openMassLaunch, saveMassDraft } from "./mass-store.ts";

const OWNER = { id: "admin-1", role: "owner" as const, perms: [] as const };

test("dos conexiones de Postgres no duplican el guardado ni el lanzamiento", async (t) => {
  const databaseUrl = process.env.FANLINK_TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip("sin FANLINK_TEST_DATABASE_URL");
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const left = await pool.connect();
  const right = await pool.connect();
  const key = `race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const accountId = `cuenta-${key}`;
  const draftId = `mass-${key}`;
  try {
    const present = await left.query<{ name: string | null }>(
      "select to_regclass('public.of_mass_message') as name",
    );
    if (!present.rows[0]?.name) {
      const migration = await readFile(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../../migrations/0027_mass_messages.sql",
        ),
        "utf8",
      );
      await left.query(migration);
    }
    const composed = composeMass({
      accountId,
      name: "Carrera",
      body: "Hola {nombre}",
      priceCents: 300,
      scheduledAt: "2026-11-06T18:00:00.000Z",
      segment: { includeAll: true },
      now: new Date("2026-11-06T10:00:00.000Z"),
      createId: () => draftId,
      idempotencyKey: key,
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    const [savedLeft, savedRight] = await Promise.all([
      saveMassDraft(sqlOf(left), composed.draft, OWNER),
      saveMassDraft(
        sqlOf(right),
        { ...composed.draft, id: `${composed.draft.id}-b` },
        OWNER,
      ),
    ]);
    assert.equal(savedLeft.id, savedRight.id);
    const saved = await left.query<{ total: number }>(
      "select count(*)::int as total from of_mass_message where idempotency_key = $1",
      [key],
    );
    assert.equal(Number(saved.rows[0]?.total), 1);

    const opened = await openMassLaunch(sqlOf(left), {
      draftId: savedLeft.id,
      actor: OWNER,
    });
    const launched = await Promise.allSettled([
      saveMassDraft(sqlOf(left), composed.draft, OWNER, {
        token: opened.token,
      }),
      saveMassDraft(sqlOf(right), composed.draft, OWNER, {
        token: opened.token,
      }),
    ]);
    assert.equal(
      launched.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.equal(
      launched.filter((item) => item.status === "rejected").length,
      1,
    );
    const row = await left.query<{
      status: string;
      launch_token_hash: string | null;
    }>("select status, launch_token_hash from of_mass_message where id = $1", [
      savedLeft.id,
    ]);
    assert.equal(row.rows[0]?.status, "sent");
    assert.equal(row.rows[0]?.launch_token_hash, null);
  } finally {
    await left.query("rollback").catch(() => undefined);
    await right.query("rollback").catch(() => undefined);
    left.release();
    right.release();
    const present = await pool.query<{ name: string | null }>(
      "select to_regclass('public.of_mass_message') as name",
    );
    if (present.rows[0]?.name) {
      await pool.query(
        `delete from of_mass_message
         where creator_id = $1
            or idempotency_key = $2
            or id = any($3::text[])`,
        [accountId, key, [draftId, `${draftId}-b`]],
      );
      const leftBehind = await pool.query<{ total: number }>(
        `select count(*)::int as total from of_mass_message
         where creator_id = $1 or idempotency_key = $2 or id = any($3::text[])`,
        [accountId, key, [draftId, `${draftId}-b`]],
      );
      assert.equal(Number(leftBehind.rows[0]?.total), 0);
    }
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
