import { PPV_MAX_CENTS, PPV_MIN_CENTS } from "./composer.ts";
import type { MassHistoryMessage, SinDatos } from "./types.ts";
import { SIN_DATOS } from "./types.ts";

export function suggestPrice(
  messages: readonly MassHistoryMessage[] | null,
  fanKeys: readonly string[],
  vaultPriceFilter?: readonly number[],
): { cents: number; sample: number } | SinDatos {
  if (messages == null) return SIN_DATOS;
  const wanted = new Set(fanKeys);
  const prices = messages
    .filter(
      (message) =>
        !message.fromFan &&
        message.fanKey != null &&
        wanted.has(message.fanKey) &&
        message.purchased === true,
    )
    .map((message) => message.priceCents)
    .filter((cents): cents is number => validPpv(cents));
  const usable = vaultPriceFilter
    ? prices.filter((cents) => vaultPriceFilter.includes(cents))
    : prices;
  if (usable.length === 0) return SIN_DATOS;
  const cents = roundDollars(median(usable));
  if (!validPpv(cents)) return SIN_DATOS;
  return { cents, sample: usable.length };
}

export function bestSendHour(
  messages: readonly MassHistoryMessage[] | null,
  fanKeys: readonly string[],
): { hourUtc: number; samples: number } | SinDatos {
  if (messages == null) return SIN_DATOS;
  const wanted = new Set(fanKeys);
  const counts = new Map<number, number>();
  let samples = 0;
  for (const message of messages) {
    if (
      !message.fromFan ||
      message.fanKey == null ||
      !wanted.has(message.fanKey)
    )
      continue;
    const time = Date.parse(message.sentAt);
    if (!Number.isFinite(time)) continue;
    const hour = new Date(time).getUTCHours();
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
    samples += 1;
  }
  if (samples === 0) return SIN_DATOS;
  let bestHour = 0;
  let bestCount = -1;
  for (const [hour, count] of counts) {
    if (count > bestCount || (count === bestCount && hour < bestHour)) {
      bestHour = hour;
      bestCount = count;
    }
  }
  return { hourUtc: bestHour, samples };
}

function validPpv(cents: number | null): cents is number {
  return (
    cents != null &&
    Number.isInteger(cents) &&
    cents >= PPV_MIN_CENTS &&
    cents <= PPV_MAX_CENTS &&
    cents % 100 === 0
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (sorted.length % 2 === 1) return upper ?? 0;
  const lower = sorted[mid - 1];
  return ((lower ?? 0) + (upper ?? 0)) / 2;
}

function roundDollars(cents: number): number {
  return Math.round(cents / 100) * 100;
}
