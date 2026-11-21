import assert from "node:assert/strict";
import test from "node:test";
import { vaultMediaPath, vaultPageLog } from "../sync/of-chat-api.ts";
import { assertProbeFileSafe, folderProbePaths, folderProbeVerdict, pickSmallVideoFolder, probeExpectedCount, probePageContinues, readProbeFolders, sanitizeVaultShape, vaultListLines } from "../sync/vault-probe.ts";
import { VAULT_LISTS_FIXTURE } from "./fixtures/vault-of-shape.ts";
import { mediaAcceptHeader, vaultPlayerLog } from "../sync/media-bytes.ts";
import { boundVaultOffset, VAULT_OFFSET_CAP } from "../sync/vault-walk.ts";
import { vaultFolderMark } from "../sync/vault-model.ts";

test("la página de medios usa list y limit 40, sin type ni field", () => {
  const all = vaultMediaPath("all", 0);
  assert.match(all, /\/api2\/v2\/vault\/media\?/);
  assert.match(all, /limit=40/);
  assert.match(all, /sort=desc/);
  assert.match(all, /list=all/);
  assert.equal(all.includes("list_id="), false);
  assert.match(all, /field=recent/);
  assert.equal(all.includes("type="), false);
  assert.match(vaultMediaPath("88001", 40), /list=88001/);
  assert.match(vaultMediaPath("88001", 40), /field=recent/);
  assert.equal(vaultMediaPath("88001", 40).includes("list_id="), false);
  const line = vaultPageLog({ route: all, status: 200, count: 40, hasMore: "si", offset: 0, listId: "all" });
  assert.match(line, /ruta=\/api2\/v2\/vault\/media status=200 n=40 hasMore=si offset=0 list=todos/);
  const mark = vaultFolderMark("28619188");
  assert.equal(mark, vaultFolderMark("28619188"));
  assert.notEqual(mark, vaultFolderMark("29012649"));
  assert.equal(mark.includes("28619188"), false);
  assert.equal(vaultFolderMark("all"), "todos");
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
  assert.equal(mediaAcceptHeader("https://cdn2.onlyfans.com/files/a.jpg", "bytes=0-100").startsWith("image/"), true);
  const hidden = sanitizeVaultShape({ id: 12, listId: 34, photosCount: 4, minus: -2, ratio: 1.5 }) as Record<string, unknown>;
  assert.equal(hidden.id, "id");
  assert.equal(hidden.listId, "id");
  const paid = sanitizeVaultShape({ paid: 12, valid: 3 }) as Record<string, unknown>;
  assert.equal(paid.paid, 12);
  assert.equal(paid.valid, 3);
  assert.equal(hidden.photosCount, 4);
  assert.equal(hidden.minus, "id");
  assert.equal(hidden.ratio, "id");
  const kept = sanitizeVaultShape({
    list: [
      { id: 1, type: "stories", photosCount: 0 },
      { id: 2, type: "posts", photosCount: 3 },
      { id: 3, type: "custom", photosCount: 5 },
    ],
  }) as { list: unknown[] };
  assert.equal(kept.list.length, 3);
  const summary = vaultListLines([VAULT_LISTS_FIXTURE]);
  assert.match(summary[0] ?? "", /type=stories n=1/);
  assert.match(summary[0] ?? "", /type=custom n=1/);
  assert.match(summary[1] ?? "", /fotos=5 videos=2/);
  assert.equal(summary.join(" ").includes("Carpeta"), false);
  assert.equal(probePageContinues({ list: Array.from({ length: 50 }, () => ({})), hasMore: false }, 50), true);
  assert.equal(probePageContinues({ list: [{ id: 1 }], hasMore: false }, 50), false);
  assert.throws(() => assertProbeFileSafe('{"u":"https://cdn.example/a?Policy=abc"}'), /secreto/);
  assert.throws(() => assertProbeFileSafe("Signature=abc"), /secreto/);
  assert.equal(sanitizeVaultShape(99999), 99999);
  assert.equal(sanitizeVaultShape(100000), "id");
  assert.equal(sanitizeVaultShape(22), 22);
  const lines: string[] = [];
  assert.equal(boundVaultOffset(9000, 40, (line) => lines.push(line)), VAULT_OFFSET_CAP);
  assert.match(lines[0] ?? "", /corte offset tope=2000 pedido=9000 desde=40/);
  assert.equal(boundVaultOffset(80, 40, () => undefined), 80);
  assert.equal(readProbeFolders(["--account", "3zk7kbr", "--folders"]), true);
  const picked = pickSmallVideoFolder([{
    list: [
      { id: 11, type: "custom", name: "B/G LA DUCHA", videosCount: 0, photosCount: 4 },
      { id: 28619188, type: "custom", name: "B/B/B/G EL CUARTETO", videosCount: 2, photosCount: 0, gifsCount: 0, audiosCount: 0 },
      { id: 30, type: "custom", videosCount: 11 },
    ],
  }]);
  assert.equal(picked?.id, "28619188");
  assert.equal(picked?.videos, 2);
  assert.equal(probeExpectedCount(picked!), 2);
  const paths = folderProbePaths("28619188").map((row) => row.name);
  assert.deepEqual(paths, ["panel", "list_id", "list_id+field", "list", "lists/media", "listId", "vaultListId"]);
  assert.match(folderProbePaths("28619188")[0]?.path ?? "", /field=recent/);
  assert.match(folderProbePaths("28619188")[0]?.path ?? "", /list=28619188/);
  assert.equal(folderProbePaths("28619188").some((row) => row.path.startsWith("POST")), false);
  assert.equal(folderProbeVerdict(2, [{ name: "list_id", status: 200, n: 40 }, { name: "listId", status: 200, n: 2 }]), "listId");
  assert.equal(folderProbeVerdict(2, [{ name: "list_id", status: 200, n: 40 }]), "ninguna");
  const line = `[fanlink:vault] sonda variante=list_id status=200 n=40 hasMore=si enLista=2`;
  assert.equal(line.includes("28619188"), false);
  assert.equal(line.includes("CUARTETO"), false);
});
