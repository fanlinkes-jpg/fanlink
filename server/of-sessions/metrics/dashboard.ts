export type DashboardAlert = { kind: "session" | "sync" | "whale" | "drop"; text: string };

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
