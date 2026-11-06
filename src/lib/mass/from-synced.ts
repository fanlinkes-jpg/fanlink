import { fanProfiles } from "../fan-metrics.ts";
import type { MassFan, MassHistoryMessage, MassSnapshot } from "./types.ts";

export type SyncedFanRow = {
  fanKey: string;
  name: string | null;
  handle: string | null;
  status: "active" | "expired";
  spentCents: number | null;
  subscribedAt: string | null;
  renewAuto: boolean | null;
};

export type SyncedMessageRow = {
  fanKey: string | null;
  fromFan: boolean;
  sentAt: string;
  priceCents: number | null;
  purchased: boolean | null;
};

export type SyncedPurchaseRow = {
  fanKey: string | null;
  occurredAt: string;
  grossCents: number;
};

/**
 * Arma el snapshot con lo que el CRM ya guardó.
 * Las listas de OnlyFans, el uso de envío y qué medio iba en cada mensaje no están en ese sync: quedan en null.
 */
export function snapshotFromSynced(input: {
  accountId: string;
  fans: SyncedFanRow[] | null;
  messages: SyncedMessageRow[] | null;
  purchases: SyncedPurchaseRow[] | null;
  now: Date;
}): MassSnapshot {
  return {
    accountId: input.accountId,
    fans:
      input.fans == null
        ? null
        : fansFrom(input.fans, input.messages, input.purchases, input.now),
    messages: input.messages == null ? null : input.messages.map(messageFrom),
    ofLists: null,
    contentEvents: null,
    vaultIds: null,
    sendUsage: null,
  };
}

function fansFrom(
  fans: SyncedFanRow[],
  messages: SyncedMessageRow[] | null,
  purchases: SyncedPurchaseRow[] | null,
  now: Date,
): MassFan[] {
  const profiles =
    purchases == null
      ? null
      : fanProfiles({
          now,
          fans: fans.map((fan) => ({
            fanKey: fan.fanKey,
            name: fan.name,
            status: fan.status,
            subscribedAt: fan.subscribedAt,
            renewAuto: fan.renewAuto,
            spentCents: fan.spentCents,
            lastInteractionAt: null,
          })),
          purchases,
          ppv: [],
          ppvSynced: false,
        });
  const byKey = new Map(
    (profiles ?? []).map((profile) => [profile.fanKey, profile]),
  );
  return fans.map((fan) => ({
    fanKey: fan.fanKey,
    name: fan.name,
    handle: fan.handle,
    status: fan.status,
    spentCents: fan.spentCents,
    spend30Cents: byKey.get(fan.fanKey)?.spend30Cents ?? null,
    lastActiveAt: messages == null ? null : lastFromFan(messages, fan.fanKey),
    lastPurchaseAt: byKey.get(fan.fanKey)?.lastPurchaseAt ?? null,
  }));
}

function messageFrom(row: SyncedMessageRow): MassHistoryMessage {
  return {
    fanKey: row.fanKey,
    fromFan: row.fromFan,
    sentAt: row.sentAt,
    priceCents: row.priceCents,
    purchased: row.purchased,
  };
}

function lastFromFan(
  messages: SyncedMessageRow[],
  fanKey: string,
): string | null {
  let best: number | null = null;
  let iso: string | null = null;
  for (const message of messages) {
    if (message.fanKey !== fanKey || !message.fromFan) continue;
    const time = Date.parse(message.sentAt);
    if (!Number.isFinite(time)) continue;
    if (best == null || time > best) {
      best = time;
      iso = message.sentAt;
    }
  }
  return iso;
}
