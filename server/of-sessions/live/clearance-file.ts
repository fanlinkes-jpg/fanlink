import { stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const COOKIE_FILES = ["Default/Network/Cookies", "Default/Cookies", "Cookies"] as const;

/** Solo el nombre. El valor cifrado de Chrome no se lee. */
export async function profileHasClearanceName(dir: string): Promise<boolean> {
  for (const relative of COOKIE_FILES) {
    const file = path.join(dir, relative);
    try {
      await stat(file);
    } catch {
      continue;
    }
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const row = db.prepare("SELECT 1 AS ok FROM cookies WHERE name = ? LIMIT 1").get("cf_clearance") as { ok?: number } | undefined;
      if (row?.ok === 1) return true;
    } catch {
      // El archivo puede estar bloqueado o no ser la tabla de Chrome.
    } finally {
      db?.close();
    }
  }
  return false;
}
