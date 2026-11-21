export type ChatSyncInput = {
  hasSession: boolean;
  loginInProgress: boolean;
  status: "idle" | "ok" | "error" | null;
  reason: string | null;
  running: boolean;
};

/** Lo que ve el chat cuando todavía no hay hilos. */
export function chatSyncLabel(input: ChatSyncInput): string {
  if (input.loginInProgress) return "Sincronizando…";
  if (!input.hasSession) return "Sin sesión";
  if (input.running) return "Sincronizando…";
  if (input.status == null || input.status === "idle") return "Sin sincronizar";
  if (input.status === "error") {
    const reason = shortReason(input.reason ?? "");
    return reason ? `Error · ${reason}` : "Error";
  }
  return "Sin conversaciones";
}

function shortReason(reason: string): string {
  const cut = reason.split(". json:")[0] ?? reason;
  const text = cut.replace(/https?:\/\/\S+/gi, "").replace(/\/[A-Za-z0-9_./-]{8,}/g, "").replace(/\s+/g, " ").trim();
  if (/redirigido a login/i.test(text)) return "pulsa Reconectar";
  return text.slice(0, 120);
}

export function headerSyncLabel(input: ChatSyncInput): string {
  if (input.status === "ok" && !input.running) return "OK";
  return chatSyncLabel(input);
}
