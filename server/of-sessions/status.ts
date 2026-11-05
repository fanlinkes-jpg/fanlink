import type { SessionStatus } from "./types.ts";

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Activa",
  pending_login: "Pendiente de login",
  expired: "Expirada",
};

export function sessionActionLabel(
  status: SessionStatus,
): "Conectar" | "Reconectar" {
  switch (status) {
    case "pending_login":
      return "Conectar";
    case "active":
    case "expired":
      return "Reconectar";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
