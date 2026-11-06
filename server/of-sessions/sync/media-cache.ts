import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const MEDIA_CACHE_MAX_FILES = 200;
export const MEDIA_CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Borra miniaturas viejas y recorta la carpeta si pasa de ficheros o de bytes. */
export async function pruneMediaCache(
  dir: string,
  now = Date.now(),
  limits: { maxFiles?: number; maxBytes?: number; maxAgeMs?: number } = {},
): Promise<number> {
  const maxFiles = limits.maxFiles ?? MEDIA_CACHE_MAX_FILES;
  const maxBytes = limits.maxBytes ?? MEDIA_CACHE_MAX_BYTES;
  const maxAgeMs = limits.maxAgeMs ?? MEDIA_CACHE_MAX_AGE_MS;
  const files = await listFiles(dir);
  const doomed = new Set<string>();
  const keep: Array<{ file: string; mtime: number; size: number }> = [];
  for (const file of files) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    if (now - info.mtimeMs > maxAgeMs) doomed.add(file);
    else keep.push({ file, mtime: info.mtimeMs, size: info.size });
  }
  keep.sort((a, b) => a.mtime - b.mtime);
  let bytes = keep.reduce((sum, item) => sum + item.size, 0);
  while (keep.length > maxFiles || bytes > maxBytes) {
    const oldest = keep.shift();
    if (!oldest) break;
    doomed.add(oldest.file);
    bytes -= oldest.size;
  }
  await Promise.all([...doomed].map((file) => rm(file, { force: true })));
  return doomed.size;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
