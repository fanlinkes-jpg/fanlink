import { spendAmount, spendTierFor, type SpendWindow } from "../spend-tiers.ts";
import type {
  ContentEvent,
  MassFan,
  MassSegment,
  MassSnapshot,
  OfList,
  SinDatos,
} from "./types.ts";
import { SIN_DATOS } from "./types.ts";

export type SegmentResolution = {
  matched: MassFan[];
  excluded: Array<{ fanKey: string; reason: string }>;
  skippedMissing: Array<{ fanKey: string; field: string }>;
  warnings: string[];
  audience: number | SinDatos;
  blockers: string[];
};

const DAY_MS = 86_400_000;

export function resolveSegment(
  snapshot: MassSnapshot,
  segment: MassSegment,
  options: {
    now: Date;
    vaultIds: string[];
    rotate: boolean;
    excludeBought: boolean;
  },
): SegmentResolution {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (snapshot.fans == null) {
    return empty(SIN_DATOS, ["Sin datos: fans"]);
  }
  const needsLists = Boolean(
    segment.ofListIds?.length || segment.excludeOfListIds?.length,
  );
  if (needsLists && snapshot.ofLists == null) {
    return empty(SIN_DATOS, ["Sin datos: listas de OnlyFans"]);
  }

  let pool = [...snapshot.fans];
  const skipped: Array<{ fanKey: string; field: string }> = [];
  let droppedByValue = 0;

  if (segment.ofListIds?.length && snapshot.ofLists) {
    const listed = membersOf(snapshot.ofLists, segment.ofListIds);
    for (const id of listed.missingIds)
      warnings.push(`Lista no sincronizada: ${id}`);
    const step = split(pool, (fan) => listed.keys.has(fan.fanKey));
    pool = step.keep;
    droppedByValue += step.drop;
  }

  if (segment.includeFanKeys?.length) {
    const wanted = new Set(segment.includeFanKeys);
    const step = split(pool, (fan) => wanted.has(fan.fanKey));
    pool = step.keep;
    droppedByValue += step.drop;
  }

  if (segment.spendTiers?.length) {
    const window: SpendWindow = segment.spendWindow ?? "lifetime";
    const wanted = new Set(segment.spendTiers);
    const keep: MassFan[] = [];
    for (const fan of pool) {
      const amount = spendAmount(fan, window);
      const tier = spendTierFor(amount);
      if (tier == null)
        skipped.push({
          fanKey: fan.fanKey,
          field: window === "spend30" ? "gasto30" : "gasto",
        });
      else if (wanted.has(tier)) keep.push(fan);
      else droppedByValue += 1;
    }
    pool = keep;
  }

  if (segment.subscription) {
    const keep: MassFan[] = [];
    for (const fan of pool) {
      const matches = subscriptionMatches(fan.status, segment.subscription);
      if (matches == null)
        skipped.push({ fanKey: fan.fanKey, field: "suscripcion" });
      else if (matches) keep.push(fan);
      else droppedByValue += 1;
    }
    pool = keep;
  }

  if (segment.activeWithinDays != null) {
    const since = options.now.getTime() - segment.activeWithinDays * DAY_MS;
    const keep: MassFan[] = [];
    for (const fan of pool) {
      const at = activityAt(fan, snapshot.messages);
      if (at === "missing")
        skipped.push({ fanKey: fan.fanKey, field: "actividad" });
      else if (at !== "none" && Date.parse(at) >= since) keep.push(fan);
      else droppedByValue += 1;
    }
    pool = keep;
  }

  if (segment.purchasedWithinDays != null) {
    const since = options.now.getTime() - segment.purchasedWithinDays * DAY_MS;
    const keep: MassFan[] = [];
    for (const fan of pool) {
      const at = purchaseAt(fan, snapshot.messages);
      if (at === "missing")
        skipped.push({ fanKey: fan.fanKey, field: "ultima_compra" });
      else if (at !== "none" && Date.parse(at) >= since) keep.push(fan);
      else droppedByValue += 1;
    }
    pool = keep;
  }

  const excluded: Array<{ fanKey: string; reason: string }> = [];
  const bannedFans = new Set(segment.excludeFanKeys ?? []);
  const bannedLists =
    segment.excludeOfListIds?.length && snapshot.ofLists
      ? membersOf(snapshot.ofLists, segment.excludeOfListIds).keys
      : new Set<string>();
  const needsContent =
    options.vaultIds.length > 0 && (options.rotate || options.excludeBought);
  if (needsContent && snapshot.contentEvents == null)
    blockers.push("Sin datos: historial de contenido");
  const bought =
    blockers.length === 0 && options.excludeBought
      ? fansWith(snapshot.contentEvents, options.vaultIds, "comprado")
      : new Set<string>();
  const received =
    blockers.length === 0 && options.rotate
      ? fansWith(snapshot.contentEvents, options.vaultIds, "recibido")
      : new Set<string>();
  const keep: MassFan[] = [];
  for (const fan of pool) {
    const reason = exclusion(
      fan.fanKey,
      bannedFans,
      bannedLists,
      bought,
      received,
    );
    if (reason) excluded.push({ fanKey: fan.fanKey, reason });
    else keep.push(fan);
  }
  pool = keep;

  const audience = audienceOf(
    pool.length,
    droppedByValue,
    skipped.length,
    blockers,
  );
  return {
    matched: pool,
    excluded,
    skippedMissing: skipped,
    warnings,
    audience,
    blockers: unique(blockers),
  };
}

