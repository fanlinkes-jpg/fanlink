import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listChats, saveChatRead } from "../sync/chat-store.ts";
import { mediaForBrowser } from "../sync/media-client.ts";
import type { ReadSql } from "../sync/store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("la base guarda la URL completa y la vista del fan bloqueado no", async () => {
  const db = new PGlite();
  const files = ["0007_of_reads.sql", "0008_sync_schedule.sql", "0009_of_chats.sql", "0013_chat_price.sql", "0018_chat_preview.sql", "0019_chat_author.sql", "0020_chat_card.sql", "0028_message_media.sql"];
  for (const file of files) await db.exec(await readFile(path.join(root, "migrations", file), "utf8"));
  const sql: ReadSql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  await saveChatRead(sql, "c-1", {
    reason: null,
    jsonPaths: [],
    threads: [],
    messages: [{
      messageKey: "m-fan",
      threadKey: "7",
      fanKey: "7",
      fromFan: true,
      body: "mira",
      sentAt: "2026-11-06T12:00:00.000Z",
      priceCents: 1200,
      purchased: false,
      fromUserId: "7",
      seen: null,
      automatic: null,
      media: [{
        kind: "video",
        seconds: 40,
        preview: "https://cdn2.onlyfans.com/t.jpg",
        full: "https://cdn2.onlyfans.com/privado.mp4",
        locked: true,
        priceCents: 1200,
        paid: false,
        opened: false,
      }],
    }],
  });
  const stored = (await listChats(sql, ["c-1"])).messages[0];
  assert.equal(stored?.media?.[0]?.full, "https://cdn2.onlyfans.com/privado.mp4");
  assert.equal(mediaForBrowser(stored?.media, true)?.[0]?.full, null);
  await db.close();
});
