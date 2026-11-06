import { changeRatio, creatorReport, type MetricEarning, type MetricFan, type MetricTx } from "../../../src/lib/creator-metrics.ts";
import { dashboardCreatorIds } from "../../../src/lib/dashboard-config.ts";

export type DashboardAlert = { kind: "session" | "sync" | "whale" | "drop"; text: string };

export type DashboardFan = MetricFan & {
  fanKey: string;
  handle: string | null;
  displayName: string | null;
  spentCents: number | null;
};

export type DashboardCreatorRead = {
  creatorId: string;
  earningsSyncedAt: string | null;
  fansSyncedAt: string | null;
  lastStatus: string;
  lastReason: string | null;
  earnings: MetricEarning[];
  fans: DashboardFan[];
  transactions: MetricTx[];
};

/** La vista que arma listDashboardView. Una cuenta fuera de las asignadas no entra. */
export function dashboardViewFor(input: {
  access: { role: "owner" | "member"; creatorIds: string[] };
  accounts: Array<{ id: string; creatorId: string | null; label: string; status: string; connection: string }>;
  reads: DashboardCreatorRead[];
  pauses: Array<{ accountId: string; reason: string }>;
  now: Date;
}): {
  role: "owner" | "member";
  dayGrossCents: number | null;
  monthGrossCents: number | null;
  activeFans: number | null;
  alerts: DashboardAlert[];
} {
  const ids = dashboardCreatorIds(input.access, input.accounts);
  const visible = input.accounts.filter((account) => account.creatorId && ids.includes(account.creatorId));
  const reads = input.reads.filter((row) => ids.includes(row.creatorId));
  const byCreator = new Map(reads.map((row) => [row.creatorId, row]));
  const owner = input.access.role === "owner";
  const bundle = {
    now: input.now,
    earningsSynced: reads.some((row) => row.earningsSyncedAt),
    fansSynced: reads.some((row) => row.fansSyncedAt),
    transactions: owner ? reads.flatMap((row) => row.transactions) : [],
    earnings: owner ? reads.flatMap((row) => row.earnings) : [],
    fans: reads.flatMap((row) => row.fans),
  };
  const day = creatorReport({ ...bundle, period: "day" });
  const month = creatorReport({ ...bundle, period: "month" });
  const whales = reads.flatMap((row) =>
    row.fans
      .filter((fan) => fan.renewAuto === false && fan.spentCents != null && fan.spentCents >= 10_000)
      .map((fan) => fan.displayName ?? fan.handle ?? fan.fanKey),
  );
  const drops = owner
    ? visible.flatMap((account) => {
        const read = account.creatorId ? byCreator.get(account.creatorId) : undefined;
        if (!read) return [];
        const report = creatorReport({
          now: input.now,
          period: "month",
          earningsSynced: Boolean(read.earningsSyncedAt),
          fansSynced: Boolean(read.fansSyncedAt),
          transactions: read.transactions,
          earnings: read.earnings,
          fans: read.fans,
        });
        const ratio = changeRatio(report.grossCents, report.previousGrossCents);
        if (ratio == null || ratio >= 0) return [];
        return [{ name: account.label }];
      })
    : [];
  return {
    role: input.access.role,
    dayGrossCents: owner ? day.grossCents : null,
    monthGrossCents: owner ? month.grossCents : null,
    activeFans: month.activeFans,
    alerts: dashboardAlerts({
      sessions: visible.map((account) => ({ name: account.label, status: account.status, connection: account.connection })),
      syncs: visible.flatMap((account) => {
        const read = account.creatorId ? byCreator.get(account.creatorId) : undefined;
        if (!read) return [];
        return [{ name: account.label, status: read.lastStatus, reason: read.lastReason }];
      }),
      whalesAtRisk: owner ? whales : [],
      drops,
      pauses: input.pauses.flatMap((pause) => {
        const account = visible.find((item) => item.id === pause.accountId);
        return account ? [{ name: account.label, reason: pause.reason }] : [];
      }),
    }),
  };
}

export function dashboardAlerts(input: {
  sessions: Array<{ name: string; status: string; connection: string }>;
  syncs: Array<{ name: string; status: string; reason: string | null }>;
  whalesAtRisk: string[];
  drops: Array<{ name: string }>;
  pauses?: Array<{ name: string; reason: string }>;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  for (const session of input.sessions) {
    if (session.status === "expired" || session.connection === "login_required") {
      alerts.push({ kind: "session", text: `${session.name}: sesión caducada. Pulsa Reconectar.` });
    }
  }
  for (const sync of input.syncs) {
    if (sync.status === "error") {
      alerts.push({ kind: "sync", text: `${sync.name}: sincronización fallida. ${sync.reason ?? "Sin detalle"}` });
    }
  }
  for (const pause of input.pauses ?? []) {
    alerts.push({ kind: "sync", text: `${pause.name}: en pausa. ${pause.reason}` });
  }
  for (const name of input.whalesAtRisk) {
    alerts.push({ kind: "whale", text: `${name}: ballena en riesgo.` });
  }
  for (const drop of input.drops) {
    alerts.push({ kind: "drop", text: `${drop.name}: los ingresos bajan frente al periodo anterior.` });
  }
  return alerts;
}
