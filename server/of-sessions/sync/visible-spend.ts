import { awaitAccountGap, REQUEST_GAP_MS } from "./api-list-pace.ts";
import { collectFanSpend } from "./fan-spend.ts";
import { signedHeaders } from "./of-chat-api.ts";
import type { SignRules } from "./of-sign.ts";
import type { ReadSql } from "./store.ts";

export type VisibleSpendResult = {
  byFan: Record<string, number | null>;
  /** Milisegundos hasta reintentar. 0 si no hay que esperar. */
  retryAfterMs: number;
  /** Pausa o sesión rechazada: no se llamó a OnlyFans. */
  blocked: boolean;
};

/** Leer el gasto no es escribir. Dueña o permiso de mensajes. */
export function canReadFanSpend(role: string, perms: readonly string[]): boolean {
  return role === "owner" || perms.includes("mensajes");
}

/** Sesión rechazada o identidad que no coincide. La pausa se mira aparte. */
export function spendReadsBlocked(account: { sessionRejected: boolean; identityState: string }): boolean {
  return account.sessionRejected || account.identityState === "mismatch";
}

/** No llama a OnlyFans. La pausa dice cuánto falta; la sesión rechazada no reintenta sola. */
export function blockedVisibleSpend(pauseUntil: number | null, readsBlocked: boolean, now: number): VisibleSpendResult | null {
  if (pauseUntil == null && !readsBlocked) return null;
  return {
    byFan: {},
    retryAfterMs: pauseUntil == null ? 0 : Math.max(1_000, pauseUntil - now),
    blocked: true,
  };
}

export async function runVisibleFanSpend(input: {
  accountId: string;
  creatorId: string;
  fanIds: readonly string[];
  cardIds?: readonly string[];
  auth: { cookie: string; userId: string; xBc: string };
  rules: SignRules;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sql: ReadSql;
  log?: (line: string) => void;
  onSessionRejected?: () => Promise<void> | void;
  onBlock?: (reason: "400" | "429") => void;
}): Promise<VisibleSpendResult> {
  const fanIds = [...new Set(input.fanIds.filter((id) => /^\d{1,20}$/.test(id)))].slice(0, 10);
  const cardIds = new Set((input.cardIds ?? []).filter((id) => /^\d{1,20}$/.test(id)));
  const result = await collectFanSpend({
    accountId: input.accountId,
    creatorId: input.creatorId,
    threads: fanIds.map((id) => ({ fanKey: id, spentCents: null })),
    visibleIds: fanIds,
    cardIds,
    now: input.now(),
    log: input.log,
    request: async (path) => {
      await awaitAccountGap(input.accountId, input.now, input.sleep, REQUEST_GAP_MS);
      const response = await input.fetch(`https://onlyfans.com${path}`, {
        method: "GET",
        headers: signedHeaders(input.rules, path, input.auth, input.now()),
      });
      const retryHeader = response.headers.get("retry-after");
      let body: unknown = null;
      if (response.ok) body = await response.json().catch(() => null);
      else await response.body?.cancel().catch(() => undefined);
      return {
        ok: response.ok,
        status: response.status,
        body,
        retryAfterMs: response.status === 429 ? retryHeaderMs(retryHeader) : 0,
        sessionRejected: response.status === 401,
      };
    },
  });
  if (result.stopped?.sessionRejected) await input.onSessionRejected?.();
  if (result.stopped && result.stopped.retryAfterMs > 0) input.onBlock?.("429");
  if (result.stopped?.status === 400) input.onBlock?.("400");
  const stoppedEarly = result.stopped != null && (result.stopped.sessionRejected || result.stopped.retryAfterMs > 0 || result.stopped.status === 400);
  const byFan: Record<string, number | null> = {};
  for (const id of fanIds) {
    if (!result.byFan.has(id)) {
      if (!stoppedEarly) byFan[id] = null;
      continue;
    }
    const cents = result.byFan.get(id);
    if (cents == null) {
      if (!stoppedEarly) byFan[id] = null;
      continue;
    }
    byFan[id] = cents;
    await input.sql.query(
      "update of_chat_thread set spent_cents = $3 where creator_id = $1 and fan_key = $2 and spent_cents is null",
      [input.creatorId, id, cents],
    );
  }
  return {
    byFan,
    retryAfterMs: result.stopped?.retryAfterMs ?? 0,
    blocked: false,
  };
}

function retryHeaderMs(header: string | null): number {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return 15_000;
}
