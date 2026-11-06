import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingForThread } from "./pending-thread.ts";

test("dos creadoras con el mismo hilo ven solo sus pendientes", () => {
  const pending = [
    { id: "a", creatorId: "9ikis52", threadKey: "28022478", body: "para la primera" },
    { id: "b", creatorId: "otra", threadKey: "28022478", body: "para la segunda" },
    { id: "c", creatorId: "9ikis52", threadKey: "otro-hilo", body: "otro hilo" },
  ];
  const first = pendingForThread(pending, { creatorId: "9ikis52", threadKey: "28022478" });
  const second = pendingForThread(pending, { creatorId: "otra", threadKey: "28022478" });
  assert.deepEqual(first.map((item) => item.id), ["a"]);
  assert.deepEqual(first.map((item) => item.body), ["para la primera"]);
  assert.deepEqual(second.map((item) => item.id), ["b"]);
  assert.deepEqual(second.map((item) => item.body), ["para la segunda"]);
  assert.deepEqual(pendingForThread(pending, null), []);
});
