import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBytes, encryptBytes } from "./crypto.ts";

export type AccountProxy = {
  server: string;
  username: string | null;
  password: string | null;
};

const SCHEME = /^(https?|socks5):\/\//i;

export function parseAccountProxy(input: unknown): AccountProxy {
  if (!input || typeof input !== "object") throw new Error("El proxy no es válido");
  const record = input as Record<string, unknown>;
  const server = typeof record.server === "string" ? record.server.trim() : "";
  if (!SCHEME.test(server) || server.length > 200 || server.includes("@")) {
    throw new Error("El proxy tiene que ser http, https o socks5, sin usuario en la URL");
  }
  const username = typeof record.username === "string" && record.username.trim() ? record.username.trim().slice(0, 80) : null;
  const password = typeof record.password === "string" && record.password ? record.password.slice(0, 200) : null;
  return { server, username, password };
}

export function proxyLabel(proxy: AccountProxy | null): string | null {
  if (!proxy) return null;
  try {
    const url = new URL(proxy.server);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export async function writeAccountProxy(filePath: string, proxy: AccountProxy, key: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const payload = encryptBytes(Buffer.from(JSON.stringify(proxy)), key);
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, payload, { mode: 0o600 });
  await rename(tmp, filePath);
  await chmod(filePath, 0o600);
}

export async function readAccountProxy(filePath: string, key: Buffer): Promise<AccountProxy | null> {
  try {
    const plain = decryptBytes(await readFile(filePath), key);
    return parseAccountProxy(JSON.parse(plain.toString("utf8")) as unknown);
  } catch {
    return null;
  }
}

export async function removeAccountProxy(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
