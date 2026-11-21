import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertAccountId } from "../types.ts";

const TTL_MS = 6 * 60 * 60 * 1000;

type CachedAvatar = { url: string; at: number };

export async function writeCreatorAvatar(dir: string, accountId: string, url: string, now: number): Promise<void> {
  assertAccountId(accountId);
  if (!url.startsWith("https://") || url.length > 400) return;
  const folder = path.join(dir, "creator-avatars");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, `${accountId}.json`);
  const body: CachedAvatar = { url, at: now };
  await writeFile(file, JSON.stringify(body), { mode: 0o600 });
}

export async function readCreatorAvatar(dir: string, accountId: string, now: number): Promise<string | null> {
  try {
    assertAccountId(accountId);
  } catch {
    return null;
  }
  try {
    const raw = await readFile(path.join(dir, "creator-avatars", `${accountId}.json`), "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedAvatar>;
    if (typeof parsed.url !== "string" || !parsed.url.startsWith("https://")) return null;
    if (typeof parsed.at !== "number" || now - parsed.at > TTL_MS) return null;
    return parsed.url;
  } catch {
    return null;
  }
}
