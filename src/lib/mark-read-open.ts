/** Un hilo que queda seleccionado y a la vista. El ratón por encima y el sondeo no. */
export type OpenHow = "click" | "keyboard" | "auto" | "notification" | "online" | "hover" | "poll";

export type VisibleThread = { id: string; unread: number | null };

export function openedThread(input: {
  how: OpenHow;
  threads: readonly VisibleThread[];
  selectedId: string | null;
  targetId?: string | null;
  arrow?: "up" | "down";
}): VisibleThread | null {
  if (input.how === "hover" || input.how === "poll") return null;
  if (input.how === "keyboard") {
    const index = input.threads.findIndex((thread) => thread.id === input.selectedId);
    const step = input.arrow === "up" ? -1 : 1;
    return input.threads[index + step] ?? null;
  }
  if (input.how === "auto") {
    if (input.selectedId) return input.threads.find((thread) => thread.id === input.selectedId) ?? input.threads[0] ?? null;
    return input.threads[0] ?? null;
  }
  return input.threads.find((thread) => thread.id === input.targetId) ?? null;
}

export function shouldMarkOpened(thread: { unread: number | null } | null, flag: string | undefined): boolean {
  if (!thread || thread.unread === 0 || flag !== "true") return false;
  return true;
}
