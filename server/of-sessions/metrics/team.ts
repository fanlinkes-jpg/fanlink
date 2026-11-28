export type SaleKind = "ppv" | "mass" | "tip" | "subscription" | "renewal" | "message" | "post" | "stream" | "referral";

export type TeamSale = {
  /** Clave estable de la venta. Sin ella se deriva de creadora, fan, fecha y tipo. */
  key?: string;
  creatorId: string;
  fanKey: string | null;
  at: string;
  grossCents: number;
  kind: SaleKind;
  /** Solo PPV: clave del mensaje que se compró. */
  messageKey?: string | null;
};

export type TeamMessage = {
  /** Clave del mensaje en el hilo. */
  key?: string;
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  at: string;
  fromFan: boolean;
  priceCents: number | null;
  purchased: boolean | null;
  /** Autor en el CRM. Null si OnlyFans no dice quién escribió. */
  authorId: string | null;
  authorName?: string | null;
  /** Masivo del que salió el mensaje. */
  massId?: string | null;
};

/** Quién lanzó cada masivo. */
export type MassLaunch = { massId: string; userId: string | null; name: string | null };

export type AttributionRule = "sender" | "mass" | "last_chatter" | "none";

export type Attribution = {
  saleKey: string;
  creatorId: string;
  fanKey: string | null;
  kind: SaleKind;
  at: string;
  grossCents: number;
  chatterId: string | null;
  chatterName: string | null;
  rule: AttributionRule;
};

export type ChatterReport = {
  userId: string;
  grossCents: number | null;
  ppvSent: number | null;
  ppvBought: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
};

export function saleKeyOf(sale: TeamSale): string {
  return sale.key ?? `${sale.kind}:${sale.creatorId}:${sale.fanKey ?? "-"}:${sale.at}:${sale.grossCents}`;
}

/**
 * Atribución de ventas:
 * - Un PPV o una venta es de quien envió el mensaje.
 * - Un masivo es de quien lo lanzó.
 * - Propinas y suscripciones son del último chatter que habló con el fan antes de la venta.
 * - Un mensaje sin chatter no atribuye nada: la venta queda sin nombre (se sabe que es de la creadora).
 */
export function attributeSales(input: { messages: TeamMessage[]; sales: TeamSale[]; launches?: MassLaunch[] }): Attribution[] {
  const launches = new Map((input.launches ?? []).map((launch) => [launch.massId, launch]));
  const names = new Map<string, string>();
  for (const message of input.messages) if (message.authorId && message.authorName) names.set(message.authorId, message.authorName);
  return input.sales.map((sale) => {
    const base = { saleKey: saleKeyOf(sale), creatorId: sale.creatorId, fanKey: sale.fanKey, at: sale.at, grossCents: sale.grossCents };
    if (sale.kind === "ppv" || sale.kind === "mass") {
      const sold = soldMessage(sale, input.messages);
      if (sold?.massId) {
        const launch = launches.get(sold.massId);
        if (launch?.userId) return { ...base, kind: "mass" as const, chatterId: launch.userId, chatterName: launch.name ?? names.get(launch.userId) ?? null, rule: "mass" as const };
        return { ...base, kind: "mass" as const, chatterId: null, chatterName: null, rule: "none" as const };
      }
      if (sold?.authorId) {
        return { ...base, kind: sale.kind, chatterId: sold.authorId, chatterName: sold.authorName ?? names.get(sold.authorId) ?? null, rule: "sender" as const };
      }
      return { ...base, kind: sale.kind, chatterId: null, chatterName: null, rule: "none" as const };
    }
    const last = lastChatter(sale, input.messages);
    if (last?.authorId) {
      return { ...base, kind: sale.kind, chatterId: last.authorId, chatterName: last.authorName ?? names.get(last.authorId) ?? null, rule: "last_chatter" as const };
    }
    return { ...base, kind: sale.kind, chatterId: null, chatterName: null, rule: "none" as const };
  });
}

