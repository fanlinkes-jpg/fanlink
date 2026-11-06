import type { Metric } from "./types.ts";
import { SIN_DATOS } from "./types.ts";

export type PaceLimits = {
  minGapMs: number;
  maxGapMs: number;
  maxPerHour: number;
  maxPerDay: number;
};

/** Política de Fanlink, no un cupo medido de OnlyFans. */
export const DEFAULT_PACE: PaceLimits = {
  minGapMs: 45_000,
  maxGapMs: 90_000,
  maxPerHour: 30,
  maxPerDay: 200,
};

const HOUR_MS = 3_600_000;

export type QueuePlan = {
  slots: Array<{ fanKey: string; at: number }>;
  held: string[];
  sentLastHour: Metric;
  sentLastDay: Metric;
};

export function validPace(pace: PaceLimits): boolean {
  return (
    Number.isFinite(pace.minGapMs) &&
    Number.isFinite(pace.maxGapMs) &&
    pace.minGapMs >= 0 &&
    pace.maxGapMs >= pace.minGapMs &&
    Number.isInteger(pace.maxPerHour) &&
    Number.isInteger(pace.maxPerDay) &&
    pace.maxPerHour >= 1 &&
    pace.maxPerDay >= 1
  );
}

export function buildQueue(input: {
  fanKeys: readonly string[];
  startAt: number;
  now: number;
  pace: PaceLimits;
  usage: { sentLastHour: number; sentLastDay: number } | null;
  timeZone: string | null;
}): QueuePlan {
  const fanKeys = uniqueKeys(input.fanKeys);
  const knownHour = input.usage == null ? SIN_DATOS : input.usage.sentLastHour;
  const knownDay = input.usage == null ? SIN_DATOS : input.usage.sentLastDay;
  if (
    input.usage == null ||
    input.timeZone == null ||
    zoneParts(input.startAt, input.timeZone) == null
  ) {
    return {
      slots: [],
      held: fanKeys,
      sentLastHour: knownHour,
      sentLastDay: knownDay,
    };
  }
  const timeZone = input.timeZone;
  const start = zoneParts(input.startAt, timeZone);
  const now = zoneParts(input.now, timeZone);
  if (start == null || now == null) {
    return {
      slots: [],
      held: fanKeys,
      sentLastHour: knownHour,
      sentLastDay: knownDay,
    };
  }

  const slots: Array<{ fanKey: string; at: number }> = [];
  const held: string[] = [];
  let cursor = input.startAt;
  let hourBucket = start.hourKey;
  let hourCount = start.hourKey === now.hourKey ? input.usage.sentLastHour : 0;
  let dayCount = start.day === now.day ? input.usage.sentLastDay : 0;

  for (let index = 0; index < fanKeys.length; index += 1) {
    const fanKey = fanKeys[index] ?? "";
    let placed = false;
    for (let step = 0; step < 48; step += 1) {
      const here = zoneParts(cursor, timeZone);
      if (
        here == null ||
        here.day !== start.day ||
        dayCount >= input.pace.maxPerDay
      )
        break;
      if (here.hourKey !== hourBucket) {
        hourBucket = here.hourKey;
        hourCount = 0;
      }
      if (hourCount >= input.pace.maxPerHour) {
        cursor += HOUR_MS;
        continue;
      }
      slots.push({ fanKey, at: cursor });
      hourCount += 1;
      dayCount += 1;
      cursor += gapMs(fanKey, input.pace);
      placed = true;
      break;
    }
    if (!placed) {
      held.push(...fanKeys.slice(index));
      break;
    }
  }

  return { slots, held, sentLastHour: knownHour, sentLastDay: knownDay };
}

export function gapMs(fanKey: string, pace: PaceLimits): number {
  const span = pace.maxGapMs - pace.minGapMs;
  if (span <= 0) return pace.minGapMs;
  let hash = 0;
  for (let index = 0; index < fanKey.length; index += 1) {
    hash = (hash * 31 + fanKey.charCodeAt(index)) >>> 0;
  }
  return pace.minGapMs + (hash % (span + 1));
}

function uniqueKeys(fanKeys: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const fanKey of fanKeys) {
    if (!fanKey || seen.has(fanKey)) continue;
    seen.add(fanKey);
    next.push(fanKey);
  }
  return next;
}

function zoneParts(
  time: number,
  timeZone: string,
): { day: string; hourKey: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(new Date(time));
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    let hour = Number(pick("hour"));
    if (!Number.isFinite(hour)) return null;
    if (hour === 24) hour = 0;
    const day = `${pick("year")}-${pick("month")}-${pick("day")}`;
    return { day, hourKey: `${day}T${hour}` };
  } catch {
    return null;
  }
}
