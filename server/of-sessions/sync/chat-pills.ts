/** Pastillas de la lista: Todos, Sin leer y Con propinas. Sin cifra, null: en pantalla es «Sin datos». */

export type InboxPill = "todos" | "sin-leer" | "propinas";

export type PillThread = { threadKey: string; unread: number | null };

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
  if (input.messages == null) return { todos, sinLeer, propinas: null };
  const tipped = tipThreads(input.messages);
  return {
    todos,
    sinLeer,
    propinas: input.threads.filter((thread) => tipped.has(thread.threadKey)).length,
  };
}

export function tipThreads(messages: readonly PillMessage[]): Set<string> {
  return new Set(messages.filter((message) => message.eventKind === "propina").map((message) => message.threadKey));
}

export function matchesInboxPill(thread: PillThread, pill: InboxPill, tipped: ReadonlySet<string>): boolean {
  if (pill === "todos") return true;
  if (pill === "sin-leer") return thread.unread != null && thread.unread > 0;
  return tipped.has(thread.threadKey);
}
