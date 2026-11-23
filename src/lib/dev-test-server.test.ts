import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { test } from "node:test";
import { assertDevPortFree, forgetPgliteDir, privatePgliteDir, shotDir } from "./dev-test-server.ts";

test("8081 ocupado no deja arrancar y el PGlite temporal se borra", async () => {
  const first = await privatePgliteDir();
  const second = await privatePgliteDir();
  assert.notEqual(first, second);
  assert.equal(existsSync(first), true);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  forgetPgliteDir(child, first);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", () => resolve(undefined)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(existsSync(first), false);
  await rm(second, { recursive: true, force: true });
  assert.equal(existsSync(second), false);
  const shots = shotDir();
  if (!existsSync("/opt/cursor/artifacts")) assert.equal(shots.includes("/opt/cursor/artifacts"), false);

  const holder = createServer();
  await new Promise<void>((resolve, reject) => {
    holder.once("error", reject);
    holder.listen(8081, "127.0.0.1", () => resolve());
  });
  try {
    await assert.rejects(() => assertDevPortFree(), /8081/);
  } finally {
    await new Promise((resolve) => holder.close(() => resolve(undefined)));
  }
});
