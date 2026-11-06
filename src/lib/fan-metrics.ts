export type FanMoney = {
  fanKey: string;
  name: string | null;
  status: "active" | "expired";
  subscribedAt: string | null;
  renewAuto: boolean | null;
  spentCents: number | null;
  lastInteractionAt: string | null;
};

export type FanPurchase = { fanKey: string | null; occurredAt: string; grossCents: number };

export type FanPpv = { fanKey: string | null; priceCents: number | null; purchased: boolean | null };

export type FanProfile = {
  fanKey: string;
  name: string | null;
  ltvCents: number | null;
  spend30Cents: number | null;
  lastPurchaseAt: string | null;
  purchases30: number | null;
  ppvReceived: number | null;
  ppvBought: number | null;
  segments: Array<"whale" | "risk" | "asleep" | "new">;
};

export function fanProfiles(input: {
  now: Date;
  fans: FanMoney[];
  purchases: FanPurchase[];
  ppv: FanPpv[];
  ppvSynced: boolean;
  whaleCents?: number;
}): FanProfile[] {
  const whale = input.whaleCents ?? 10_000;
  return input.fans.map((fan) => {
    const txs = input.purchases.filter((row) => row.fanKey === fan.fanKey);
    const knownSpend = txs.length > 0;
    const ltvFromTx = knownSpend ? txs.reduce((sum, row) => sum + row.grossCents, 0) : null;
    const ltvCents = ltvFromTx ?? fan.spentCents;
    const since = input.now.getTime() - 30 * 86_400_000;
    const recent = txs.filter((row) => Date.parse(row.occurredAt) >= since);
    const priced = input.ppv.filter((row) => row.fanKey === fan.fanKey && row.priceCents != null);
    const segments: FanProfile["segments"] = [];
    if (ltvCents != null && ltvCents >= whale) segments.push("whale");
    if (fan.renewAuto === false || (fan.status === "active" && fan.lastInteractionAt != null && stale(fan.lastInteractionAt, input.now, 14))) {
      segments.push("risk");
    }
    const isNew = fan.subscribedAt != null && Date.parse(fan.subscribedAt) >= input.now.getTime() - 14 * 86_400_000;
    if (fan.status === "active" && !isNew && fan.lastInteractionAt != null && stale(fan.lastInteractionAt, input.now, 30)) {
      segments.push("asleep");
    }
    if (isNew) segments.push("new");
    return {
      fanKey: fan.fanKey,
      name: fan.name,
      ltvCents,
      spend30Cents: knownSpend ? recent.reduce((sum, row) => sum + row.grossCents, 0) : null,
      lastPurchaseAt: txs.map((row) => row.occurredAt).sort().at(-1) ?? null,
      purchases30: knownSpend ? recent.length : null,
      ppvReceived: input.ppvSynced ? priced.length : null,
      ppvBought: input.ppvSynced ? priced.filter((row) => row.purchased === true).length : null,
      segments,
    };
  });
}

export function rankFans(profiles: FanProfile[]): FanProfile[] {
  return [...profiles].sort((left, right) => (right.ltvCents ?? -1) - (left.ltvCents ?? -1));
}

function stale(iso: string | null, now: Date, days: number): boolean {
  if (!iso) return false;
  return Date.parse(iso) < now.getTime() - days * 86_400_000;
}
