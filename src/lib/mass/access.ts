export const MASS_PERMISSION = "masivos";

/** Caduca a los dos minutos. No abre el envío real. */
export const LAUNCH_TOKEN_TTL_MS = 120_000;

export type MassActor = {
  role: "owner" | "member";
  perms: readonly string[];
};

export type LaunchChallenge = {
  draftId: string;
  token: string;
  expiresAt: number;
};

export function canCreateMass(actor: MassActor | null): boolean {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  return actor.perms.includes(MASS_PERMISSION);
}

export function canLaunchMass(actor: MassActor | null): boolean {
  return actor?.role === "owner";
}

/** Primera petición. Devuelve el token y no cambia el estado. */
export function beginMassLaunch(input: {
  actor: MassActor | null;
  draftId: string;
  now: Date;
  ttlMs?: number;
  createToken?: () => string;
}): { ok: true; challenge: LaunchChallenge } | { ok: false; reason: string } {
  if (!canLaunchMass(input.actor)) {
    return {
      ok: false,
      reason: "Solo un admin confirma el envío de un masivo.",
    };
  }
  const draftId = input.draftId.trim();
  if (!draftId) return { ok: false, reason: "Falta el masivo." };
  const token = (input.createToken ?? defaultToken)();
  if (!token.trim())
    return { ok: false, reason: "No se ha podido crear el token." };
  const ttl = input.ttlMs ?? LAUNCH_TOKEN_TTL_MS;
  return {
    ok: true,
    challenge: { draftId, token, expiresAt: input.now.getTime() + ttl },
  };
}

/** Segunda petición. Sin un token ya emitido, o si caducó, no confirma. */
export function confirmMassLaunch(input: {
  actor: MassActor | null;
  draftId: string;
  token: string;
  challenge: LaunchChallenge | null;
  now: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (!canLaunchMass(input.actor)) {
    return {
      ok: false,
      reason: "Solo un admin confirma el envío de un masivo.",
    };
  }
  if (input.challenge == null) {
    return { ok: false, reason: "Falta el token de la primera confirmación." };
  }
  if (
    input.token.trim() === "" ||
    input.token !== input.challenge.token ||
    input.challenge.draftId !== input.draftId
  ) {
    return { ok: false, reason: "El token no coincide con el masivo." };
  }
  if (input.now.getTime() >= input.challenge.expiresAt) {
    return { ok: false, reason: "El token de confirmación ha caducado." };
  }
  return { ok: true };
}

function defaultToken(): string {
  return crypto.randomUUID();
}
