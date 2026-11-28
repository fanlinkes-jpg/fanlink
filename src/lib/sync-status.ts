/**
 * Estado de cada fuente de una creadora, por separado: chats, ingresos y fans.
 * Que los chats funcionen no quiere decir que haya ingresos. Una fuente sin dato
 * dice «Sin datos» o «Sin sincronizar» y por qué; nunca un 0 inventado.
 */
export type SourceState = "ok" | "error" | "none" | "blocked";

export type SourceStatus = {
  state: SourceState;
  /** Última lectura buena. Puede existir aunque la última vuelta haya fallado. */
  at: string | null;
  /** Texto corto para la persona. Null si todo va bien. */
  reason: string | null;
  /** De dónde sale la cifra si no es la lectura directa de OnlyFans. */
  fallback: "notificaciones" | "chats" | null;
};

export type SyncStatusInput = {
  earningsSyncedAt: string | null;
  fansSyncedAt: string | null;
  chatSyncedAt?: string | null;
  chatStatus?: "idle" | "ok" | "error" | null;
  chatReason?: string | null;
  lastStatus: "idle" | "ok" | "error" | null;
  lastReason: string | null;
  /** Null si no se sabe (el navegador no conoce la allowlist). */
  readAllowed?: boolean | null;
  /** Hay filas guardadas que sustituyen a la lectura directa. */
  earningsFallback?: "notificaciones" | null;
  fansFallback?: "chats" | null;
};

export type CreatorSyncStatus = { chats: SourceStatus; earnings: SourceStatus; fans: SourceStatus };

const NOT_ALLOWED = "Lectura no autorizada para esta cuenta (FANLINK_READ_ALLOW_ACCOUNTS)";

/** Texto corto y sin rutas ni datos sensibles. */
export function shortSyncReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const cut = reason.split(". json:")[0]?.split(" | json:")[0] ?? reason;
  const text = cut.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/redirigido a login|pidi[óo] login/i.test(text)) return "Sesión caducada: pulsa Reconectar";
  return text.slice(0, 160);
}

/** La parte de la razón que habla de una sección: «página cambiada (ingresos)», «sin datos todavía (fans)». */
function partFor(reason: string | null, label: "ingresos" | "fans"): string | null {
  if (!reason) return null;
  const parts = reason.split(/\.\s+/).map((part) => part.trim()).filter(Boolean);
  const own = parts.filter((part) => part.toLowerCase().includes(`(${label})`));
  if (own.length > 0) return own.join(". ");
  const other = label === "ingresos" ? "fans" : "ingresos";
  const generic = parts.filter((part) => !part.toLowerCase().includes(`(${other})`));
  return generic.length > 0 ? generic.join(". ") : null;
}

function sourceOf(at: string | null, failed: boolean, reason: string | null, allowed: boolean | null | undefined, fallback: SourceStatus["fallback"]): SourceStatus {
  if (failed) return { state: "error", at, reason: shortSyncReason(reason) ?? "La última lectura falló", fallback };
  if (at) return { state: "ok", at, reason: null, fallback: null };
  if (fallback) return { state: "ok", at: null, reason: null, fallback };
  if (allowed === false) return { state: "blocked", at: null, reason: NOT_ALLOWED, fallback: null };
  return { state: "none", at: null, reason: null, fallback: null };
}

export function syncStatusOf(input: SyncStatusInput): CreatorSyncStatus {
  const failed = input.lastStatus === "error";
  const chatFailed = input.chatStatus === "error";
  const earningsPart = failed ? partFor(input.lastReason, "ingresos") : null;
  const fansPart = failed ? partFor(input.lastReason, "fans") : null;
  const fans: SourceStatus = sourceOf(input.fansSyncedAt, failed && fansPart != null, fansPart, input.readAllowed, null);
  const fansFinal: SourceStatus = fans.state === "ok" || !input.fansFallback
    ? fans
    : { state: "ok", at: null, reason: fans.state === "error" ? fans.reason : null, fallback: input.fansFallback };
  const earnings: SourceStatus = sourceOf(input.earningsSyncedAt, failed && earningsPart != null, earningsPart, input.readAllowed, null);
  const earningsFinal: SourceStatus = earnings.state === "ok" || !input.earningsFallback
    ? earnings
    : { state: "ok", at: null, reason: earnings.state === "error" ? earnings.reason : null, fallback: input.earningsFallback };
  return {
    chats: sourceOf(input.chatSyncedAt ?? null, chatFailed, input.chatReason ?? null, null, null),
    earnings: earningsFinal,
    fans: fansFinal,
  };
}

/** Línea de una fuente para tablas: «hace 5 min», «Sin sincronizar», «Error · motivo». */
export function sourceLabel(source: SourceStatus, now = Date.now()): string {
  const age = source.at ? ageText(source.at, now) : null;
  if (source.state === "error") return `Error · ${source.reason ?? "la última lectura falló"}${age ? ` (último dato ${age})` : ""}`;
  if (source.state === "blocked") return source.reason ?? NOT_ALLOWED;
  if (source.state === "none") return "Sin sincronizar";
  if (source.fallback === "notificaciones") return `Parcial · desde notificaciones de compra${age ? `, ${age}` : ""}`;
  if (source.fallback === "chats") return `Desde los chats${age ? `, ${age}` : ""}`;
  return age ?? "OK";
}

function ageText(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "sin fecha";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "hace menos de 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}
