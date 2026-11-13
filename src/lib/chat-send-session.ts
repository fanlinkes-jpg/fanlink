import {
  acceptSend,
  applyDiscardResult,
  runnableJobIds,
  shouldWarnOnLeave,
  type LaneHold,
  type OutboundSend,
  type VaultAttachment,
} from "./send-queue.ts";

export const REAL_SEND_OFF_REASON = "Envío real desactivado";

function cleanTag(value: string | null | undefined): string | null {
  const handle = value?.replace(/^@/, "").trim() ?? "";
  return /^[A-Za-z0-9._]{2,40}$/.test(handle) ? handle : null;
}

export type SendTransportResult = {
  sent: boolean;
  reason: string | null;
  messageId: string | null;
};

export type SendTransport = (job: OutboundSend) => Promise<SendTransportResult>;

export type ComposerSend = {
  body: string;
  creatorId: string;
  threadKey: string;
  fanKey: string | null;
  priceCents: number | null;
  priceLabel: string | null;
  vault: VaultAttachment[];
  tagHandle?: string | null;
};

export type PressResult =
  | { action: "newline" }
  | { action: "ignored" }
  | { action: "blocked"; reason: string }
  | { action: "duplicate" }
  | { action: "queued"; clientId: string };

/**
 * La cola no vive en la página. Cambiar de sección desmonta Mensajes y el
 * `beforeunload` no salta: este store sigue con los envíos y el transporte.
 * La fila en el servidor sigue naciendo cuando el envío llega, no al encolar.
 */
export function createChatSendSession(options?: {
  now?: () => number;
  uuid?: () => string;
  transport?: SendTransport;
}) {
  let jobs: OutboundSend[] = [];
  let holds: LaneHold[] = [];
  let transport: SendTransport = options?.transport ?? (async () => ({
    sent: false,
    reason: "Sin transporte",
    messageId: null,
  }));
  const listeners = new Set<() => void>();
  const running = new Set<string>();
  const waiters: Array<() => void> = [];
  let ownerId: string | null = null;

  function emit() {
    for (const listener of listeners) listener();
  }

  function settle() {
    if (running.size > 0) return;
    const pending = waiters.splice(0);
    for (const resolve of pending) resolve();
  }

  function setJobs(next: OutboundSend[]) {
    jobs = next;
    emit();
  }

  function patch(clientId: string, partial: Partial<OutboundSend>) {
    setJobs(jobs.map((job) => job.clientId === clientId ? { ...job, ...partial } : job));
  }

  function releaseHold(clientId: string) {
    const next = holds.filter((hold) => hold.clientId !== clientId);
    if (next.length !== holds.length) holds = next;
  }

  function clearQueue() {
    jobs = [];
    holds = [];
    running.clear();
    waiters.splice(0);
    emit();
  }

  async function deliver(job: OutboundSend) {
    try {
      const result = await transport(job);
      if (result.sent && result.messageId) {
        patch(job.clientId, { state: "sent", messageId: result.messageId, reason: null });
        releaseHold(job.clientId);
        return;
      }
      if (result.reason === "Pendiente de confirmar") {
        patch(job.clientId, { state: "awaiting", reason: result.reason });
        releaseHold(job.clientId);
        return;
      }
      patch(job.clientId, { state: "error", reason: result.reason ?? "No se envió" });
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "No se envió";
      patch(job.clientId, { state: "error", reason });
    }
  }

  function pump() {
    const ids = runnableJobIds(jobs, holds);
    for (const id of ids) {
      if (running.has(id)) continue;
      const job = jobs.find((item) => item.clientId === id);
      if (!job || job.state !== "queued") continue;
      running.add(id);
      patch(id, { state: "sending", reason: null });
      const sending = jobs.find((item) => item.clientId === id) ?? job;
      void deliver({ ...sending, state: "sending" }).finally(() => {
        running.delete(id);
        pump();
        settle();
      });
    }
    settle();
  }

  function submit(input: ComposerSend & { realSend: boolean; now?: number }): PressResult {
    const body = input.body.trim();
    if (!body || !input.creatorId || !input.threadKey) return { action: "ignored" };
    if (!input.realSend) return { action: "blocked", reason: REAL_SEND_OFF_REASON };
    const now = input.now ?? (options?.now ?? Date.now)();
    const next: Omit<OutboundSend, "state"> = {
      clientId: (options?.uuid ?? (() => crypto.randomUUID()))(),
      creatorId: input.creatorId,
      threadKey: input.threadKey,
      fanKey: input.fanKey,
      body,
      priceCents: input.priceCents,
      priceLabel: input.priceLabel,
      vault: input.vault.map((item) => ({ id: item.id, name: item.name, ...(typeof item.free === "boolean" ? { free: item.free } : {}) })),
      tagHandle: cleanTag(input.tagHandle),
      at: now,
      messageId: null,
      reason: null,
    };
    const decision = acceptSend(jobs, next, now);
    if (!decision.accepted) return { action: "duplicate" };
    setJobs(decision.jobs);
    pump();
    return { action: "queued", clientId: next.clientId };
  }

  return {
    getJobs(): OutboundSend[] {
      return jobs;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setTransport(next: SendTransport) {
      transport = next;
    },
    setHolds(next: LaneHold[]) {
      holds = next;
    },
    /** Enter envía. Mayúsculas+Enter es un salto de línea y no encola. */
    press(input: ComposerSend & { key: string; shiftKey: boolean; composing?: boolean; realSend: boolean; now?: number }): PressResult {
      if (input.composing) return { action: "ignored" };
      if (input.key === "Enter" && input.shiftKey) return { action: "newline" };
      if (input.key !== "Enter") return { action: "ignored" };
      return submit(input);
    },
    submit,
    retry(clientId: string, source?: OutboundSend) {
      const local = jobs.find((job) => job.clientId === clientId);
      if (local) {
        if (local.state !== "error") return;
        patch(clientId, { state: "queued", reason: null });
        pump();
        return;
      }
      if (!source || source.state === "sent" || source.state === "awaiting") return;
      const queued: OutboundSend = { ...source, clientId, state: "queued", reason: null, messageId: null };
      const next = [...jobs];
      const index = next.findIndex((row) => row.creatorId === queued.creatorId && row.threadKey === queued.threadKey);
      if (index < 0) next.push(queued);
      else next.splice(index, 0, queued);
      setJobs(next);
      pump();
    },
    noteFailure(clientId: string, reason: string) {
      if (!jobs.some((job) => job.clientId === clientId)) return;
      patch(clientId, { state: "error", reason });
    },
    /** Solo si el servidor aceptó el descarte. Si no, la cola se queda. */
    remove(clientId: string) {
      const next = applyDiscardResult(jobs, clientId, { ok: true });
      if (next.length !== jobs.length) setJobs(next);
      pump();
    },
    shouldWarn(): boolean {
      return shouldWarnOnLeave(jobs);
    },
    whenIdle(): Promise<void> {
      if (running.size === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** Vacía la cola de este navegador. No cambia el usuario atado. */
    reset() {
      clearQueue();
    },
    /** Si entra otro usuario, se tira la cola anterior. Un vacío mientras la sesión carga no la toca. */
    bindUser(userId: string | null, options?: { pending?: boolean }) {
      if (options?.pending && !userId) return;
      if (userId === ownerId) return;
      ownerId = userId;
      clearQueue();
    },
  };
}

export const chatSendSession = createChatSendSession();
