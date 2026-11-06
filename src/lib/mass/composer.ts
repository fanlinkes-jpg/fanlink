import { isSpendTierId } from "../spend-tiers.ts";
import { knownMark, parseMarkup, plainText } from "./text.ts";
import type {
  MassDraft,
  MassFollowUp,
  MassMedia,
  MassSegment,
  TextRun,
} from "./types.ts";

export const PPV_MIN_CENTS = 300;
export const PPV_MAX_CENTS = 20_000;
export const MASS_NAME_MAX = 80;
export const MASS_BODY_MAX = 2_000;
export const MASS_MEDIA_MAX = 12;
export const MASS_HOUR_MAX = 168;

export type ComposeMassInput = {
  accountId: string;
  name: string;
  body: string | TextRun[];
  media?: MassMedia[];
  /** Null o ausente: gratis. Si no, céntimos de un precio entero en dólares. */
  priceCents?: number | null;
  scheduledAt?: string | null;
  segment: MassSegment;
  unsendAfterHours?: number | null;
  followUp?: { body: string | TextRun[]; afterHours: number } | null;
  createdBy?: { id: string; name: string } | null;
  rotate?: boolean;
  excludeBought?: boolean;
  stopWords?: readonly string[];
  now?: Date;
  createId?: () => string;
};

export type ComposeMassResult =
  { ok: true; draft: MassDraft } | { ok: false; errors: string[] };

export function composeMass(input: ComposeMassInput): ComposeMassResult {
  const errors: string[] = [];
  const accountId = input.accountId.trim();
  const name = input.name.trim();
  if (!accountId) errors.push("Indica la cuenta.");
  if (!name) errors.push("Indica el nombre del masivo.");
  else if (name.length > MASS_NAME_MAX)
    errors.push(`El nombre admite ${MASS_NAME_MAX} caracteres.`);

  const body = normalizeRuns(input.body, errors);
  const media = normalizeMedia(input.media ?? [], errors);
  const priceCents = normalizePrice(input.priceCents ?? null, errors);
  const plain = plainText(body).trim();
  if (!plain && media.length === 0)
    errors.push("Escribe un texto o adjunta media de la bóveda.");
  if (plain.length > MASS_BODY_MAX)
    errors.push(`El texto admite ${MASS_BODY_MAX} caracteres.`);
  if (priceCents != null && !plain && media.every((item) => item.preview)) {
    errors.push(
      "El PPV no tiene nada bloqueado: deja texto o alguna media de pago.",
    );
  }
  if (priceCents == null && media.some((item) => item.preview)) {
    errors.push("Un mensaje gratis no lleva vista previa.");
  }

  const scheduledAt = normalizeWhen(
    input.scheduledAt ?? null,
    input.now,
    errors,
  );
  const unsendAfterHours = normalizeHours(
    input.unsendAfterHours ?? null,
    "El unsend automático",
    errors,
  );
  const followUp = normalizeFollowUp(input.followUp ?? null, errors);
  const createdBy = normalizeAuthor(input.createdBy ?? null, errors);
  validateSegment(input.segment, errors);

  const flag = stopFlag(plain, input.stopWords ?? []);
  if (errors.length > 0) return { ok: false, errors };

  const withMedia = media.length > 0;
  const draft: MassDraft = {
    id: (input.createId ?? defaultId)(),
    accountId,
    name,
    body,
    media,
    priceCents,
    scheduledAt,
    segment: cloneSegment(input.segment),
    unsendAfterHours,
    followUp,
    createdBy,
    rotate: input.rotate ?? withMedia,
    excludeBought: input.excludeBought ?? withMedia,
    status: flag ? "held" : scheduledAt ? "scheduled" : "draft",
    flag,
  };
  return { ok: true, draft };
}

function normalizeRuns(body: string | TextRun[], errors: string[]): TextRun[] {
  const runs =
    typeof body === "string"
      ? parseMarkup(body)
      : body.map((run) => ({
          text: run.text,
          marks: run.marks ? [...run.marks] : undefined,
        }));
  for (const run of runs) {
    for (const mark of run.marks ?? []) {
      if (!knownMark(mark))
        errors.push("Hay una marca de texto que no existe.");
    }
  }
  return runs;
}

function normalizeMedia(media: MassMedia[], errors: string[]): MassMedia[] {
  if (media.length > MASS_MEDIA_MAX)
    errors.push(`El masivo admite ${MASS_MEDIA_MAX} medios.`);
  const seen = new Set<string>();
  const next: MassMedia[] = [];
  for (const item of media) {
    const vaultId = item.vaultId.trim();
    if (!vaultId) {
      errors.push("Hay un medio sin id de la bóveda.");
      continue;
    }
    if (seen.has(vaultId)) {
      errors.push("Hay media repetida.");
      continue;
    }
    seen.add(vaultId);
    next.push({ vaultId, preview: item.preview === true });
  }
  return next;
}

