import { chatSendGate, type SendAccount } from "../send/gate.ts";
import type { StorageStateFile } from "../sessions/storage-state.ts";
import { awaitAccountGap, REQUEST_GAP_MS } from "./api-list-pace.ts";
import { sessionForApi, signedHeaders, type SignedChatDeps } from "./of-chat-api.ts";
import { loadSignRules } from "./of-sign.ts";

/**
 * Listas de OnlyFans para «Añadir o quitar de listas» del menú del chat. Rutas del catálogo de OF Manager
 * (docs/plans/of-manager-api-catalogue.md, módulo 138255):
 * - GET    /api2/v2/lists?limit&offset&format=infinite   → {list, hasMore}
 * - POST   /api2/v2/lists/{id}/users/{uid}                → añade al fan, sin cuerpo
 * - DELETE /api2/v2/lists/{id}/users/{uid}                → lo quita, sin cuerpo
 * Leer las listas no escribe nada. Añadir y quitar solo salen con FANLINK_ENABLE_SEND y la cuenta en
 * FANLINK_SEND_ALLOW_ACCOUNTS, el mismo gate que el envío.
 */
export const OF_LISTS_PATH = "/api2/v2/lists?limit=100&offset=0&format=infinite";

export type OfList = { id: string; name: string };

export function fanListPath(listId: string, fanId: string): string | null {
  if (!/^\d{1,18}$/.test(listId) || !/^\d{1,18}$/.test(fanId)) return null;
  return `/api2/v2/lists/${listId}/users/${fanId}`;
}

/** Listas que se pueden usar: con id y nombre. Si la fila dice que no admite usuarios, fuera. */
export function parseOfLists(body: unknown): OfList[] {
  const source = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).list : body;
  if (!Array.isArray(source)) return [];
  const out: OfList[] = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id).trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!/^\d{1,18}$/.test(id) || !name || row.canAddUsers === false || row.canAddUser === false) continue;
    out.push({ id, name: name.slice(0, 80) });
  }
  return out;
}

export type FanListsResult = { ok: boolean; reason: string | null; lists: OfList[]; retryAfterMs?: number };
export type FanListWriteResult = { ok: boolean; reason: string | null; wrote: boolean };

async function call(
  state: StorageStateFile,
  deps: SignedChatDeps,
  path: string,
  method: "GET" | "POST" | "DELETE",
): Promise<{ ok: boolean; status: number | null; body: unknown; reason: string | null }> {
  const auth = sessionForApi(state, deps.now());
  if ("reason" in auth) return { ok: false, status: null, body: null, reason: "La sesión de OnlyFans no está lista." };
  const rules = deps.rules ?? await loadSignRules(deps.fetch, deps.now());
  if (deps.accountId && deps.sleep) await awaitAccountGap(deps.accountId, deps.now, deps.sleep, deps.minGapMs ?? REQUEST_GAP_MS);
  const response = await deps.fetch(`https://onlyfans.com${path}`, { method, headers: signedHeaders(rules, path, auth, deps.now()) });
  if (response.status === 401) return { ok: false, status: 401, body: null, reason: "OnlyFans ha rechazado la sesión. Pulsa Reconectar." };
  if (response.status === 400) return { ok: false, status: 400, body: null, reason: "OnlyFans rechazó la firma." };
  if (response.status === 429) return { ok: false, status: 429, body: null, reason: "OnlyFans pide esperar. Inténtalo en unos minutos." };
  if (!response.ok) return { ok: false, status: response.status, body: null, reason: `OnlyFans respondió ${response.status}.` };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: true, status: response.status, body, reason: null };
}

export async function fetchOfLists(state: StorageStateFile, deps: SignedChatDeps): Promise<FanListsResult> {
  const page = await call(state, deps, OF_LISTS_PATH, "GET");
  if (!page.ok) return { ok: false, reason: page.reason, lists: [] };
  const lists = parseOfLists(page.body);
  return { ok: lists.length > 0, reason: lists.length > 0 ? null : "Esta cuenta no tiene listas.", lists };
}

/** Añade o quita al fan de una lista. Sin el gate de envío no llama a OnlyFans. */
export async function writeFanList(input: {
  flag: string | undefined;
  allowlist: string | undefined;
  account: SendAccount;
  state: StorageStateFile;
  deps: SignedChatDeps;
  listId: string;
  fanId: string;
  add: boolean;
}): Promise<FanListWriteResult> {
  const gate = chatSendGate(input.flag, input.allowlist, input.account);
  if (!gate.allowed) return { ok: false, reason: gate.reason, wrote: false };
  const path = fanListPath(input.listId, input.fanId);
  if (!path) return { ok: false, reason: "Esa lista o ese fan no son válidos.", wrote: false };
  const page = await call(input.state, input.deps, path, input.add ? "POST" : "DELETE");
  return { ok: page.ok, reason: page.reason, wrote: page.ok };
}

export type FanListsRequest = { action: "lists" } | { action: "list"; listId: string; add: boolean };

/** Lo único del menú ⋮ que sale a OnlyFans. Descuento, restringir, bloquear y denunciar no tienen ruta confirmada. */
export function normalizeFanListsRequest(value: unknown): FanListsRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.action === "lists") return { action: "lists" };
  if (row.action === "list" && typeof row.listId === "string" && /^\d{1,18}$/.test(row.listId) && typeof row.add === "boolean") {
    return { action: "list", listId: row.listId, add: row.add };
  }
  return null;
}
