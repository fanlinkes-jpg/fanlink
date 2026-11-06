import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  composeMass,
  dryRunMass,
  type MassSnapshot,
} from "../../../src/lib/mass/index.ts";
import type { ReadSql } from "../sync/store.ts";
import { readMassDraft, saveMassDraft } from "./mass-store.ts";

test("el borrador se guarda y se vuelve a leer, y el dry-run sigue sin enviar", async () => {
  const pg = new PGlite();
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../migrations",
  );
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  try {
    await pg.exec(
      await readFile(path.join(dir, "0021_mass_messages.sql"), "utf8"),
    );
    const composed = composeMass({
      accountId: "cuenta-1",
      name: "Viernes",
      body: "Hola *{nombre}*",
      media: [
        { vaultId: "set-1", preview: true },
        { vaultId: "set-2", preview: false },
      ],
      priceCents: 300,
      scheduledAt: "2026-11-06T18:00:00.000Z",
      segment: { includeAll: true },
      unsendAfterHours: 6,
      followUp: { body: "Seguimos", afterHours: 24 },
      createdBy: { id: "ch-1", name: "Nuria" },
      rotate: false,
      excludeBought: false,
      now: new Date("2026-11-06T10:00:00.000Z"),
      createId: () => "mass-1",
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    await saveMassDraft(sql, composed.draft);
    const stored = await readMassDraft(sql, "mass-1");
    assert.equal(stored?.name, "Viernes");
    assert.equal(stored?.priceCents, 300);
    assert.equal(stored?.media[0]?.preview, true);
    assert.equal(stored?.media[1]?.vaultId, "set-2");
    assert.equal(stored?.createdBy?.name, "Nuria");
    assert.equal(stored?.followUp?.afterHours, 24);
    assert.equal(stored?.status, "scheduled");
    const snapshot: MassSnapshot = {
      accountId: "cuenta-1",
      fans: [
        {
          fanKey: "7",
          name: "Ana",
          handle: "@ana",
          status: "active",
          spentCents: 0,
          spend30Cents: null,
          lastActiveAt: null,
          lastPurchaseAt: null,
        },
      ],
      messages: [],
      ofLists: null,
      contentEvents: null,
      vaultIds: ["set-1", "set-2"],
      sendUsage: null,
    };
    const run = dryRunMass({
      draft: stored ?? composed.draft,
      snapshot,
      now: new Date("2026-11-06T10:00:00.000Z"),
      env: {},
    });
    assert.equal(run.delivered, false);
    assert.equal(run.network, "sin-llamada");
    assert.equal(run.queue[0]?.text, "Hola *Ana*");
    assert.equal(run.queue[0]?.priceCents, 300);
  } finally {
    await pg.close();
  }
});