function sameFan(message: TeamMessage, sale: TeamSale): boolean {
  if (message.creatorId !== sale.creatorId) return false;
  return !(sale.fanKey && message.fanKey && message.fanKey !== sale.fanKey);
}

/** El mensaje de pago que se compró: por su clave, o el último envío con ese precio antes de la venta. */
function soldMessage(sale: TeamSale, messages: TeamMessage[]): TeamMessage | null {
  if (sale.messageKey) {
    const exact = messages.find((message) => message.key === sale.messageKey && message.creatorId === sale.creatorId);
    if (exact) return exact;
  }
  const candidates = messages
    .filter((message) => !message.fromFan && sameFan(message, sale) && message.at <= sale.at && message.priceCents === sale.grossCents)
    .sort((left, right) => right.at.localeCompare(left.at));
  return candidates[0] ?? null;
}

/** Último mensaje de un chatter al fan antes de la venta. Los envíos de un masivo no cuentan como conversación. */
function lastChatter(sale: TeamSale, messages: TeamMessage[]): TeamMessage | null {
  const talked = messages
    .filter((message) => !message.fromFan && message.authorId && !message.massId && sameFan(message, sale) && message.at <= sale.at)
    .sort((left, right) => right.at.localeCompare(left.at));
  return talked[0] ?? null;
}

/** Cifras por chatter. Las ventas salen de `attributions` si ya están guardadas; si no, se calculan. */
export function chatterReports(input: {
  messages: TeamMessage[];
  sales: TeamSale[];
  launches?: MassLaunch[];
  attributions?: Attribution[];
}): ChatterReport[] {
  const attributions = input.attributions ?? attributeSales(input);
  const users = [
    ...new Set([
      ...input.messages.flatMap((message) => (message.authorId ? [message.authorId] : [])),
      ...attributions.flatMap((item) => (item.chatterId ? [item.chatterId] : [])),
    ]),
  ];
  return users.map((userId) => {
    const mine = input.messages.filter((message) => message.authorId === userId);
    const sales = attributions.filter((item) => item.chatterId === userId);
    const sent = mine.filter((message) => !message.fromFan && message.priceCents != null && message.priceCents > 0);
    const replies = firstReplies(input.messages, userId);
    return {
      userId,
      grossCents: sales.length === 0 ? null : sales.reduce((sum, sale) => sum + sale.grossCents, 0),
      ppvSent: mine.length === 0 ? null : sent.length,
      ppvBought: mine.length === 0 ? null : sent.filter((message) => message.purchased === true).length,
      firstReplyMinutes: replies.length === 0 ? null : Math.round(replies.reduce((sum, value) => sum + value, 0) / replies.length),
      threads: mine.length === 0 ? null : new Set(mine.map((message) => `${message.creatorId}:${message.threadKey}`)).size,
    };
  });
}

function firstReplies(messages: TeamMessage[], userId: string): number[] {
  const byThread = new Map<string, TeamMessage[]>();
  for (const message of messages) {
    const key = `${message.creatorId}:${message.threadKey}`;
    const list = byThread.get(key) ?? [];
    list.push(message);
    byThread.set(key, list);
  }
  const minutes: number[] = [];
  for (const list of byThread.values()) {
    const ordered = [...list].sort((left, right) => left.at.localeCompare(right.at));
    let index = 0;
    while (index < ordered.length) {
      const message = ordered[index];
      if (!message?.fromFan) {
        index += 1;
        continue;
      }
      const start = message;
      while (index < ordered.length && ordered[index]?.fromFan) index += 1;
      const reply = ordered[index];
      if (!reply || reply.fromFan) continue;
      if (reply.authorId !== userId) continue;
      const delta = (Date.parse(reply.at) - Date.parse(start.at)) / 60_000;
      if (delta >= 0) minutes.push(delta);
    }
  }
  return minutes;
}
