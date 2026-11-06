import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

test("las migraciones aplican en Postgres cuando hay DATABASE_URL", async (t) => {
  const databaseUrl = process.env.FANLINK_TEST_DATABASE_URL;
  if (!databaseUrl) {
    t.skip("sin FANLINK_TEST_DATABASE_URL");
    return;
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const applied = await pool.query<{ name: string }>("select name from _migrations order by name");
    const names = applied.rows.map((row) => row.name);
    assert.equal(names.includes("0001_auth.sql"), true);
    assert.equal(names.includes("0012_extended_read.sql"), true);
    assert.equal(names.includes("0016_campaign_results.sql"), true);
    assert.equal(names.includes("0020_chat_card.sql"), true);
    assert.equal(names.includes("0027_mass_messages.sql"), true);
    assert.equal(names.includes("0028_message_media.sql"), true);
    assert.equal(names.includes("0029_vault_media.sql"), true);
    assert.equal(names.includes("0030_outbound_media.sql"), true);
    assert.equal(names.includes("0031_outbound_media_owner.sql"), true);
    const table = await pool.query<{ to_regclass: string | null }>("select to_regclass('public.of_transaction') as to_regclass");
    assert.equal(table.rows[0]?.to_regclass, "of_transaction");
    const media = await pool.query<{ to_regclass: string | null }>("select to_regclass('public.of_outbound_media') as to_regclass");
    assert.equal(media.rows[0]?.to_regclass, "of_outbound_media");
    const column = await pool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'of_outbound_media' and column_name = 'creator_id'",
    );
    assert.equal(column.rows[0]?.column_name, "creator_id");
  } finally {
    await pool.end();
  }
});
