import assert from "node:assert/strict";
import test from "node:test";
import { fanChatUrl, fanProfileUrl } from "./fan-links.ts";

test("enlaces reales de OnlyFans", () => {
  assert.equal(fanProfileUrl("@ana_93", "123"), "https://onlyfans.com/ana_93");
  assert.equal(fanProfileUrl(null, "123"), "https://onlyfans.com/u123");
  assert.equal(fanProfileUrl("no valido!", "123"), "https://onlyfans.com/u123");
  assert.equal(fanProfileUrl(null, null), null);
  assert.equal(fanChatUrl("456"), "https://onlyfans.com/my/chats/chat/456");
  assert.equal(fanChatUrl("abc"), null);
  assert.equal(fanChatUrl(null), null);
});
