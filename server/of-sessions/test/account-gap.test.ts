import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitAccountGap, clearAccountChatPace, REQUEST_GAP_MS } from "../sync/api-list-pace.ts";
import { nextNoticeListType } from "../sync/of-notifications-api.ts";

test("dos lecturas de la misma cuenta no salen juntas", async () => {
  clearAccountChatPace();
  let now = 1_000_000;
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  await Promise.all([
    awaitAccountGap("acc", () => now, sleep),
    awaitAccountGap("acc", () => now, sleep),
  ]);
  assert.deepEqual(waits, [REQUEST_GAP_MS]);
});

test("una pestaña con cero no leídas entra en la cola", () => {
  assert.equal(nextNoticeListType(0).type, null);
  assert.equal(nextNoticeListType(1).type, "subscribed");
  assert.equal(nextNoticeListType(2).type, "purchases");
});
