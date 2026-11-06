import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createSessionRuntime } from "../runtime.ts";
import { chartEarnings, classifyJsonPath, parseEarningsDom, parseEarningsJson, parseFansJson, parseTransactions, readFailureReason } from "../sync/parse.ts";
import { listCreatorReads, saveCreatorRead, type ReadSql } from "../sync/store.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

const NOW = new Date("2026-11-05T00:00:00.000Z");

test("clasifica rutas de ingresos y fans sin usar la query", () => {
  assert.equal(classifyJsonPath("https://onlyfans.com/api2/v2/earnings/chart?token=sekret"), "earnings");
  assert.equal(classifyJsonPath("https://onlyfans.com/api2/v2/subscriptions/subscribers?offset=0"), "fans");
  assert.equal(classifyJsonPath("https://onlyfans.com/api2/v2/users/me"), "other");
});

test("el JSON inventado de ingresos y fans no copia secretos", () => {
  const earnings = parseEarningsJson(
    {
      currency: "USD",
      password: "no-guardar",
      list: [{ date: "2026-11-01", subscriptions: 4, tips: 3, messages: 2, posts: 1, total: 99 }],
    },
    NOW,
  );
  assert.equal(JSON.stringify(earnings).includes("no-guardar"), false);
  assert.equal(earnings.find((row) => row.kind === "subscription")?.amountCents, 400);
  assert.equal(chartEarnings(earnings).find((row) => row.day === "2026-11-01")?.amountCents, 1000);

  const fans = parseFansJson(
    {
      list: [
        { id: 7, username: "fanuno", name: "Fan Uno", password: "no-guardar", subscribedOnData: { subscribedAt: "2026-10-01", totalSumm: 15.5 } },
        { id: 8, username: "fanexp", name: "Fan Exp", subscribedOnExpiredNow: true, subscribedOnData: { subscribeAt: "2026-01-02", totalSumm: 0 } },
        { id: 1, username: "creadora", isPerformer: true, name: "Creadora" },
      ],
    },
    NOW,
  );
  assert.equal(fans.length, 2);
  assert.equal(fans.find((fan) => fan.handle === "fanuno")?.spentCents, 1550);
  assert.equal(fans.find((fan) => fan.handle === "fanexp")?.status, "expired");
  assert.equal(JSON.stringify(fans).includes("no-guardar"), false);
  const txs = parseTransactions(
    {
      transactions: [
        { id: "tx-1", createdAt: "2026-11-03T15:00:00.000Z", amount: 10, net: 8, type: "tip", user: { id: 7 }, password: "no-guardar" },
        { date: "2026-11-01", subscriptions: 4 },
      ],
    },
    NOW,
  );
  assert.equal(txs.length, 1);
  assert.equal(txs[0]?.grossCents, 1000);
  assert.equal(txs[0]?.netCents, 800);
  assert.equal(txs[0]?.kind, "tip");
  assert.equal(txs[0]?.fanKey, "7");
  assert.equal(JSON.stringify(txs).includes("no-guardar"), false);
  assert.equal(parseFansJson({ list: [{ id: 7, username: "fanuno", subscribedOnData: { autoRenew: false, expiredAt: "2026-12-01" } }] }, NOW)[0]?.renewAuto, false);
  assert.equal(parseEarningsDom([{ day: "2026-11-02", kind: "tip", amount: "1.5", currency: "USD" }], NOW)[0]?.amountCents, 150);
  const reason = readFailureReason({
    redirected: false,
    wantEarnings: true,
    earningsUrl: false,
    earningsRows: false,
    fansUrl: true,
    fansRows: false,
    jsonPaths: ["https://onlyfans.com/api2/v2/init", "https://onlyfans.com/api2/v2/earnings/chart?token=sekret"],
  });
  assert.match(reason ?? "", /sin respuesta de ingresos/);
  assert.match(reason ?? "", /página cambiada \(fans\)/);
  assert.equal(reason?.includes("sekret"), false);
  assert.equal(reason?.includes("?"), false);
});

test("la sincronización lee el JSON que piden las páginas y lo guarda", { timeout: 60_000 }, async () => {
  const dataDir = await tempDataDir();
  const fixture = await startFixture();
  const created = await createSessionRuntime({
    config: testConfig(dataDir),
    site: fixture.site,
    browserFactory: recordingFactory([]),
    displayEnv: testDisplay,
    afterLoginPageOpen: (page) => completeFixtureLogin(page),
  });
  const pg = new PGlite();
  const migration = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations/0007_of_reads.sql");
  try {
    const account = await created.sessions.addAccount("Principal", "c-alba");
    await created.sessions.whenLoginSettled(account.id);
    const read = await created.sessions.readCreatorData(account.id, true);
    const raw = JSON.stringify(read);
    assert.equal(read.reason, null);
    assert.equal(read.earnings.find((row) => row.kind === "subscription")?.amountCents, 400);
    assert.equal(read.fans.find((fan) => fan.handle === "fanuno")?.status, "active");
    assert.equal(raw.includes("sekret"), false);
    assert.equal(raw.includes("no-guardar"), false);
    assert.equal(raw.includes("token="), false);
    assert.equal(read.jsonPaths.some((path) => path.endsWith("/api2/v2/earnings/chart")), true);
    await created.store.update(account.id, { identityState: "mismatch" });
    const blocked = await created.sessions.readCreatorData(account.id, true);
    assert.match(blocked.reason ?? "", /bloqueadas/);
    assert.equal(blocked.fans.length, 0);

    await pg.exec(await readFile(migration, "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(migration), "0008_sync_schedule.sql"), "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(migration), "0012_extended_read.sql"), "utf8"));
    await pg.exec(await readFile(path.resolve(path.dirname(migration), "0017_tx_cursor_key.sql"), "utf8"));
    const sql: ReadSql = {
      async query<T>(text: string, params?: unknown[]): Promise<T[]> {
        const result = await pg.query<T>(text, params);
        return result.rows;
      },
    };
    await saveCreatorRead(sql, "c-alba", read, NOW);
    const [stored] = await listCreatorReads(sql, ["c-alba"]);
    assert.equal(stored?.earnings.find((row) => row.kind === "tip")?.amountCents, 300);
    assert.equal(stored?.fans.length, 2);
    assert.equal(stored?.fans.find((fan) => fan.handle === "fanuno")?.renewAuto, true);
    assert.equal(stored?.transactions.length, 1);
    assert.equal(stored?.transactions[0]?.netCents, 800);
    await saveCreatorRead(sql, "c-alba", read, NOW);
    const [second] = await listCreatorReads(sql, ["c-alba"]);
    assert.equal(second?.transactions.length, 1);
    assert.equal(stored?.earningsSyncedAt?.startsWith("2026-11-05"), true);
    const again = JSON.stringify(stored);
    assert.equal(again.includes("sekret"), false);
  } finally {
    await created.close();
    await fixture.close();
    await pg.close();
    await removeDir(dataDir);
  }
});
