export type ChatFanCard = {
  creatorId: string;
  fanKey: string;
  status: "active" | "expired";
  subscribedAt: string | null;
  expiresAt: string | null;
  renewAuto: boolean | null;
  spentCents: number | null;
  tips: Array<{ occurredAt: string; amountCents: number }>;
  purchases: Array<{ occurredAt: string; amountCents: number }>;
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

/** Ficha de cada fan de las cuentas del chat. No copia ingresos ni neto de la agencia. */
export function chatFanCardsFrom(reads: ChatFanRead[], allowedCreatorIds: readonly string[]): ChatFanCard[] {
  const allowed = new Set(allowedCreatorIds);
  return reads.flatMap((read) => {
    if (!allowed.has(read.creatorId)) return [];
    return read.fans.map((fan) => {
      const rows = (read.transactions ?? []).filter((row) => row.fanKey === fan.fanKey);
      return {
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
        purchases: rows
          .filter((row) => row.kind === "message" || row.kind === "post")
          .map((row) => ({ occurredAt: row.occurredAt, amountCents: row.grossCents })),
      };
    });
  });
}

export function chatFanCardFor(cards: readonly ChatFanCard[], creatorId: string, fanKey: string | null): ChatFanCard | null {
  if (!fanKey) return null;
  return cards.find((card) => card.creatorId === creatorId && card.fanKey === fanKey) ?? null;
}
