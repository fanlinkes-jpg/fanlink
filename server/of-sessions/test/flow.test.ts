import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { deliverDrafts } from "../campaigns/deliver.ts";
import { fansInSegment } from "../campaigns/segment.ts";
import { deliverFanAlerts } from "../notify/deliver.ts";
import { createSessionRuntime } from "../runtime.ts";
import { saveChatRead } from "../sync/chat-store.ts";
import { saveCreatorRead, type ReadSql } from "../sync/store.ts";
import { startFixture } from "./fixture-site.ts";
import { completeFixtureLogin, recordingFactory, removeDir, tempDataDir, testConfig, testDisplay } from "./helpers.ts";

test("flujo completo contra el simulador: conectar, comprobar, sincronizar, chat, aviso y borrador", { timeout: 90_000 }, async () => {
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
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  };
  try {
    for (const name of [
      "0002_workspace.sql",
      "0003_of_sessions.sql",
      "0004_staff_and_connection.sql",
      "0007_of_reads.sql",
      "0008_sync_schedule.sql",
      "0009_of_chats.sql",
      "0010_staff_alerts.sql",
      "0012_extended_read.sql",
      "0017_tx_cursor_key.sql",
      "0013_chat_price.sql",
      "0018_chat_preview.sql",
      "0019_chat_author.sql",
      "0020_chat_card.sql",
      "0021_fan_profile.sql",
      "0022_message_media.sql",
      "0024_outbound_schedule.sql",
      "0025_outbound_send.sql",
      "0026_chat_history.sql",
    ]) {
      await pg.exec(await readFile(path.join(dir, name), "utf8"));
    }
    await sql.query(
      "insert into workspace_state (id, state, version, updated_by) values (1, $1::jsonb, 1, $2)",
      [JSON.stringify({ creators: [{ id: "c-alba", name: "Alba", handle: "@creadora" }] }), "test"],
    );

    const account = await created.sessions.addAccount("Alba", "c-alba");
    await created.sessions.whenLoginSettled(account.id);
    assert.equal((await created.sessions.getAccount(account.id)).status, "active");

    const checked = await created.sessions.inspectConnection(account.id, "@creadora");
    assert.equal(checked.connection, "live");
    assert.equal(checked.identityState, "verified");
    assert.equal(checked.identityHandle, "creadora");

    const read = await created.sessions.readCreatorData(account.id, true);
    assert.equal(read.reason, null);
    assert.ok(read.earnings.some((row) => row.kind === "subscription"));
    assert.ok(read.fans.some((fan) => fan.handle === "fanuno"));
    await saveCreatorRead(sql, "c-alba", read);

    const chats = await created.sessions.readCreatorChats(account.id);
    assert.equal(chats.reason, null);
    assert.equal(chats.threads[0]?.fanName, "Fan Uno");
    const events = await saveChatRead(sql, "c-alba", chats);
    assert.equal(events.length, 1);

    await sql.query("insert into creator_grant (user_id, creator_id) values ($1, $2)", ["chatter", "c-alba"]);
    await sql.query(
      "insert into staff_alert (user_id, phone, alerts_enabled, quiet_minutes) values ($1, $2, true, 15)",
      ["chatter", "+34600000000"],
    );
    const sent = await deliverFanAlerts(sql, events, {});
    assert.equal(sent, 1);
    const deliveries = await sql.query("select provider, simulated from alert_delivery");
    assert.equal(deliveries[0]?.provider, "simulated");
    assert.equal(deliveries[0]?.simulated, true);

    const segment = fansInSegment(
      read.fans.map((fan) => ({
        fanKey: fan.fanKey,
        name: fan.displayName,
        status: fan.status,
        spentCents: fan.spentCents,
        lastInteractionAt: fan.handle === "fanuno" ? "2026-11-05T10:00:00.000Z" : null,
      })),
      "active",
      { minSpentCents: 0, quietDays: 30, now: new Date("2026-11-05T12:00:00.000Z") },
    );
    assert.ok(segment.some((fan) => fan.name === "Fan Uno"));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const blocked = await deliverDrafts(page, {
        flag: "false",
        hostname: new URL(fixture.origin).hostname,
        formUrl: `${fixture.origin}/simulate-send`,
        drafts: [{ fanKey: "7", body: "Hola Fan Uno", priceCents: 500 }],
      });
      assert.equal(blocked.reason, "Envío real desactivado");
      assert.equal(fixture.sent.length, 0);
    } finally {
      await browser.close();
    }
  } finally {
    await created.close();
    await fixture.close();
    await pg.close();
    await removeDir(dataDir);
  }
});
