import { createHash, timingSafeEqual } from "node:crypto";

export const MASS_PERMISSION = "masivos";

/** Caduca a los dos minutos, medidos por el reloj de la base. No abre el envío real. */
export const LAUNCH_TOKEN_TTL_MS = 120_000;

export type MassActor = {
  id: string;
  role: "owner" | "member";
  perms: readonly string[];
};

export function canCreateMass(actor: MassActor | null): boolean {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  return actor.perms.includes(MASS_PERMISSION);
}

export function canLaunchMass(actor: MassActor | null): boolean {
  return actor?.role === "owner" && actor.id.trim().length > 0;
}

/** Primera petición. El token lo genera el servidor. La base guarda el hash. */
export function beginMassLaunch(input: {
  actor: MassActor | null;
  draftId: string;
}):
  | { ok: true; token: string; tokenHash: string }
  | { ok: false; reason: string } {
  if (!canLaunchMass(input.actor)) {
    return {
      ok: false,
      reason: "Solo un admin confirma el envío de un masivo.",
    };
  }
  if (!input.draftId.trim()) return { ok: false, reason: "Falta el masivo." };
  const token = defaultToken();
  if (!token.trim())
    return { ok: false, reason: "No se ha podido crear el token." };
  return { ok: true, token, tokenHash: hashLaunchToken(token) };
}

/**
 * Segunda petición. El hash y `tokenLive` salen de la base (`expires_at > now()`).
 * No compara el token en claro.
 */
export function confirmMassLaunch(input: {
  actor: MassActor | null;
  presentedToken: string;
  storedHash: string | null;
  issuedBy: string | null;
  tokenLive: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!canLaunchMass(input.actor)) {
    return {
      ok: false,
      reason: "Solo un admin confirma el envío de un masivo.",
    };
  }
  if (input.storedHash == null || input.issuedBy == null) {
    return { ok: false, reason: "Falta el token de la primera confirmación." };
  }
  if (input.actor?.id !== input.issuedBy) {
    return {
      ok: false,
      reason: "El token lo tiene que usar el admin que lo pidió.",
    };
  }
  if (!input.tokenLive) {
    return { ok: false, reason: "El token de confirmación ha caducado." };
  }
  if (!tokenHashEquals(input.storedHash, input.presentedToken)) {
    return { ok: false, reason: "El token no coincide con el masivo." };
  }
  return { ok: true };
}

export function hashLaunchToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenHashEquals(storedHex: string, presented: string): boolean {
  const stored = Buffer.from(storedHex, "hex");
  const hash = createHash("sha256").update(presented, "utf8").digest();
  if (stored.length !== hash.length) return false;
  return timingSafeEqual(stored, hash);
}

function defaultToken(): string {
  return crypto.randomUUID();
}
