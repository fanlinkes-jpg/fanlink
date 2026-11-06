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
import {
  MassAccessError,
  MassConflictError,
  MassTransitionError,
  openMassLaunch,
  readMassDraft,
  saveMassDraft,
  updateMassStatus,
} from "./mass-store.ts";

const OWNER = { role: "owner" as const, perms: [] as const };

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
      await readFile(path.join(dir, "0027_mass_messages.sql"), "utf8"),
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
      idempotencyKey: "clave-1",
    });
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    await saveMassDraft(sql, composed.draft, OWNER);
    const again = await saveMassDraft(
      sql,
      { ...composed.draft, id: "mass-2" },
      OWNER,
    );
    assert.equal(again.id, "mass-1");
    await assert.rejects(
      () =>
        saveMassDraft(
          sql,
          { ...composed.draft, id: "mass-3", name: "Otro" },
          OWNER,
        ),
      MassConflictError,
    );
    await assert.rejects(
      () =>
        saveMassDraft(sql, composed.draft, {
          role: "member",
          perms: ["campanas"],
        }),
      MassAccessError,
    );
    const stored = await readMassDraft(sql, "mass-1");
    const duplicate = await readMassDraft(sql, "mass-2");
    assert.equal(duplicate, null);
    assert.equal(stored?.name, "Viernes");
    const count = await sql.query<{ total: number }>(
      "select count(*)::int as total from of_mass_message",
    );
    assert.equal(Number(count[0]?.total), 1);
    const kind = await sql.query<{ kind: string }>(
      "select jsonb_typeof(vault_ids) as kind from of_mass_message where id = $1",
      ["mass-1"],
    );
    assert.equal(kind[0]?.kind, "array");
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
      sendUsage: { sentLastHour: 0, sentLastDay: 0 },
      timeZone: "UTC",
    };
    const run = dryRunMass({
      draft: stored ?? composed.draft,
      snapshot,
      now: new Date("2026-11-06T10:00:00.000Z"),
      actor: OWNER,
      env: {},
    });
    assert.equal(run.delivered, false);
    assert.equal(run.network, "sin-llamada");
    assert.equal(run.queue[0]?.text, "Hola *Ana*");
    assert.equal(run.queue[0]?.priceCents, 300);

    const raced = {
      ...composed.draft,
      id: "race-1",
      idempotencyKey: "carrera",
    };
    const [left, right] = await Promise.all([
      saveMassDraft(sql, raced, OWNER),
      saveMassDraft(sql, { ...raced, id: "race-2" }, OWNER),
    ]);
    assert.equal(left.id, right.id);
    const races = await sql.query<{ total: number }>(
      "select count(*)::int as total from of_mass_message where idempotency_key = $1",
      ["carrera"],
    );
    assert.equal(Number(races[0]?.total), 1);

    await assert.rejects(
      () => updateMassStatus(sql, "mass-1", "sent", OWNER),
      MassTransitionError,
    );
    const opened = await openMassLaunch(sql, {
      draftId: "mass-1",
      actor: OWNER,
      now: new Date("2026-11-06T10:00:00.000Z"),
      createToken: () => "tok",
    });
    await assert.rejects(
      () =>
        saveMassDraft(sql, composed.draft, OWNER, {
          token: "tok",
          now: new Date(opened.expiresAt + 5),
        }),
      MassTransitionError,
    );
    const sent = await saveMassDraft(sql, composed.draft, OWNER, {
      token: opened.token,
      now: new Date("2026-11-06T10:00:00.000Z"),
    });
    assert.equal(sent.status, "sent");
    await assert.rejects(
      () => updateMassStatus(sql, "mass-1", "retry", OWNER),
      MassTransitionError,
    );
  } finally {
    await pg.close();
  }
});
