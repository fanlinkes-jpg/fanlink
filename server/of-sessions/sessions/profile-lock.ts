import { readlink, unlink } from "node:fs/promises";
import path from "node:path";

const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"] as const;

export type ProfileLock = { pid: number };

/** Chrome deja el pid en el enlace `SingletonLock` (`hostname-pid`). */
export async function readProfileLock(dir: string): Promise<ProfileLock | null> {
  try {
    const target = await readlink(path.join(dir, "SingletonLock"));
    const pid = Number(target.slice(target.lastIndexOf("-") + 1));
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid };
  } catch {
    return null;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}

export async function clearStaleProfileLock(dir: string): Promise<void> {
  await Promise.all(LOCK_FILES.map((name) => unlink(path.join(dir, name)).catch(() => undefined)));
}

/**
 * Espera a que el Chromium anterior suelte el perfil.
 * `ajeno` significa que otro proceso sigue vivo: no hay que lanzar otro.
 */
export async function waitForProfileLock(
  dir: string,
  alive: (pid: number) => boolean = pidAlive,
  timeoutMs = 3_000,
): Promise<"libre" | "ajeno"> {
  const started = Date.now();
  for (;;) {
    const lock = await readProfileLock(dir);
    if (!lock) return "libre";
    if (!alive(lock.pid)) {
      await clearStaleProfileLock(dir);
      return "libre";
    }
    if (Date.now() - started >= timeoutMs) return "ajeno";
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
