import { stat } from "node:fs/promises";
import path from "node:path";

const COOKIE_FILES = ["Default/Network/Cookies", "Default/Cookies", "Cookies"] as const;

type CookieDb = {
  prepare(sql: string): { get(name: string): { ok?: number } | undefined };
  close(): void;
};

let sqliteMissing = false;

/**
 * `node:sqlite` llega estable en Node 22.13. Un import estático revienta
 * 22.3 y 22.12 al cargar el gestor de sesión (`ERR_UNKNOWN_BUILTIN_MODULE`).
 */
async function openCookieDb(file: string): Promise<CookieDb | null> {
  if (sqliteMissing) return null;
  try {
    const mod = await import("node:sqlite") as {
      DatabaseSync: new (filename: string, options: { readOnly: boolean }) => CookieDb;
    };
    return new mod.DatabaseSync(file, { readOnly: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ERR_UNKNOWN_BUILTIN_MODULE" || code === "ERR_MODULE_NOT_FOUND") {
      sqliteMissing = true;
      console.info("[fanlink:clearance] node:sqlite no está en este Node; hace falta >=22.13");
      return null;
    }
    return null;
  }
}

/** Solo el nombre. El valor cifrado de Chrome no se lee. */
export async function profileHasClearanceName(dir: string): Promise<boolean> {
  for (const relative of COOKIE_FILES) {
    const file = path.join(dir, relative);
    try {
      await stat(file);
    } catch {
      continue;
    }
    const db = await openCookieDb(file);
    if (!db) continue;
    try {
      const row = db.prepare("SELECT 1 AS ok FROM cookies WHERE name = ? LIMIT 1").get("cf_clearance") as { ok?: number } | undefined;
      if (row?.ok === 1) return true;
    } catch {
      // El archivo puede estar bloqueado o no ser la tabla de Chrome.
    } finally {
      db.close();
    }
  }
  return false;
}
