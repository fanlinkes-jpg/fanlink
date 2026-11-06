import type { SessionStatus } from "./types.ts";

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Activa",
  pending_login: "Pendiente de login",
  expired: "Expirada",
};

export const CONNECTION_LABEL = {
  not_checked: "Sin comprobar",
  live: "Aceptada",
  rejected: "Rechazada",
  inconclusive: "No concluyente",
  login_required: "Caducada",
} as const;

export const IDENTITY_STATE_LABEL = {
  unavailable: "No verificada",
  verified: "Verificada",
  mismatch: "No coincide",
} as const;

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
