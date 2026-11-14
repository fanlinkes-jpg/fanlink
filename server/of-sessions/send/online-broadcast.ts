import { ONLINE_FAN_CAP } from "../../../src/lib/online-fan-row.ts";
import type { SignRules } from "../sync/of-sign.ts";
import { readJsonBody } from "../sync/of-sign.ts";
import { signedHeaders } from "../sync/of-chat-api.ts";
import { withAccountApi } from "../sync/api-list-pace.ts";
import { chatSendGate, sendPace, sendPerMinute, type SendAccount } from "./gate.ts";

export const ONLINE_BROADCAST_FLAG = "FANLINK_ENABLE_ONLINE_BROADCAST";

const batches = new Map<string, { controller: AbortController; creatorId: string; userId: string }>();
const recentSends = new Map<string, number[]>();

export type OnlineSendStatus = "enviado" | "fallido";

export type OnlineSendRow = {
  fanKey: string;
  status: OnlineSendStatus;
  reason: string | null;
};

export type OnlineBroadcastResult = {
  posted: number;
  results: OnlineSendRow[];
  stopped: boolean;
  retryAfter: number | null;
  reason: string | null;
  cap: number;
};

export type OnlineBroadcastInput = {
  env: NodeJS.ProcessEnv;
  account: SendAccount;
  userId: string;
  batchId: string;
  auth: { cookie: string; userId: string; xBc: string };
  rules: SignRules;
  /** fanKeys que pidió el cliente. No se envían si la relectura no los trae. */
  requested: readonly string[];
  /** Lista firmada recién leída. */
  online: ReadonlyArray<{ fanKey: string }>;
  text: string;
  mediaIds: readonly number[];
  priceCents: number | null;
  vaultReason: string | null;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  claim: (fanKey: string) => Promise<"nuevo" | "enviado">;
  finish: (fanKey: string, status: OnlineSendStatus, messageId: string | null, reason: string | null) => Promise<void>;
};

export function clearOnlineBroadcastPace(): void {
  batches.clear();
  recentSends.clear();
}

export function emptyOnlineBroadcast(reason: string): OnlineBroadcastResult {
  return { posted: 0, results: [], stopped: false, retryAfter: null, reason, cap: ONLINE_FAN_CAP };
}

/** El envío a todos tiene su propio flag y el mismo gate que un mensaje suelto. */
export function onlineBroadcastGate(env: NodeJS.ProcessEnv, account: SendAccount): { allowed: boolean; reason: string } {
  if (env[ONLINE_BROADCAST_FLAG] !== "true") return { allowed: false, reason: "Envío a todos desactivado" };
  return chatSendGate(env.FANLINK_ENABLE_SEND, env.FANLINK_SEND_ALLOW_ACCOUNTS, account);
}

export function canSeeOnlineFans(
  access: { role: "owner" | "member"; perms: readonly string[]; creatorIds: readonly string[] },
  creatorId: string,
): boolean {
  switch (access.role) {
    case "owner":
      return true;
    case "member":
      return access.perms.includes("mensajes") && access.creatorIds.includes(creatorId);
    default: {
      const unreachable: never = access.role;
      return unreachable;
    }
  }
}

export function refuseOnlineBroadcast(input: {
  env: NodeJS.ProcessEnv;
  account: SendAccount;
  text: string;
  priceCents: number | null;
  vaultReason: string | null;
}): string | null {
  const gate = onlineBroadcastGate(input.env, input.account);
  if (!gate.allowed) return gate.reason;
  if (!input.text.replace(/\s+/g, " ").trim()) return "Escribe un mensaje.";
  if (input.priceCents != null && input.priceCents > 0 && input.priceCents < 300) return "Mínimo $3 USD o gratis";
  if (input.vaultReason) return input.vaultReason;
  return null;
}

/**
 * Destinatarios: solo quien sigue en la lista firmada, hasta el tope.
 * Un fanKey que el cliente manda y ya no está en línea no sale.
 */
export function onlineRecipients(
  requested: readonly string[],
  online: ReadonlyArray<{ fanKey: string }>,
  cap = ONLINE_FAN_CAP,
): { send: string[]; offline: string[]; capped: boolean } {
  const live = new Set(online.map((fan) => fan.fanKey));
  const send: string[] = [];
  const offline: string[] = [];
  const seen = new Set<string>();
  for (const key of requested) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!live.has(key)) offline.push(key);
    else send.push(key);
  }
  return { send: send.slice(0, cap), offline, capped: send.length > cap };
}

/** OF usa el id del fan en POST /api2/v2/chats/{userId}/messages. No es otro threadKey. */
export function onlineChatId(fanKey: string): string | null {
  return /^[0-9]{1,20}$/.test(fanKey) ? fanKey : null;
}

export function onlineMessagePath(fanKey: string): string {
  return `/api2/v2/chats/${fanKey}/messages`;
}

/**
 * Cuerpo de POST /chats/{userId}/messages del bundle (vuex chats/sendChatMessage).
 * El precio va en dólares. El cuerpo no entra en la firma.
 */
export function onlineMessageBody(input: { text: string; mediaIds: number[]; price: number }): {
  text: string;
  lockedText: false;
  mediaFiles: number[];
  price: number;
  previews: number[];
  rfTag: number[];
  rfGuest: number[];
  rfPartner: number[];
  isForward: false;
} {
  return {
    text: input.text,
    lockedText: false,
    mediaFiles: input.mediaIds,
    price: input.price,
    previews: [],
    rfTag: [],
    rfGuest: [],
    rfPartner: [],
    isForward: false,
  };
}

