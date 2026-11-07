import assert from "node:assert/strict";
import { test } from "node:test";
import { chatMediaSrc, vaultMediaSrc } from "./chat-media.ts";

test("el reproductor apunta al proxy y no a una URL firmada", () => {
  const src = chatMediaSrc({ creatorId: "c-1", threadKey: "7", messageKey: "m1", index: 0 });
  assert.equal(src.startsWith("/api/chat-media?"), true);
  assert.equal(src.includes("onlyfans.com"), false);
  assert.equal(src.includes("http"), false);
  const thumb = vaultMediaSrc("c-1", "v1");
  assert.equal(thumb.startsWith("/api/vault-media?"), true);
  assert.equal(thumb.includes("cdn"), false);
});
