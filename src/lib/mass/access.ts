export const MASS_PERMISSION = "masivos";

export const LAUNCH_PHRASE = "ENVIAR MASIVO";

export type MassActor = {
  role: "owner" | "member";
  perms: readonly string[];
};

export function canCreateMass(actor: MassActor | null): boolean {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  return actor.perms.includes(MASS_PERMISSION);
}

export function canLaunchMass(actor: MassActor | null): boolean {
  return actor?.role === "owner";
}

/** Dos confirmaciones distintas del admin: el id del masivo y la frase fija. */
export function confirmMassLaunch(input: {
  actor: MassActor | null;
  draftId: string;
  confirmDraftId: string;
  confirmPhrase: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!canLaunchMass(input.actor)) {
    return {
      ok: false,
      reason: "Solo un admin confirma el envío de un masivo.",
    };
  }
  if (
    input.confirmDraftId.trim() === "" ||
    input.confirmDraftId.trim() !== input.draftId
  ) {
    return {
      ok: false,
      reason: "La primera confirmación no coincide con el masivo.",
    };
  }
  if (input.confirmPhrase !== LAUNCH_PHRASE) {
    return { ok: false, reason: "Falta la segunda confirmación del admin." };
  }
  return { ok: true };
}
