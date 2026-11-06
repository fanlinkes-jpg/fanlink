/**
 * Compuerta del envío real de masivos.
 * Apagada salvo que el flag sea exactamente "true" y la cuenta esté en la allowlist.
 * Este módulo no abre red ni firma peticiones.
 */
export const MASS_SEND_FLAG = "FANLINK_ENABLE_MASS_SEND";
export const MASS_ALLOW_ACCOUNTS = "FANLINK_SEND_ALLOW_ACCOUNTS";

export const SEND_FLAG = "FANLINK_ENABLE_SEND";

export type MassEnv = {
  FANLINK_ENABLE_MASS_SEND?: string;
  FANLINK_ENABLE_SEND?: string;
  FANLINK_SEND_ALLOW_ACCOUNTS?: string;
};

export type MassGate = { open: true } | { open: false; reason: string };

export function massSendEnabled(env: MassEnv): boolean {
  return env.FANLINK_ENABLE_MASS_SEND === "true";
}

export function massAllowAccounts(env: MassEnv): ReadonlySet<string> {
  return new Set(
    (env.FANLINK_SEND_ALLOW_ACCOUNTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

export function massSendGate(accountId: string, env: MassEnv): MassGate {
  if (env.FANLINK_ENABLE_SEND !== "true") {
    return {
      open: false,
      reason: "FANLINK_ENABLE_SEND está apagado. El envío real no se ejecuta.",
    };
  }
  if (!massSendEnabled(env)) {
    return {
      open: false,
      reason:
        "FANLINK_ENABLE_MASS_SEND está apagado. El envío real no se ejecuta.",
    };
  }
  if (!massAllowAccounts(env).has(accountId)) {
    return {
      open: false,
      reason: "La cuenta no está en FANLINK_SEND_ALLOW_ACCOUNTS.",
    };
  }
  return { open: true };
}
