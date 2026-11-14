/** Pastillas de la lista: Todos, Sin leer y Con propinas. Sin cifra, null: en pantalla es «Sin datos». */

export type InboxPill = "todos" | "sin-leer" | "propinas";

export type PillThread = { threadKey: string; unread: number | null; tipsCents?: number | null };

export type PillMessage = { threadKey: string; eventKind?: "compra" | "propina" | null };

export type PillCounts = { todos: number | null; sinLeer: number | null; propinas: number | null };

export function inboxPillCounts(input: {
  status: "loading" | "error" | "ready";
  threads: readonly PillThread[];
  messages: readonly PillMessage[] | null;
}): PillCounts {
  if (input.status !== "ready") return { todos: null, sinLeer: null, propinas: null };
  const todos = input.threads.length;
  const unreadKnown = input.threads.some((thread) => thread.unread != null);
  const sinLeer = unreadKnown ? input.threads.filter((thread) => thread.unread != null && thread.unread > 0).length : null;
  const tipped = tipThreads(input.messages, input.threads);
  const propinasKnown = input.messages != null || input.threads.some((thread) => thread.tipsCents != null);
  return {
    todos,
    sinLeer,
    propinas: propinasKnown ? input.threads.filter((thread) => tipped.has(thread.threadKey)).length : null,
  };
}

export function tipThreads(messages: readonly PillMessage[] | null, threads: readonly PillThread[] = []): Set<string> {
  const keys = new Set<string>();
  for (const message of messages ?? []) {
    if (message.eventKind === "propina") keys.add(message.threadKey);
  }
  for (const thread of threads) {
    if (thread.tipsCents != null && thread.tipsCents > 0) keys.add(thread.threadKey);
  }
  return keys;
}

export function matchesInboxPill(thread: PillThread, pill: InboxPill, tipped: ReadonlySet<string>): boolean {
  if (pill === "todos") return true;
  if (pill === "sin-leer") return thread.unread != null && thread.unread > 0;
  return tipped.has(thread.threadKey);
}
