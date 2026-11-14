const OPEN_THREAD = "fanlink:open-thread";

export type OpenThread = {
  creatorId: string;
  threadKey: string | null;
  fanKey: string | null;
};

export function rememberOpenThread(target: OpenThread): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(OPEN_THREAD, JSON.stringify(target));
}

export function peekOpenThread(): OpenThread | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(OPEN_THREAD);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OpenThread>;
    if (typeof parsed.creatorId !== "string") return null;
    return {
      creatorId: parsed.creatorId,
      threadKey: typeof parsed.threadKey === "string" ? parsed.threadKey : null,
      fanKey: typeof parsed.fanKey === "string" ? parsed.fanKey : null,
    };
  } catch {
    return null;
  }
}

export function clearOpenThread(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(OPEN_THREAD);
}
