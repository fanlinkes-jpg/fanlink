import type { InsightData, InsightQuery } from "./dashboard-insights.ts";
import type { ShiftSlot } from "./staff-shifts.ts";

/** Datos de prueba (no reales) para los tests del Dashboard. 28/11/2026, 11:00 Madrid. */
export const NOW = new Date("2026-11-28T10:00:00Z");
/** Último corte: hoy 08:00 Madrid. */
export const CUT = new Date("2026-11-28T07:00:00Z");
export const QUERY: InsightQuery = { from: "2026-11-21", to: "2026-11-27", basis: "net", granularity: "day" };

const week = (start: number | null, end: number | null): ShiftSlot[] =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, off: start == null, startMinutes: start, endMinutes: end }));

export function fixture(): InsightData {
  return {
    creators: [
      { id: "c-alba", name: "Alba", tag: "vip" },
      { id: "c-nora", name: "Nora", tag: null },
    ],
    transactions: [
      // Periodo actual.
      { creatorId: "c-alba", key: "t1", at: "2026-11-25T19:00:00Z", grossCents: 10_000, netCents: 8_000, kind: "message", fanKey: "f1" },
      { creatorId: "c-alba", key: "t2", at: "2026-11-26T10:00:00Z", grossCents: 5_000, netCents: null, kind: "tip", fanKey: "f2" },
      { creatorId: "c-nora", key: "t3", at: "2026-11-27T12:00:00Z", grossCents: 2_000, netCents: 1_600, kind: "subscription", fanKey: "n1" },
      // Periodo anterior.
      { creatorId: "c-alba", key: "t0", at: "2026-11-18T10:00:00Z", grossCents: 50_000, netCents: 40_000, kind: "message", fanKey: "f1" },
      // Después del corte: no cuenta hasta el siguiente.
      { creatorId: "c-alba", key: "t9", at: "2026-11-28T09:00:00Z", grossCents: 99_999, netCents: 79_999, kind: "tip", fanKey: "f1" },
    ],
    earnings: [],
    fans: [
      { creatorId: "c-alba", fanKey: "f1", name: "Ballena", handle: "ballena", status: "active", subscribedAt: "2026-05-01T00:00:00Z", expiresAt: null, renewAuto: false, spentCents: 45_000 },
      { creatorId: "c-alba", fanKey: "f2", name: "Nuevo", handle: "nuevo", status: "active", subscribedAt: "2026-11-24T08:00:00Z", expiresAt: null, renewAuto: true, spentCents: 5_000 },
      { creatorId: "c-nora", fanKey: "n1", name: "Fan Nora", handle: "fannora", status: "active", subscribedAt: "2026-11-27T11:00:00Z", expiresAt: null, renewAuto: true, spentCents: 2_000 },
    ],
    fansSyncedCreatorIds: ["c-alba", "c-nora"],
    earningsSyncedCreatorIds: ["c-alba", "c-nora"],
    messages: [
      { creatorId: "c-alba", key: "m1", threadKey: "f2", fanKey: "f2", at: "2026-11-24T09:00:00Z", fromFan: false, priceCents: null, purchased: null, authorId: "u-chat", massId: null },
      { creatorId: "c-alba", key: "m2", threadKey: "f2", fanKey: "f2", at: "2026-11-24T09:12:00Z", fromFan: true, priceCents: null, purchased: null, authorId: null, massId: null },
      { creatorId: "c-alba", key: "m3", threadKey: "f1", fanKey: "f1", at: "2026-11-25T18:00:00Z", fromFan: false, priceCents: 10_000, purchased: true, authorId: "u-chat", massId: null },
      { creatorId: "c-alba", key: "m4", threadKey: "f1", fanKey: "f1", at: "2026-11-25T18:30:00Z", fromFan: false, priceCents: 3_000, purchased: false, authorId: "u-chat", massId: null },
      { creatorId: "c-nora", key: "m5", threadKey: "n1", fanKey: "n1", at: "2026-11-27T13:00:00Z", fromFan: false, priceCents: 2_000, purchased: false, authorId: "u-otro", massId: null },
    ],
    attributions: [
      { saleKey: "t1", creatorId: "c-alba", fanKey: "f1", kind: "message", at: "2026-11-25T19:00:00Z", grossCents: 10_000, chatterId: "u-chat", chatterName: "Chatter" },
      { saleKey: "t2", creatorId: "c-alba", fanKey: "f2", kind: "tip", at: "2026-11-26T10:00:00Z", grossCents: 5_000, chatterId: "u-chat", chatterName: "Chatter" },
      { saleKey: "t3", creatorId: "c-nora", fanKey: "n1", kind: "subscription", at: "2026-11-27T12:00:00Z", grossCents: 2_000, chatterId: "u-otro", chatterName: "Otro" },
    ],
    staff: [
      { id: "u-chat", name: "Chatter", roleLabel: "Chatter", lastSeenAt: "2026-11-28T09:55:00Z", week: week(9 * 60, 17 * 60) },
      { id: "u-otro", name: "Otro", roleLabel: "Chatter", lastSeenAt: null, week: week(10 * 60, 18 * 60) },
    ],
    snapshots: [
      { creatorId: "c-alba", metric: "online", takenAt: "2026-11-28T07:02:00Z", value: 12 },
      { creatorId: "c-nora", metric: "online", takenAt: "2026-11-28T07:05:00Z", value: 3 },
    ],
  };
}
