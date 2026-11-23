import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChildProcess } from "node:child_process";

const BUSY_PORT = 8081;

export async function assertDevPortFree(port = BUSY_PORT): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`El puerto ${port} está en uso`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

export async function privatePgliteDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fanlink-pglite-"));
}

export function forgetPgliteDir(child: ChildProcess, dataDir: string): void {
  child.on("exit", () => {
    void rm(dataDir, { recursive: true, force: true });
  });
}

export function shotDir(): string {
  const preferred = "/opt/cursor/artifacts";
  if (existsSync(preferred)) return preferred;
  const fallback = join(tmpdir(), "fanlink-shots");
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function shotFile(name: string): string {
  return join(shotDir(), name);
}
