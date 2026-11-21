export type ChatSyncInput = {
  hasSession: boolean;
  loginInProgress: boolean;
  status: "idle" | "ok" | "error" | null;
  reason: string | null;
  running: boolean;
};

/** Lo que ve el chat cuando todavía no hay hilos. */
export function chatSyncLabel(input: ChatSyncInput): string {
  if (input.loginInProgress || input.running) return "Sincronizando…";
  if (!input.hasSession) return "Sin sesión";
  if (input.status == null || input.status === "idle") return "Sincronizando…";
  if (input.status === "error") {
    const reason = (input.reason ?? "").replace(/https?:\/\/\S+/gi, "").trim();
    return reason ? `Error · ${reason.slice(0, 120)}` : "Error";
  }
  return "Sin conversaciones";
}

export function headerSyncLabel(input: ChatSyncInput): string {
  if (input.status === "ok" && !input.running) return "OK";
  return chatSyncLabel(input);
}
