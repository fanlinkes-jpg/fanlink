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

function isIdKey(key: string): boolean {
  return key === "id" || key.endsWith("Id") || key.endsWith("_id");
}

/**
 * Claves, tipos y conteos. Ids, URLs y textos pasan a marcadores.
 * Un array `list` se guarda entero: el corte a 2 escondía las carpetas custom.
 * El resto de arrays se queda en dos ejemplos.
 */
export function sanitizeVaultShape(value: unknown, depth = 0, key = ""): unknown {
  if (depth > 8) return "text";
  if (Array.isArray(value)) {
    const items = key === "list" ? value : value.slice(0, 2);
    return items.map((item) => sanitizeVaultShape(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET.test(childKey)) continue;
      out[childKey] = sanitizeVaultShape(child, depth + 1, childKey);
    }
    return out;
  }
  if (typeof value === "string") {
    if (isIdKey(key) && /^-?\d/.test(value.trim())) return "id";
    if (SECRET.test(value) || /^https?:\/\//i.test(value)) return /^https?:\/\//i.test(value) ? "url" : "text";
    if (ENUMS.has(value.trim().toLowerCase())) return value.trim().toLowerCase();
    if (/^\d{6,}$/.test(value.trim())) return "id";
    return "text";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (isIdKey(key) || value < 0 || !Number.isInteger(value) || Math.abs(value) >= 100_000) return "id";
    return value;
  }
  if (typeof value === "boolean" || value == null) return value;
  return "text";
}

/** Líneas de consola: cuántas listas hay de cada type, y los conteos de cada custom, sin el nombre. */
export function vaultListLines(bodies: readonly unknown[]): string[] {
  const rows = bodies.flatMap(listRows);
  const byType = new Map<string, number>();
  for (const row of rows) {
    const type = text(row.type) || "sin";
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  const types = [...byType.entries()].map(([type, count]) => `type=${type} n=${count}`).join(" ");
  const lines = [`[fanlink:vault] sonda listas ${types}`];
  for (const row of rows) {
    if (text(row.type) !== "custom") continue;
    lines.push(`[fanlink:vault] sonda custom fotos=${countText(row.photosCount)} videos=${countText(row.videosCount)} gifs=${countText(row.gifsCount)} audios=${countText(row.audiosCount)} hasMedia=${row.hasMedia === true ? "si" : row.hasMedia === false ? "no" : "sin"}`);
  }
  return lines;
}

function listRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>).list;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function countText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "sin";
}

export function assertProbeFileSafe(raw: string): void {
  if (/sess=|x-bc|app-token|"sign"\s*:|Policy=|Signature=/i.test(raw)) throw new Error("El sondeo iba a guardar un secreto.");
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
  const listBodies = await readListPages(input, rules, auth, reads);
  for (const line of vaultListLines(listBodies)) input.stdout(line);
  const tally = await readMediaPages(input, rules, auth, "all", "media-all");
  reads.push({ name: "media-all", path: "/api2/v2/vault/media", status: tally.status, body: tally.body });
  input.stdout(`[fanlink:vault] sonda media-all paginas=${tally.pages} medios=${tally.total}`);
  const folderId = reads
    .filter((read) => read.name === "lists" || read.name.startsWith("lists-"))
    .map((read) => firstFolderId(read.body))
    .find((id) => id) ?? null;
  if (folderId) {
    const wrong = `/api2/v2/vault/media?limit=40&offset=0&sort=desc&list=${encodeURIComponent(folderId)}`;
    const listed = await probeGet(input.fetch, wrong, signedHeaders(rules, wrong, auth, input.now()));
    reads.push({ name: "media-list", path: "/api2/v2/vault/media", status: listed.status, body: { n: probeListCount(listed.body) } });
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media list=carpeta status=${listed.status ?? "sin"} n=${probeListCount(listed.body)}`);
    const byId = vaultMediaPath(folderId, 0);
    const ided = await probeGet(input.fetch, byId, signedHeaders(rules, byId, auth, input.now()));
    reads.push({ name: "media-list-id", path: "/api2/v2/vault/media", status: ided.status, body: { n: probeListCount(ided.body), sample: firstMedia(ided.body) } });
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media list_id=carpeta status=${ided.status ?? "sin"} n=${probeListCount(ided.body)}`);
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

const PROBE_LIST_PAGES = 20;

async function readListPages(
  input: { fetch: typeof fetch; now: () => number; stdout: (line: string) => void },
  rules: Awaited<ReturnType<typeof loadSignRules>>,
  auth: { cookie: string; userId: string; xBc: string },
  reads: Array<{ name: string; path: string; status: number | null; body: unknown }>,
): Promise<unknown[]> {
  let offset = 0;
  const bodies: unknown[] = [];
  for (let page = 0; page < PROBE_LIST_PAGES; page += 1) {
    const listsPath = vaultListsPath(offset);
    const lists = await probeGet(input.fetch, listsPath, signedHeaders(rules, listsPath, auth, input.now()));
    reads.push({
      name: page === 0 ? "lists" : `lists-${offset}`,
      path: "/api2/v2/vault/lists",
      status: lists.status,
      body: lists.body,
    });
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/lists offset=${offset} status=${lists.status ?? "sin"}`);
    bodies.push(lists.body);
    const count = probeListCount(lists.body);
    if (!probePageContinues(lists.body, 50)) return bodies;
    const next = offset + (count > 0 ? count : 50);
    if (next <= offset) return bodies;
    offset = next;
  }
  input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/lists corte=paginas tope=${PROBE_LIST_PAGES}`);
  return bodies;
}

/** Sigue si hasMore es true o si la página vino llena. */
export function probePageContinues(body: unknown, pageSize: number): boolean {
  if (probeHasMore(body)) return true;
  return probeListCount(body) >= pageSize;
}

async function readMediaPages(
  input: { fetch: typeof fetch; now: () => number; stdout: (line: string) => void },
  rules: Awaited<ReturnType<typeof loadSignRules>>,
  auth: { cookie: string; userId: string; xBc: string },
  listId: string,
  name: string,
): Promise<{ status: number | null; pages: number; total: number; body: unknown }> {
  let offset = 0;
  let pages = 0;
  let total = 0;
  let status: number | null = null;
  let sample: unknown = null;
  for (let page = 0; page < 40; page += 1) {
    const mediaPath = vaultMediaPath(listId, offset);
    const media = await probeGet(input.fetch, mediaPath, signedHeaders(rules, mediaPath, auth, input.now()));
    status = media.status;
    const count = probeListCount(media.body);
    if (sample == null) sample = firstMedia(media.body);
    pages += 1;
    total += count;
    input.stdout(`[fanlink:vault] sonda ruta=/api2/v2/vault/media nombre=${name} offset=${offset} status=${media.status ?? "sin"} n=${count}`);
    if (!probePageContinues(media.body, 40)) break;
    const next = offset + (count > 0 ? count : 40);
    if (next <= offset) break;
    offset = next;
  }
  return { status, pages, total, body: { pages, total, sample } };
}

function firstMedia(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const list = (body as Record<string, unknown>).list;
  return Array.isArray(list) ? list[0] ?? null : null;
}

function probeHasMore(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const raw = body as Record<string, unknown>;
  return raw.hasMore === true || raw.has_more === true;
}

function probeListCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const list = (body as Record<string, unknown>).list;
  return Array.isArray(list) ? list.length : 0;
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
