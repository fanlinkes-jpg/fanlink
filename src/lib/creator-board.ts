import { madridDay } from "./chat-dates.ts";
import { madridDateKey, madridParts } from "./staff-shifts.ts";

export type SalesSource = {
  earningsSyncedAt: string | null;
  earnings: Array<{ day: string; kind: string; amountCents: number }> | null;
  transactions: Array<{ occurredAt: string; grossCents: number }> | null;
};

export function todayKey(now = new Date()): string {
  return madridDateKey(madridParts(now));
}

/** Ventas del día en Madrid a partir de un sync real. `null` = no hay dato, no se inventa. */
export function todaySalesCents(read: SalesSource | undefined, now = new Date()): number | null {
  if (!read || !read.earningsSyncedAt) return null;
  const key = todayKey(now);
  // Una lectura de otro día no sabe nada de hoy: Sin datos, no un cero.
  const syncedParts = madridDay(read.earningsSyncedAt);
  if (syncedParts) {
    const syncedDay = `${syncedParts.year}-${String(syncedParts.month).padStart(2, "0")}-${String(syncedParts.day).padStart(2, "0")}`;
    if (syncedDay !== key) return null;
  }
  if (read.transactions) {
    return read.transactions.reduce((sum, item) => {
      const parts = madridDay(item.occurredAt);
      if (!parts) return sum;
      const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      return day === key ? sum + item.grossCents : sum;
    }, 0);
  }
  if (read.earnings) {
    const today = read.earnings.filter((item) => item.day === key);
    const totals = today.filter((item) => item.kind === "total");
    const rows = totals.length > 0 ? totals : today;
    return rows.reduce((sum, item) => sum + item.amountCents, 0);
  }
  return null;
}

export function moneyUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatSyncAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Nunca";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "Nunca";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

export type ConnectivityKind = "connected" | "expired" | "pending" | "offline";

export function connectivityOf(session: { status: string; signedReadsBlocked?: boolean } | undefined): { kind: ConnectivityKind; label: string } {
  if (!session) return { kind: "offline", label: "Sin sesión" };
  if (session.signedReadsBlocked || session.status === "expired") return { kind: "expired", label: "Sesión caducada" };
  if (session.status === "active") return { kind: "connected", label: "Conectado" };
  if (session.status === "pending_login") return { kind: "pending", label: "Pendiente de login" };
  if (session.status === "needs_proxy") return { kind: "offline", label: "Falta proxy" };
  return { kind: "offline", label: session.status };
}
