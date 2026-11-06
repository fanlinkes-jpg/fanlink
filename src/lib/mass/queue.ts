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
const DAY_MS = 86_400_000;

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
}): QueuePlan {
  const slots: Array<{ fanKey: string; at: number }> = [];
  const held: string[] = [];
  const startDay = dayStart(input.startAt);
  let cursor = input.startAt;
  let hourBucket = hourStart(cursor);
  let hourCount = seed(
    input.usage?.sentLastHour,
    input.now,
    hourBucket,
    hourStart,
  );
  let dayCount = seed(input.usage?.sentLastDay, input.now, startDay, dayStart);

  for (let index = 0; index < input.fanKeys.length; index += 1) {
    const fanKey = input.fanKeys[index] ?? "";
    let placed = false;
    for (let step = 0; step < 48; step += 1) {
      if (dayStart(cursor) !== startDay || dayCount >= input.pace.maxPerDay)
        break;
      const hour = hourStart(cursor);
      if (hour !== hourBucket) {
        hourBucket = hour;
        hourCount = 0;
      }
      if (hourCount >= input.pace.maxPerHour) {
        cursor = hour + HOUR_MS;
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
      held.push(...input.fanKeys.slice(index));
      break;
    }
  }

  return {
    slots,
    held,
    sentLastHour: input.usage == null ? SIN_DATOS : input.usage.sentLastHour,
    sentLastDay: input.usage == null ? SIN_DATOS : input.usage.sentLastDay,
  };
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

function seed(
  used: number | undefined,
  now: number,
  bucket: number,
  toBucket: (time: number) => number,
): number {
  if (used == null) return 0;
  return toBucket(now) === bucket ? used : 0;
}

function hourStart(time: number): number {
  return Math.floor(time / HOUR_MS) * HOUR_MS;
}

function dayStart(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS;
}
