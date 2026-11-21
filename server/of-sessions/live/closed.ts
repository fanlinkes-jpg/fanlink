export const LIVE_CLOSED_NOTICE =
  "La página de OnlyFans se cerró. Si queda un Chromium de esta cuenta, ciérralo y entra otra vez en Notificaciones.";

export function isTargetClosedMessage(message: string): boolean {
  return message.includes("has been closed") || message.includes("Target closed") || message.includes("Browser closed");
}

/** Un cierre se reintenta una sola vez. El siguiente se dice y se para. */
export function shouldReviveLive(revives: number): boolean {
  return revives < 1;
}