function normalizePrice(
  priceCents: number | null,
  errors: string[],
): number | null {
  if (priceCents == null) return null;
  if (
    !Number.isInteger(priceCents) ||
    priceCents < PPV_MIN_CENTS ||
    priceCents > PPV_MAX_CENTS ||
    priceCents % 100 !== 0
  ) {
    errors.push("El PPV tiene que ser gratis o un entero entre 3 y 200 USD.");
    return null;
  }
  return priceCents;
}

function normalizeWhen(
  value: string | null,
  now: Date | undefined,
  errors: string[],
): string | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    errors.push("La programación no es una fecha válida.");
    return null;
  }
  if (now && parsed < now.getTime()) errors.push("La programación ya pasó.");
  return new Date(parsed).toISOString();
}

function normalizeHours(
  value: number | null,
  label: string,
  errors: string[],
): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > MASS_HOUR_MAX) {
    errors.push(`${label} tiene que ser entre 1 y ${MASS_HOUR_MAX} horas.`);
    return null;
  }
  return value;
}

function normalizeFollowUp(
  followUp: { body: string | TextRun[]; afterHours: number } | null,
  errors: string[],
): MassFollowUp | null {
  if (followUp == null) return null;
  const body = normalizeRuns(followUp.body, errors);
  const afterHours = normalizeHours(
    followUp.afterHours,
    "El follow-up",
    errors,
  );
  if (!plainText(body).trim()) errors.push("El follow-up necesita texto.");
  if (afterHours == null) return null;
  return { body, afterHours };
}

function normalizeAuthor(
  createdBy: { id: string; name: string } | null,
  errors: string[],
): { id: string; name: string } | null {
  if (createdBy == null) return null;
  const id = createdBy.id.trim();
  const name = createdBy.name.trim();
  if (!id || !name) {
    errors.push("El chatter creador no tiene nombre.");
    return null;
  }
  return { id, name };
}

function validateSegment(segment: MassSegment, errors: string[]): void {
  for (const tier of segment.spendTiers ?? []) {
    if (!isSpendTierId(tier))
      errors.push("Hay un tramo de gasto que no existe.");
  }
  if (
    segment.subscription != null &&
    segment.subscription !== "activa" &&
    segment.subscription !== "caducada"
  ) {
    errors.push("La suscripción tiene que ser activa o caducada.");
  }
  assertDays(segment.activeWithinDays, "actividad", errors);
  assertDays(segment.purchasedWithinDays, "última compra", errors);
  if (!hasAudience(segment)) errors.push("Elige una audiencia.");
}

function assertDays(
  value: number | undefined,
  label: string,
  errors: string[],
): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value < 1 || value > 3650)
    errors.push(`El plazo de ${label} no es válido.`);
}

export function hasAudience(segment: MassSegment): boolean {
  if (segment.includeAll) return true;
  return Boolean(
    segment.ofListIds?.length ||
    segment.includeFanKeys?.length ||
    segment.spendTiers?.length ||
    segment.subscription ||
    segment.activeWithinDays != null ||
    segment.purchasedWithinDays != null,
  );
}

function stopFlag(
  plain: string,
  stopWords: readonly string[],
): string | undefined {
  const haystack = plain.toLowerCase();
  const hit = stopWords
    .map((word) => word.trim().toLowerCase())
    .find((word) => word && haystack.includes(word));
  return hit;
}

function cloneSegment(segment: MassSegment): MassSegment {
  return {
    includeAll: segment.includeAll,
    ofListIds: segment.ofListIds ? [...segment.ofListIds] : undefined,
    includeFanKeys: segment.includeFanKeys
      ? [...segment.includeFanKeys]
      : undefined,
    spendTiers: segment.spendTiers ? [...segment.spendTiers] : undefined,
    spendWindow: segment.spendWindow,
    activeWithinDays: segment.activeWithinDays,
    purchasedWithinDays: segment.purchasedWithinDays,
    subscription: segment.subscription,
    excludeFanKeys: segment.excludeFanKeys
      ? [...segment.excludeFanKeys]
      : undefined,
    excludeOfListIds: segment.excludeOfListIds
      ? [...segment.excludeOfListIds]
      : undefined,
  };
}

function defaultId(): string {
  return crypto.randomUUID();
}