export function cancelOnlineBroadcast(batchId: string, userId: string, creatorId: string): boolean {
  const live = batches.get(batchId);
  if (!live || live.userId !== userId || live.creatorId !== creatorId) return false;
  live.controller.abort();
  return true;
}

/** Una cola por cuenta, el mismo mutex que pullList, y el ritmo FANLINK_SEND_PER_MINUTE. */
export function sendOnlineBroadcast(input: OnlineBroadcastInput): Promise<OnlineBroadcastResult> {
  const key = input.account.accountId || input.account.creatorId || "cuenta";
  return withAccountApi(key, () => runOnlineBroadcast(input, key));
}

async function runOnlineBroadcast(input: OnlineBroadcastInput, key: string): Promise<OnlineBroadcastResult> {
  const refusal = refuseOnlineBroadcast(input);
  if (refusal) return emptyOnlineBroadcast(refusal);
  const picked = onlineRecipients(input.requested, input.online);
  const results: OnlineSendRow[] = [];
  for (const fanKey of picked.offline) {
    results.push({ fanKey, status: "fallido", reason: "Ya no está en línea" });
  }
  if (picked.send.length === 0) {
    return { ...emptyOnlineBroadcast(picked.offline.length > 0 ? "Ya no está en línea" : "Nadie en línea"), results };
  }
  const controller = new AbortController();
  const creatorId = input.account.creatorId ?? "";
  batches.set(input.batchId, { controller, creatorId, userId: input.userId });
  const text = input.text.replace(/\s+/g, " ").trim();
  const price = input.priceCents != null && input.priceCents > 0 ? input.priceCents / 100 : 0;
  const mediaIds = input.mediaIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  let posted = 0;
  let stopped = false;
  let retryAfter: number | null = null;
  let reason: string | null = picked.capped ? `Tope de ${ONLINE_FAN_CAP}` : null;
  try {
    const pending: string[] = [];
    for (const fanKey of picked.send) {
      if ((await input.claim(fanKey)) === "enviado") {
        results.push({ fanKey, status: "enviado", reason: null });
        continue;
      }
      pending.push(fanKey);
    }
    for (let index = 0; index < pending.length; index += 1) {
      const fanKey = pending[index] ?? "";
      if (controller.signal.aborted) {
        await markRest(input, pending.slice(index), results, "Cancelado");
        reason = "Cancelado";
        break;
      }
      const chatId = onlineChatId(fanKey);
      if (!chatId) {
        await input.finish(fanKey, "fallido", null, "Sin datos");
        results.push({ fanKey, status: "fallido", reason: "Sin datos" });
        continue;
      }
      const perMinute = sendPerMinute(input.env.FANLINK_SEND_PER_MINUTE);
      const decision = sendPace(recentSends.get(key) ?? [], input.now(), perMinute);
      if (decision.waitMs > 0) await input.sleep(decision.waitMs);
      if (controller.signal.aborted) {
        await markRest(input, pending.slice(index), results, "Cancelado");
        reason = "Cancelado";
        break;
      }
      const at = input.now();
      recentSends.set(key, [...decision.recent, at].filter((stamp) => at - stamp < 60_000));
      const path = onlineMessagePath(chatId);
      let response: Response;
      try {
        response = await input.fetch(`https://onlyfans.com${path}`, {
          method: "POST",
          headers: {
            ...signedHeaders(input.rules, path, input.auth, at),
            "content-type": "application/json",
          },
          body: JSON.stringify(onlineMessageBody({ text, mediaIds, price })),
          signal: controller.signal,
        });
      } catch {
        const why = controller.signal.aborted ? "Cancelado" : "No se pudo leer.";
        await input.finish(fanKey, "fallido", null, why);
        results.push({ fanKey, status: "fallido", reason: why });
        if (controller.signal.aborted) {
          await markRest(input, pending.slice(index + 1), results, "Cancelado");
          reason = "Cancelado";
          break;
        }
        continue;
      }
      if (response.status === 429) {
        retryAfter = retryAfterSeconds(response);
        stopped = true;
        await input.finish(fanKey, "fallido", null, "OnlyFans pide esperar.");
        results.push({ fanKey, status: "fallido", reason: "OnlyFans pide esperar." });
        await markRest(input, pending.slice(index + 1), results, "OnlyFans pide esperar.");
        reason = "OnlyFans pide esperar.";
        break;
      }
      if (!response.ok) {
        await input.finish(fanKey, "fallido", null, "No se pudo leer.");
        results.push({ fanKey, status: "fallido", reason: "No se pudo leer." });
        continue;
      }
      const messageId = await messageIdOf(response);
      posted += 1;
      await input.finish(fanKey, "enviado", messageId, null);
      results.push({ fanKey, status: "enviado", reason: null });
    }
  } finally {
    batches.delete(input.batchId);
  }
  const failed = results.some((row) => row.status === "fallido");
  return {
    posted,
    results,
    stopped,
    retryAfter,
    reason: reason ?? (failed ? "Hay fans que no recibieron el mensaje." : null),
    cap: ONLINE_FAN_CAP,
  };
}

async function markRest(input: OnlineBroadcastInput, fanKeys: readonly string[], results: OnlineSendRow[], why: string): Promise<void> {
  for (const fanKey of fanKeys) {
    await input.finish(fanKey, "fallido", null, why);
    results.push({ fanKey, status: "fallido", reason: why });
  }
}

async function messageIdOf(response: Response): Promise<string | null> {
  try {
    const body = await readJsonBody(response);
    if (!body || typeof body !== "object") return null;
    const id = (body as Record<string, unknown>).id;
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
    if (typeof id === "string" && id.trim()) return id.trim().slice(0, 40);
    return null;
  } catch {
    return null;
  }
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds);
}
