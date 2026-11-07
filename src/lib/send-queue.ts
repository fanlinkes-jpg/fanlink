export const DOUBLE_ENTER_MS = 1_000;

export type SendJobState = "queued" | "sending" | "error" | "awaiting" | "sent";

export type SendJob = {
  clientId: string;
  creatorId: string;
  threadKey: string;
  body: string;
  at: number;
  state: SendJobState;
};

export type VaultAttachment = { id: string; name: string };

/** Lo que el compositor suelta al pulsar Enter. La cola solo mira el cuerpo y el hilo. */
export type OutboundSend = SendJob & {
  fanKey: string | null;
  priceCents: number | null;
  priceLabel: string | null;
  vault: VaultAttachment[];
  messageId: string | null;
  reason: string | null;
};

export type ComposerDraft = {
  body: string;
  priceCents: number | null;
  priceLabel: string | null;
  vault: VaultAttachment[];
};

export type LaneHold = {
  clientId: string;
  creatorId: string;
  threadKey: string;
};

/** Enter envía. Mayúsculas+Enter y la composición del teclado no. */
export function enterSendsMessage(key: string, shiftKey: boolean, composing = false): boolean {
  if (composing) return false;
  return key === "Enter" && !shiftKey;
}

/**
 * Un doble Enter con el mismo cuerpo, en el mismo hilo y en menos de un segundo,
 * no crea otro envío. Cada pulsación aceptada trae su propio clientId.
 */
export function acceptSend<T extends Omit<SendJob, "state">>(
  jobs: readonly (T & { state: SendJobState })[],
  next: T,
  now: number,
): { jobs: (T & { state: SendJobState })[]; accepted: boolean } {
  const duplicate = jobs.some((job) => (
    job.creatorId === next.creatorId
    && job.threadKey === next.threadKey
    && job.body === next.body
    && now - job.at < DOUBLE_ENTER_MS
  ));
  if (duplicate) return { jobs: [...jobs], accepted: false };
  return { jobs: [...jobs, { ...next, state: "queued" }], accepted: true };
}

export function laneKey(job: { creatorId: string; threadKey: string }): string {
  return `${job.creatorId}\0${job.threadKey}`;
}

/**
 * Un envío por hilo, en orden. Un hilo en error frena a los siguientes de ese hilo.
 * Otro hilo no espera. Awaiting y enviado no se vuelven a lanzar.
 * `holds` son errores que ya están en el servidor: el hilo no sigue hasta reintentar
 * o descartar ese id. Si el reintento ya está en cola, sale el primero.
 */
export function runnableJobIds(jobs: readonly SendJob[], holds: readonly LaneHold[] = []): string[] {
  const lanes = new Map<string, SendJob[]>();
  for (const job of jobs) {
    const key = laneKey(job);
    const list = lanes.get(key) ?? [];
    list.push(job);
    lanes.set(key, list);
  }
  const ids: string[] = [];
  for (const list of lanes.values()) {
    const head = list[0];
    if (!head) continue;
    const blocked = holds.some((hold) => (
      hold.creatorId === head.creatorId
      && hold.threadKey === head.threadKey
      && !list.some((job) => job.clientId === hold.clientId && (job.state === "queued" || job.state === "sending"))
    ));
    if (blocked) continue;
    for (const job of list) {
      if (job.state === "sent" || job.state === "awaiting") continue;
      if (job.state === "error" || job.state === "sending") break;
      ids.push(job.clientId);
      break;
    }
  }
  return ids;
}

export function bubbleCaption(state: SendJobState, reason: string | null): string | null {
  if (state === "queued" || state === "sending") return "Enviando…";
  if (state === "awaiting") return "Pendiente de confirmar";
  if (state === "error") return `No se envió: ${reason?.trim() || "No se envió"}`;
  return null;
}

/**
 * Opción G: no se crea la fila al encolar. El aviso de beforeunload cubre la cola
 * del navegador (en espera, enviando o en error). Enviado y pendiente de confirmar
 * ya están en el servidor y no avisan.
 */
export function shouldWarnOnLeave(jobs: readonly { state: SendJobState }[]): boolean {
  return jobs.some((job) => job.state === "queued" || job.state === "sending" || job.state === "error");
}

export type OutboundBubble = {
  clientId: string;
  creatorId: string;
  threadKey: string;
  body: string;
  messageId: string | null;
};

/** Quita la burbuja optimista cuando el mensaje real ya está en el hilo. No deja dos. */
export function reconcileBubbles<B extends OutboundBubble>(
  local: readonly B[],
  messages: readonly { messageKey: string; creatorId: string; threadKey: string }[],
): B[] {
  const seen = new Set<string>();
  const out: B[] = [];
  for (const bubble of local) {
    const key = `${bubble.creatorId}\0${bubble.threadKey}\0${bubble.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (bubble.messageId && messages.some((message) => (
      message.messageKey === bubble.messageId
      && message.creatorId === bubble.creatorId
      && message.threadKey === bubble.threadKey
    ))) continue;
    out.push(bubble);
  }
  return out;
}

/** El pendiente del servidor no se pinta si la burbuja local de ese id ya está. */
export function pendingBesideLocal<P extends { id: string; creatorId: string; threadKey: string | null }>(
  pending: readonly P[],
  local: readonly { clientId: string; creatorId: string; threadKey: string }[],
): P[] {
  const ids = new Set(local.map((bubble) => `${bubble.creatorId}\0${bubble.threadKey}\0${bubble.clientId}`));
  return pending.filter((item) => item.threadKey != null && !ids.has(`${item.creatorId}\0${item.threadKey}\0${item.id}`));
}

export function priceLabelFromCents(cents: number | null): string | null {
  if (cents == null || cents <= 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Solo el error del usuario que mira frena su cola. El de otro chatter no. */
export function holdsForUser(
  items: readonly { id: string; creatorId: string; threadKey: string | null; status: string; authorId: string | null }[],
  userId: string | null,
): LaneHold[] {
  if (!userId) return [];
  return items.flatMap((item) => (
    item.status === "error" && item.authorId === userId && item.threadKey
      ? [{ clientId: item.id, creatorId: item.creatorId, threadKey: item.threadKey }]
      : []
  ));
}

/** Descartar solo saca el envío si el servidor dijo que sí. Un 403 deja la cola igual. */
export function applyDiscardResult<T extends { clientId: string }>(
  jobs: readonly T[],
  clientId: string,
  result: { ok: boolean },
): T[] {
  if (!result.ok) return [...jobs];
  return jobs.filter((job) => job.clientId !== clientId);
}

/** Recuperar y reintentar usan el precio y las piezas que guardó el servidor. */
export function draftFromPending(item: {
  body: string;
  priceCents: number | null;
  vault: readonly VaultAttachment[];
}): ComposerDraft {
  return draftFromRejected({
    body: item.body,
    priceCents: item.priceCents,
    priceLabel: priceLabelFromCents(item.priceCents),
    vault: item.vault.map((piece) => ({ id: piece.id, name: piece.name })),
  });
}
export function draftFromRejected(draft: ComposerDraft): ComposerDraft {
  return {
    body: draft.body,
    priceCents: draft.priceCents,
    priceLabel: draft.priceLabel,
    vault: draft.vault.map((item) => ({ id: item.id, name: item.name })),
  };
}
