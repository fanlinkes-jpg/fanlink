import type { SignRules } from "../sync/of-sign.ts";
import { signedHeaders } from "../sync/of-chat-api.ts";
import { chatSendGate, type SendAccount } from "./gate.ts";

export const ONLINE_SEND_GAP_MS = 300;

const tails = new Map<string, Promise<void>>();
const lastSentAt = new Map<string, number>();

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
};

export type OnlineBroadcastInput = {
  env: NodeJS.ProcessEnv;
  account: SendAccount;
  auth: { cookie: string; userId: string; xBc: string };
  rules: SignRules;
  fans: ReadonlyArray<{ fanKey: string }>;
  text: string;
  mediaIds: readonly number[];
  priceCents: number | null;
  vaultReason: string | null;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export function clearOnlineBroadcastPace(): void {
  tails.clear();
  lastSentAt.clear();
}

export function emptyOnlineBroadcast(reason: string): OnlineBroadcastResult {
  return { posted: 0, results: [], stopped: false, retryAfter: null, reason };
}

/** El envío a todos exige el flag masivo y el mismo gate que un mensaje suelto. */
export function onlineBroadcastGate(env: NodeJS.ProcessEnv, account: SendAccount): { allowed: boolean; reason: string } {
  if (env.FANLINK_ENABLE_MASS_SEND !== "true") return { allowed: false, reason: "Envío a todos desactivado" };
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

/** Motivo para no hacer ningún POST. Null si se puede seguir. */
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

/** POST /api2/v2/chats/{id}/messages, el mismo que reconoce isMessageWrite. */
export function onlineMessagePath(fanKey: string): string {
  return `/api2/v2/chats/${fanKey}/messages`;
}

/** Cuerpo del bundle web: texto, piezas y precio. El precio va en dólares. */
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

/** Una cola por cuenta. Como mucho un POST en vuelo y 300 ms entre arranques. */
export function sendOnlineBroadcast(input: OnlineBroadcastInput): Promise<OnlineBroadcastResult> {
  const key = input.account.accountId || input.account.creatorId || "cuenta";
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(() => runOnlineBroadcast(input, key));
  tails.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function runOnlineBroadcast(input: OnlineBroadcastInput, key: string): Promise<OnlineBroadcastResult> {
  const refusal = refuseOnlineBroadcast(input);
  if (refusal) return emptyOnlineBroadcast(refusal);
  const fans = input.fans.slice(0, 100);
  if (fans.length === 0) return emptyOnlineBroadcast("Nadie en línea");
  const text = input.text.replace(/\s+/g, " ").trim();
  const price = input.priceCents != null && input.priceCents > 0 ? input.priceCents / 100 : 0;
  const mediaIds = input.mediaIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  const results: OnlineSendRow[] = [];
  let posted = 0;
  for (const fan of fans) {
    if (!/^[0-9]{1,20}$/.test(fan.fanKey)) {
      results.push({ fanKey: fan.fanKey, status: "fallido", reason: "Sin datos" });
      continue;
    }
    const previousAt = lastSentAt.get(key);
    const wait = previousAt == null ? 0 : Math.max(0, ONLINE_SEND_GAP_MS - (input.now() - previousAt));
    if (wait > 0) await input.sleep(wait);
    const at = input.now();
    lastSentAt.set(key, at);
    const path = onlineMessagePath(fan.fanKey);
    let response: Response;
    try {
      response = await input.fetch(`https://onlyfans.com${path}`, {
        method: "POST",
        headers: {
          ...signedHeaders(input.rules, path, input.auth, at),
          "content-type": "application/json",
        },
        body: JSON.stringify(onlineMessageBody({ text, mediaIds, price })),
      });
    } catch {
      results.push({ fanKey: fan.fanKey, status: "fallido", reason: "No se pudo leer." });
      continue;
    }
    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response);
      results.push({ fanKey: fan.fanKey, status: "fallido", reason: "OnlyFans pide esperar." });
      return { posted, results, stopped: true, retryAfter, reason: "OnlyFans pide esperar." };
    }
    if (!response.ok) {
      results.push({ fanKey: fan.fanKey, status: "fallido", reason: "No se pudo leer." });
      continue;
    }
    posted += 1;
    results.push({ fanKey: fan.fanKey, status: "enviado", reason: null });
  }
  const failed = results.some((row) => row.status === "fallido");
  return {
    posted,
    results,
    stopped: false,
    retryAfter: null,
    reason: failed ? "Hay fans que no recibieron el mensaje." : null,
  };
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds);
}