function audienceOf(
  matched: number,
  droppedByValue: number,
  skipped: number,
  blockers: string[],
): number | SinDatos {
  if (
    blockers.some(
      (item) =>
        item === "Sin datos: fans" || item.startsWith("Sin datos: listas"),
    )
  )
    return SIN_DATOS;
  if (matched === 0 && droppedByValue === 0 && skipped > 0) return SIN_DATOS;
  if (blockers.length > 0 && matched === 0 && droppedByValue === 0)
    return SIN_DATOS;
  return matched;
}

function empty(audience: SinDatos, blockers: string[]): SegmentResolution {
  return {
    matched: [],
    excluded: [],
    skippedMissing: [],
    warnings: [],
    audience,
    blockers,
  };
}

function split(
  pool: MassFan[],
  keepFan: (fan: MassFan) => boolean,
): { keep: MassFan[]; drop: number } {
  const keep: MassFan[] = [];
  let drop = 0;
  for (const fan of pool) {
    if (keepFan(fan)) keep.push(fan);
    else drop += 1;
  }
  return { keep, drop };
}

function membersOf(
  lists: readonly OfList[],
  ids: readonly string[],
): { keys: Set<string>; missingIds: string[] } {
  const wanted = new Set(ids);
  const keys = new Set<string>();
  const found = new Set<string>();
  for (const list of lists) {
    if (!wanted.has(list.id)) continue;
    found.add(list.id);
    for (const fanKey of list.fanKeys) keys.add(fanKey);
  }
  return { keys, missingIds: ids.filter((id) => !found.has(id)) };
}

function subscriptionMatches(
  status: MassFan["status"],
  filter: "activa" | "caducada",
): boolean | null {
  if (status == null) return null;
  switch (filter) {
    case "activa":
      return status === "active";
    case "caducada":
      return status === "expired";
    default: {
      const exhaustive: never = filter;
      throw new Error(`Suscripción no cubierta: ${String(exhaustive)}`);
    }
  }
}

function activityAt(
  fan: MassFan,
  messages: MassSnapshot["messages"],
): string | "none" | "missing" {
  if (fan.lastActiveAt) return fan.lastActiveAt;
  if (messages == null) return "missing";
  return latest(messages, fan.fanKey, (message) => message.fromFan) ?? "none";
}

function purchaseAt(
  fan: MassFan,
  messages: MassSnapshot["messages"],
): string | "none" | "missing" {
  if (fan.lastPurchaseAt) return fan.lastPurchaseAt;
  if (messages == null) return "missing";
  const at = latest(
    messages,
    fan.fanKey,
    (message) => message.purchased === true,
  );
  if (at) return at;
  if (
    messages.some(
      (message) =>
        message.fanKey === fan.fanKey &&
        message.purchased == null &&
        message.priceCents != null,
    )
  ) {
    return "missing";
  }
  return "none";
}

function latest(
  messages: NonNullable<MassSnapshot["messages"]>,
  fanKey: string,
  include: (message: NonNullable<MassSnapshot["messages"]>[number]) => boolean,
): string | null {
  let best: number | null = null;
  let iso: string | null = null;
  for (const message of messages) {
    if (message.fanKey !== fanKey || !include(message)) continue;
    const time = Date.parse(message.sentAt);
    if (!Number.isFinite(time)) continue;
    if (best == null || time > best) {
      best = time;
      iso = message.sentAt;
    }
  }
  return iso;
}

function fansWith(
  events: readonly ContentEvent[] | null,
  vaultIds: readonly string[],
  kind: ContentEvent["kind"],
): Set<string> {
  const wanted = new Set(vaultIds);
  const fans = new Set<string>();
  for (const event of events ?? []) {
    if (event.kind === kind && wanted.has(event.vaultId))
      fans.add(event.fanKey);
  }
  return fans;
}

function exclusion(
  fanKey: string,
  bannedFans: ReadonlySet<string>,
  bannedLists: ReadonlySet<string>,
  bought: ReadonlySet<string>,
  received: ReadonlySet<string>,
): string | null {
  if (bannedFans.has(fanKey)) return "Excluido manualmente";
  if (bannedLists.has(fanKey)) return "Lista excluida";
  if (bought.has(fanKey)) return "Ya compró este contenido";
  if (received.has(fanKey)) return "Rotación: ya recibió este contenido";
  return null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
