import assert from "node:assert/strict";
import test from "node:test";
import { vaultMediaPath, vaultPageLog } from "../sync/of-chat-api.ts";
import { assertProbeFileSafe, sanitizeVaultShape } from "../sync/vault-probe.ts";
import { mediaAcceptHeader, vaultPlayerLog } from "../sync/media-bytes.ts";
import { boundVaultOffset, VAULT_OFFSET_CAP } from "../sync/vault-walk.ts";

test("la página de medios usa list y limit 40, sin type ni field", () => {
  const all = vaultMediaPath("all", 0);
  assert.match(all, /\/api2\/v2\/vault\/media\?/);
  assert.match(all, /limit=40/);
  assert.match(all, /sort=desc/);
  assert.match(all, /list=all/);
  assert.equal(all.includes("list_id="), false);
  assert.equal(all.includes("field="), false);
  assert.equal(all.includes("type="), false);
  assert.match(vaultMediaPath("88001", 40), /list=88001/);
  assert.match(vaultMediaPath("88001", 0, "list_id"), /list_id=88001/);
  const line = vaultPageLog({ route: all, status: 200, count: 40, hasMore: "si", offset: 0, listId: "all" });
  assert.match(line, /ruta=\/api2\/v2\/vault\/media status=200 n=40 hasMore=si offset=0 list=all/);
  assert.equal(line.includes("sign"), false);
});

test("el sondeo guarda la forma y no un secreto", () => {
  const shape = sanitizeVaultShape({
    list: [{
      id: 30436421,
      type: "custom",
      name: "B/G LA DUCHA",
      photos: 4,
      videos: 2,
      files: { full: { url: "https://cdn2.onlyfans.com/files/a.mp4?Policy=abc" } },
      cookie: "sess=secreto",
    }],
    hasMore: true,
    sign: "firma",
  });
  const raw = JSON.stringify(shape);
  assertProbeFileSafe(raw);
  assert.equal(raw.includes("https://"), false);
  assert.equal(raw.includes("sess"), false);
  assert.equal(raw.includes("firma"), false);
  assert.equal(raw.includes("LA DUCHA"), false);
  assert.match(raw, /"photos":4/);
  assert.match(raw, /"type":"custom"/);
  assert.match(raw, /"url"/);
  const player = vaultPlayerLog({
    status: 206,
    range: "bytes=0-1048575",
    contentRange: "bytes 0-1048575/9000000",
    contentType: "video/mp4",
    bytes: 1048576,
  });
  assert.match(player, /reproductor status=206 range=bytes=0-1048575/);
  assert.match(player, /tipo=video\/mp4 bytes=1048576/);
  assert.equal(player.includes("http"), false);
  assert.equal(mediaAcceptHeader("https://cdn2.onlyfans.com/files/a.mp4", "bytes=0-100"), "video/*,*/*");
  assert.equal(mediaAcceptHeader("https://cdn2.onlyfans.com/files/a.jpg", null).startsWith("image/"), true);
  assert.throws(() => assertProbeFileSafe('{"u":"https://cdn.example/a?Policy=abc"}'), /secreto/);
  assert.throws(() => assertProbeFileSafe("Signature=abc"), /secreto/);
  assert.equal(sanitizeVaultShape(99999), 99999);
  assert.equal(sanitizeVaultShape(100000), "id");
  assert.equal(sanitizeVaultShape(22), 22);
  const lines: string[] = [];
  assert.equal(boundVaultOffset(9000, 40, (line) => lines.push(line)), VAULT_OFFSET_CAP);
  assert.match(lines[0] ?? "", /corte offset tope=2000 pedido=9000 desde=40/);
  assert.equal(boundVaultOffset(80, 40, () => undefined), 80);
});
