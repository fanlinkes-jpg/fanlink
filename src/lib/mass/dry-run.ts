import { massSendGate, type MassEnv } from "./gates.ts";
import { formattedText, personalize, plainText } from "./text.ts";
import {
  DEFAULT_PACE,
  buildQueue,
  validPace,
  type PaceLimits,
} from "./queue.ts";
import { resolveSegment } from "./segments.ts";
import { bestSendHour, suggestPrice } from "./smart.ts";
import {
  followUpRecipients,
  massStats,
  type MassDelivery,
  type MassStats,
} from "./stats.ts";
import type { MassDraft, MassSnapshot, SinDatos } from "./types.ts";
import { SIN_DATOS } from "./types.ts";

export type DryRunResult = {
  delivered: false;
  mode: "dry-run";
  network: "sin-llamada";
  gate: { open: boolean; reason: string };
  ok: boolean;
  status: "listo" | "bloqueado" | "sin_datos";
  errors: string[];
  warnings: string[];
  audience: number | SinDatos;
  excluded: Array<{ fanKey: string; reason: string }>;
  skippedMissing: Array<{ fanKey: string; field: string }>;
  queue: Array<{
    fanKey: string;
    at: string;
    text: string;
    priceCents: number | null;
    unsendAt: string | null;
    gaps: string[];
  }>;
  held: string[];
  suggestedPrice: { cents: number; sample: number } | SinDatos;
  bestHourUtc: { hourUtc: number; samples: number } | SinDatos;
  unsendAfterHours: number | null;
  followUp: {
    afterHours: number;
    text: string;
    recipients: string[] | SinDatos;
  } | null;
  stats: MassStats;
  quota: {
    maxPerHour: number;
    maxPerDay: number;
    sentLastHour: number | SinDatos;
    sentLastDay: number | SinDatos;
    queued: number;
    held: number;
  };
};

export function dryRunMass(input: {
  draft: MassDraft;
  snapshot: MassSnapshot;
  now: Date;
  env?: MassEnv;
  pace?: PaceLimits;
  stopWords?: readonly string[];
  deliveries?: readonly MassDelivery[] | null;
}): DryRunResult {
  const env = input.env ?? {};
  const gate = massSendGate(input.draft.accountId, env);
  const pace = input.pace ?? DEFAULT_PACE;
  const errors: string[] = [];
  const stats = massStats({
    createdBy: input.draft.createdBy,
    deliveries: input.deliveries ?? null,
  });
  if (input.draft.accountId !== input.snapshot.accountId)
    errors.push("La cuenta del masivo y la del snapshot no coinciden.");
  if (!validPace(pace)) errors.push("El ritmo de la cuenta no es válido.");
  if (input.draft.status === "held") {
    errors.push(
      `Bloqueado por la palabra «${input.draft.flag ?? ""}». No se envía.`,
    );
  }
  const vaultIds = input.draft.media.map((item) => item.vaultId);
  if (vaultIds.length > 0 && input.snapshot.vaultIds == null)
    errors.push("Sin datos: bóveda");
  if (input.snapshot.vaultIds != null) {
    for (const vaultId of vaultIds) {
      if (!input.snapshot.vaultIds.includes(vaultId))
        errors.push(`La bóveda no tiene «${vaultId}».`);
    }
  }
  if (errors.length > 0) return blocked(gate, errors, stats, pace);

  const segment = resolveSegment(input.snapshot, input.draft.segment, {
    now: input.now,
    vaultIds,
    rotate: input.draft.rotate,
    excludeBought: input.draft.excludeBought,
  });
  const excluded = [...segment.excluded];
  const words = input.stopWords ?? [];
  const candidates = segment.matched.filter((fan) => {
    const text = personalize(input.draft.body, fan);
    const hit = stopHit(plainText(text.runs), words);
    if (!hit) return true;
    excluded.push({
      fanKey: fan.fanKey,
      reason: `Bloqueado por la palabra «${hit}»`,
    });
    return false;
  });

  const fanKeys = candidates.map((fan) => fan.fanKey);
  const suggestedPrice = suggestPrice(input.snapshot.messages, fanKeys);
  const bestHourUtc = bestSendHour(input.snapshot.messages, fanKeys);

  if (segment.blockers.length > 0) {
    return {
      ...base(gate, stats),
      ok: false,
      status: "sin_datos",
      errors: segment.blockers,
      warnings: segment.warnings,
      audience: segment.audience,
      excluded,
      skippedMissing: segment.skippedMissing,
      suggestedPrice,
      bestHourUtc,
      unsendAfterHours: input.draft.unsendAfterHours,
      followUp: followUpOf(input.draft, input.deliveries ?? null),
      quota: quotaOf(pace, {
        sentLastHour: SIN_DATOS,
        sentLastDay: SIN_DATOS,
        slots: [],
        held: [],
      }),
    };
  }

  const startAt = input.draft.scheduledAt
    ? Date.parse(input.draft.scheduledAt)
    : input.now.getTime();
  const plan = buildQueue({
    fanKeys: candidates.map((fan) => fan.fanKey),
    startAt,
    now: input.now.getTime(),
    pace,
    usage: input.snapshot.sendUsage,
    timeZone: input.snapshot.timeZone,
  });
  const byKey = new Map(candidates.map((fan) => [fan.fanKey, fan]));
  const queue = plan.slots.flatMap((slot) => {
    const fan = byKey.get(slot.fanKey);
    if (!fan) return [];
    const text = personalize(input.draft.body, fan);
    const unsendAt =
      input.draft.unsendAfterHours == null
        ? null
        : new Date(
            slot.at + input.draft.unsendAfterHours * 3_600_000,
          ).toISOString();
    return [
      {
        fanKey: slot.fanKey,
        at: new Date(slot.at).toISOString(),
        text: formattedText(text.runs),
        priceCents: input.draft.priceCents,
        unsendAt,
        gaps: text.gaps.length > 0 ? [SIN_DATOS] : [],
      },
    ];
  });

  return {
    ...base(gate, stats),
    ok: true,
    status: "listo",
    warnings: segment.warnings,
    audience: segment.audience,
    excluded,
    skippedMissing: segment.skippedMissing,
    queue,
    held: plan.held,
    suggestedPrice,
    bestHourUtc,
    unsendAfterHours: input.draft.unsendAfterHours,
    followUp: followUpOf(input.draft, input.deliveries ?? null),
    quota: quotaOf(pace, plan),
  };
}

