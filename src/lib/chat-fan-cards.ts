export type ChatFanCard = {
  creatorId: string;
  fanKey: string;
  status: "active" | "expired";
  subscribedAt: string | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  spentCents: number | null;
  tips: Array<{ occurredAt: string; amountCents: number }>;
  purchases: Array<{ occurredAt: string; amountCents: number; kind: "message" | "post" }>;
};

type FanSource = {
  fanKey: string;
  status: "active" | "expired";
  subscribedAt: string | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  spentCents: number | null;
};

type TxSource = {
  fanKey: string | null;
  occurredAt: string;
  grossCents: number;
  kind: string;
};

export type ChatFanRead = {
  creatorId: string;
  fans: FanSource[];
  transactions?: TxSource[] | null;
};

export type ChatFanThread = { creatorId: string; fanKey: string };

/** Hilos de la bandeja que tienen fan. Sin repetir la misma cuenta y el mismo fan. */
export function fanThreadsForCards(threads: ReadonlyArray<{ creatorId: string; fanKey: string | null }>): ChatFanThread[] {
  const seen = new Set<string>();
  const out: ChatFanThread[] = [];
  for (const thread of threads) {
    if (!thread.fanKey) continue;
    const id = `${thread.creatorId}\u001f${thread.fanKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ creatorId: thread.creatorId, fanKey: thread.fanKey });
  }
  return out;
}

/** Ficha de cada fan pedido. Sin lista, no devuelve a nadie. No copia ingresos ni neto de la agencia. */
export function chatFanCardsFrom(
  reads: ChatFanRead[],
  allowedCreatorIds: readonly string[],
  threads?: readonly ChatFanThread[],
): ChatFanCard[] {
  const allowed = new Set(allowedCreatorIds);
  const wanted = threads ? new Set(threads.map((thread) => `${thread.creatorId}\u001f${thread.fanKey}`)) : null;
  if (wanted && wanted.size === 0) return [];
  return reads.flatMap((read) => {
    if (!allowed.has(read.creatorId)) return [];
    return read.fans.flatMap((fan) => {
      if (wanted && !wanted.has(`${read.creatorId}\u001f${fan.fanKey}`)) return [];
      const rows = (read.transactions ?? []).filter((row) => row.fanKey === fan.fanKey);
      return [{
        creatorId: read.creatorId,
        fanKey: fan.fanKey,
        status: fan.status,
        subscribedAt: fan.subscribedAt,
        expiresAt: fan.expiresAt,
        renewAuto: fan.renewAuto,
        spentCents: fan.spentCents,
        tips: rows
          .filter((row) => row.kind === "tip")
          .map((row) => ({ occurredAt: row.occurredAt, amountCents: row.grossCents })),
        purchases: rows.flatMap((row) => {
          if (row.kind !== "message" && row.kind !== "post") return [];
          return [{ occurredAt: row.occurredAt, amountCents: row.grossCents, kind: row.kind }];
        }),
      }];
    });
  });
}

export function fanCardTransactions(card: ChatFanCard | null): Array<{ occurredAt: string; grossCents: number; kind: string }> {
  if (!card) return [];
  return [
    ...card.tips.map((tip) => ({ occurredAt: tip.occurredAt, grossCents: tip.amountCents, kind: "tip" })),
    ...card.purchases.map((purchase) => ({ occurredAt: purchase.occurredAt, grossCents: purchase.amountCents, kind: purchase.kind })),
  ];
}

export function chatFanCardFor(cards: readonly ChatFanCard[], creatorId: string, fanKey: string | null): ChatFanCard | null {
  if (!fanKey) return null;
  return cards.find((card) => card.creatorId === creatorId && card.fanKey === fanKey) ?? null;
}
