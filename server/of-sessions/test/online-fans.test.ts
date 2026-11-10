import assert from "node:assert/strict";
import { test } from "node:test";
import { onlineFansFromPayload, subscribersResponse } from "../sync/online-fans.ts";

test("el filtro en línea se reconoce y solo entran los que están conectados", () => {
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/subscriptions/subscribers?type=active&filter[online]=1"), "online");
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/subscriptions/subscribers?offset=0"), "all");
  assert.equal(subscribersResponse("https://onlyfans.com/api2/v2/chats"), null);
  const rows = onlineFansFromPayload({
    list: [
      { id: 1, name: "Arias Crazy", username: "arias_crazy1", isOnline: true, avatar: "https://cdn.example/a.jpg" },
      { id: 2, name: "Otro", username: "otro", isOnline: false },
    ],
  });
  assert.deepEqual(rows, [{ fanKey: "1", fanName: "Arias Crazy", fanHandle: "arias_crazy1", avatarUrl: "https://cdn.example/a.jpg" }]);
  assert.equal(onlineFansFromPayload({ list: [{ id: 9, username: "duchamp", isOnline: false }] }, false).length, 1);
});
