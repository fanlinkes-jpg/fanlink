import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { presentTeamMetrics } from "../metrics/present-team.ts";
import { listChats, listPendingOutbounds, recordOutbound, saveChatRead } from "../sync/chat-store.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("un pendiente de la bandeja queda atribuido en el hilo y en Equipo al sincronizar", async () => {
  const db = new PGlite();
  const files = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0021_message_media.sql"];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await db.exec("insert into staff_profile (user_id, display_name, role) values ('e-1', 'Ana', 'chatter')");
  await recordOutbound(sql, {
    id: "out-1",
    createdAt: new Date().toISOString(),
    creatorId: "creator-1",
    fanKey: "fan-7",
    threadKey: "fan-7",
    authorId: "e-1",
    body: "hola",
    priceCents: null,
    ofMessageKey: null,
  });
  const pending = await listPendingOutbounds(sql, ["creator-1"]);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.body, "hola");
  await saveChatRead(sql, "creator-1", {
    reason: null,
    jsonPaths: [],
    threads: [],
    messages: [
      {
        messageKey: "m-1",
        threadKey: "fan-7",
        fanKey: "fan-7",
        body: "hola",
        sentAt: new Date().toISOString(),
        priceCents: null,
        purchased: null,
        seen: null,
        automatic: false,
        fromFan: false,
        fromUserId: "me",
      },
    ],
  });
  const stored = (await listChats(sql, ["creator-1"])).messages[0];
  assert.equal(stored?.authorId, "e-1");
  assert.equal(stored?.authorName, "Ana");
  assert.equal((await listPendingOutbounds(sql, ["creator-1"])).length, 0);
  const team = presentTeamMetrics(
    { role: "owner", userId: "owner", perms: [], creatorIds: [] },
    [{
      creatorId: "creator-1",
      threadKey: "fan-7",
      fanKey: "fan-7",
      at: stored?.sentAt ?? "",
      fromFan: false,
      priceCents: null,
      purchased: null,
      authorId: stored?.authorId ?? null,
    }],
    [],
    new Map([["e-1", "Ana"]]),
  );
  assert.equal(team.find((row) => row.userId === "e-1")?.name, "Ana");
  await db.close();
});
