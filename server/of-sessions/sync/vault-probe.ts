/**
 * Sondeo de solo lectura de la bóveda. No envía, no cambia la sesión.
 * Escribe la forma sanitizada en data/vault-probe.json.
 * No imprime cookies, sign, sess, x-bc ni tokens.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.ts";
import { decryptBytes } from "../crypto.ts";
import { parseStorageState } from "../sessions/storage-state.ts";
import { AccountStore } from "../store/account-store.ts";
import type { Account } from "../types.ts";
import { sessionForApi, signedHeaders, vaultListsPath, vaultMediaPath } from "./of-chat-api.ts";
import { loadSignRules } from "./of-sign.ts";

const SECRET = /cookie|sign|sess|token|x-bc|x_bc|policy|signature|authorization/i;
const ENUMS = new Set([
  "photo", "image", "video", "audio", "gif", "custom", "posts", "stories",
  "messages", "streams", "media", "all", "desc", "asc", "recent",
]);

export function readProbeAccount(argv: readonly string[]): string {
  const index = argv.indexOf("--account");
  const inline = argv.find((item) => item.startsWith("--account="));
  const value = index >= 0 ? argv[index + 1] : inline?.slice("--account=".length);
  if (!value || value.startsWith("-")) throw new Error("Falta --account.");
  return value.trim();
}

/** Claves, tipos y conteos. Ids, URLs y textos pasan a marcadores. */
export function sanitizeVaultShape(value: unknown, depth = 0): unknown {
  if (depth > 8) return "text";
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => sanitizeVaultShape(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET.test(key)) continue;
      out[key] = sanitizeVaultShape(child, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    if (SECRET.test(value) || /^https?:\/\//i.test(value)) return /^https?:\/\//i.test(value) ? "url" : "text";
    if (ENUMS.has(value.trim().toLowerCase())) return value.trim().toLowerCase();
    if (/^\d{6,}$/.test(value.trim())) return "id";
    return "text";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && value >= 0 && value < 100_000) return value;
    return "id";
  }
  if (typeof value === "boolean" || value == null) return value;
  return "text";
}

export function assertProbeFileSafe(raw: string): void {
  if (/sess=|x-bc|app-token|"sign"\s*:/i.test(raw)) throw new Error("El sondeo iba a guardar un secreto.");
}

export async function executeVaultProbe(input: {
  account: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  now: () => number;
  stdout: (line: string) => void;
  write?: (file: string, body: string) => Promise<void>;
}): Promise<string> {
  const config = loadConfig(input.env);
  if (!config.sessionKey) throw new Error("Falta FANLINK_SESSION_KEY.");
  const state = await loadProbeState(config.dataDir, input.account, config.sessionKey);
  const auth = sessionForApi(state, input.now());
  if ("reason" in auth) throw new Error(auth.reason);
  const rules = await loadSignRules(input.fetch, input.now());
  const reads: Array<{ name: string; path: string; status: number | null; body: unknown }> = [];
  const listsPath = vaultListsPath(0);
  const lists = await probeGet(input.fetch, listsPath, signedHeaders(rules, listsPath, auth, input.now()));
  reads.push({ name: "lists", path: listsPath.split("?")[0] ?? listsPath, status: lists.status, body: lists.body });
  input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/lists status=${lists.status ?? "sin"}`);
  const mediaPath = vaultMediaPath("all", 0, "list");
  const media = await probeGet(input.fetch, mediaPath, signedHeaders(rules, mediaPath, auth, input.now()));
  reads.push({ name: "media-all", path: "/api2/v2/vault/media", status: media.status, body: media.body });
  input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media list=all status=${media.status ?? "sin"}`);
  const folderId = firstFolderId(lists.body);
  if (folderId) {
    const byList = vaultMediaPath(folderId, 0, "list");
    const listed = await probeGet(input.fetch, byList, signedHeaders(rules, byList, auth, input.now()));
    reads.push({ name: "media-list", path: "/api2/v2/vault/media", status: listed.status, body: listed.body });
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media list=carpeta status=${listed.status ?? "sin"}`);
    const byId = vaultMediaPath(folderId, 0, "list_id");
    const ided = await probeGet(input.fetch, byId, signedHeaders(rules, byId, auth, input.now()));
    reads.push({ name: "media-list-id", path: "/api2/v2/vault/media", status: ided.status, body: ided.body });
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media list_id=carpeta status=${ided.status ?? "sin"}`);
  }
  const file = path.join(config.dataDir, "vault-probe.json");
  const body = JSON.stringify({
    at: new Date(input.now()).toISOString(),
    reads: reads.map((read) => ({
      name: read.name,
      path: read.path,
      status: read.status,
      shape: sanitizeVaultShape(read.body),
    })),
  }, null, 2);
  assertProbeFileSafe(body);
  if (input.write) await input.write(file, body);
  else {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(file, body, { mode: 0o600 });
  }
  input.stdout(`[fanlink:vault] sonda archivo=${file}`);
  return file;
}

function firstFolderId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as Record<string, unknown>).list;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toLowerCase() : "";
    if (type === "custom" && (typeof row.id === "number" || typeof row.id === "string")) return String(row.id);
  }
  const first = list.find((entry) => entry && typeof entry === "object" && "id" in (entry as object));
  if (!first || typeof first !== "object") return null;
  const id = (first as Record<string, unknown>).id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

async function probeGet(fetchImpl: typeof fetch, route: string, headers: Record<string, string>): Promise<{ status: number | null; body: unknown }> {
  try {
    const response = await fetchImpl(`https://onlyfans.com${route}`, { method: "GET", headers, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, body: null };
    }
    try {
      return { status: response.status, body: await response.json() };
    } catch {
      return { status: response.status, body: null };
    }
  } catch {
    return { status: null, body: null };
  }
}

async function loadProbeState(dataDir: string, accountToken: string, sessionKey: Buffer) {
  const store = new AccountStore(path.join(dataDir, "accounts.json"));
  await store.init();
  const account = findAccount(await store.list(), accountToken);
  if (!account) throw new Error("No hay una cuenta con ese id.");
  const file = path.join(dataDir, "sessions", `${account.id}.json`);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    throw new Error("Esa cuenta no tiene sesión guardada.");
  }
  return parseStorageState(JSON.parse(decryptBytes(raw, sessionKey).toString("utf8")) as unknown);
}

function findAccount(accounts: Account[], token: string): Account | undefined {
  const needle = token.trim().replace(/^@/, "");
  return accounts.find((item) => item.creatorId === needle)
    ?? accounts.find((item) => item.identityHandle?.replace(/^@/, "").toLowerCase() === needle.toLowerCase())
    ?? accounts.find((item) => item.id === needle);
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  executeVaultProbe({
    account: readProbeAccount(process.argv),
    env: process.env,
    fetch: globalThis.fetch,
    now: () => Date.now(),
    stdout: (line) => console.log(line),
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "No se pudo sondear la bóveda.";
    console.error(message.replace(/https?:\/\/\S+/gi, ""));
    process.exitCode = 1;
  });
}