function followUpOf(
  draft: MassDraft,
  deliveries: readonly MassDelivery[] | null,
) {
  if (draft.followUp == null) return null;
  return {
    afterHours: draft.followUp.afterHours,
    text: plainText(draft.followUp.body),
    recipients: followUpRecipients(deliveries),
  };
}

function stopHit(
  plain: string,
  stopWords: readonly string[],
): string | undefined {
  const haystack = plain.toLowerCase();
  return stopWords
    .map((word) => word.trim().toLowerCase())
    .find((word) => word && haystack.includes(word));
}

function quotaOf(
  pace: PaceLimits,
  plan: {
    sentLastHour: number | SinDatos;
    sentLastDay: number | SinDatos;
    slots: unknown[];
    held: string[];
  },
): DryRunResult["quota"] {
  return {
    maxPerHour: pace.maxPerHour,
    maxPerDay: pace.maxPerDay,
    sentLastHour: plan.sentLastHour,
    sentLastDay: plan.sentLastDay,
    queued: plan.slots.length,
    held: plan.held.length,
  };
}

function base(gate: ReturnType<typeof massSendGate>, stats: MassStats) {
  return {
    delivered: false as const,
    mode: "dry-run" as const,
    network: "sin-llamada" as const,
    gate: gate.open
      ? {
          open: true as const,
          reason:
            "El envío real no está implementado. No se ha llamado a OnlyFans.",
        }
      : gate,
    errors: [] as string[],
    queue: [] as DryRunResult["queue"],
    held: [] as string[],
    stats,
  };
}

function blocked(
  gate: ReturnType<typeof massSendGate>,
  errors: string[],
  stats: MassStats,
  pace: PaceLimits,
): DryRunResult {
  const missing = errors.some((error) => error.startsWith("Sin datos"));
  return {
    ...base(gate, stats),
    ok: false,
    status:
      missing && errors.every((error) => error.startsWith("Sin datos"))
        ? "sin_datos"
        : "bloqueado",
    errors,
    warnings: [],
    audience: SIN_DATOS,
    excluded: [],
    skippedMissing: [],
    suggestedPrice: SIN_DATOS,
    bestHourUtc: SIN_DATOS,
    unsendAfterHours: null,
    followUp: null,
    quota: quotaOf(pace, {
      sentLastHour: SIN_DATOS,
      sentLastDay: SIN_DATOS,
      slots: [],
      held: [],
    }),
  };
}
