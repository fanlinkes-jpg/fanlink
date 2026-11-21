import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { creatorAvatarOf } from "./creator-avatar.ts";
import { readCreatorAvatar, writeCreatorAvatar } from "../../server/of-sessions/sync/creator-avatar-cache.ts";

const accountId = "7816f9e7-3d30-4fe8-8719-c09cb516bca6";

test("la foto sale de users/me y rechaza http, query y secretos", () => {
  assert.equal(creatorAvatarOf({ avatar: "https://cdn.example/a.jpg" }), "https://cdn.example/a.jpg");
  assert.equal(creatorAvatarOf({ avatarThumbs: { c50: "https://cdn.example/t.jpg" } }), "https://cdn.example/t.jpg");
  assert.equal(creatorAvatarOf({ avatar: "http://cdn.example/a.jpg" }), null);
  assert.equal(creatorAvatarOf({ avatar: "https://cdn.example/a.jpg?token=secreto" }), null);
  assert.equal(creatorAvatarOf({ user: { avatar: "https://user:secreto@cdn.example/a.jpg" } }), null);
  assert.equal(creatorAvatarOf({ name: "Jose" }), null);
});

test("la caché de la foto caduca y no hace falta volver a pedirla antes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fanlink-avatar-"));
  try {
    const now = 1_000_000;
    await writeCreatorAvatar(dir, accountId, "https://cdn.example/jose.jpg", now);
    assert.equal(await readCreatorAvatar(dir, accountId, now + 1000), "https://cdn.example/jose.jpg");
    assert.equal(await readCreatorAvatar(dir, accountId, now + 6 * 60 * 60 * 1000 + 1), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
