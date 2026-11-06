import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { campaignConversion, recordCampaignResult } from "./results.ts";
import type { ReadSql } from "../sync/store.ts";

test("la conversión de una campaña no inventa compras", () => {
  assert.equal(campaignConversion(10, null), null);
  assert.equal(campaignConversion(0, 1), null);
  assert.equal(campaignConversion(4, 1), 0.25);
});

test("el simulador puede guardar compras e ingresos de un borrador", async () => {
  const pg = new PGlite();
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  try {
    await pg.exec(await readFile(path.join(dir, "0016_campaign_results.sql"), "utf8"));
    await recordCampaignResult(sql, "draft-1", { purchases: 2, revenueCents: 1500 });
    const rows = await sql.query<{ purchases: number; revenue_cents: number }>(
      "select purchases, revenue_cents from of_campaign_result where draft_id = $1",
      ["draft-1"],
    );
    assert.equal(Number(rows[0]?.purchases), 2);
    assert.equal(Number(rows[0]?.revenue_cents), 1500);
    assert.equal(campaignConversion(8, Number(rows[0]?.purchases)), 0.25);
  } finally {
    await pg.close();
  }
});
