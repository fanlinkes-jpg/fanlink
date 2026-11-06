import assert from "node:assert/strict";
import { test } from "node:test";
import { fanPageUrls, sectionWaitMs, settleUntil } from "../sync/wait-for-data.ts";

test("en OnlyFans se espera a los datos y se prueba la otra pantalla de fans", () => {
  assert.equal(sectionWaitMs("onlyfans", 1_000), 25_000);
  assert.equal(sectionWaitMs("fixture", 1_000), 1_000);
  const pages = fanPageUrls("onlyfans", "https://onlyfans.com/my/subscribers/active");
  assert.deepEqual(pages, [
    "https://onlyfans.com/my/subscribers/active",
    "https://onlyfans.com/my/collections/subscribers/active",
  ]);
  assert.deepEqual(fanPageUrls("fixture", "http://127.0.0.1/my/subscribers/active"), ["http://127.0.0.1/my/subscribers/active"]);
});

test("la espera corta cuando llegan los datos y no cuando la red se calma", async () => {
  let ready = false;
  let pauses = 0;
  const started = Date.now();
  const pending = Promise.resolve().then(() => {
    ready = true;
  });
  await settleUntil({
    budgetMs: 5_000,
    paceMs: 30,
    ready: () => ready,
    scroll: true,
    wheel: async () => undefined,
    pause: async (ms) => {
      pauses += 1;
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    drain: async () => {
      await pending;
    },
  });
  assert.equal(ready, true);
  assert.ok(Date.now() - started < 2_000);
  assert.ok(pauses < 3);
});
