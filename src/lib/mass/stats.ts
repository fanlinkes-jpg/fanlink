import { formatCents } from "../format.ts";
import type { Metric, SinDatos } from "./types.ts";
import { SIN_DATOS } from "./types.ts";

export type MassDelivery = {
  fanKey: string;
  status: "enviado" | "retenido" | "omitido";
  viewed?: boolean;
  purchased?: boolean;
  priceCents?: number;
};

export type MassStats = {
  sent: Metric;
  viewed: Metric;
  purchases: Metric;
  buyRate: Metric;
  revenueCents: Metric;
  createdBy: string | SinDatos;
};

export function massStats(input: {
  createdBy: { name: string } | null;
  deliveries: readonly MassDelivery[] | null;
}): MassStats {
  const createdBy = input.createdBy?.name.trim()
    ? input.createdBy.name.trim()
    : SIN_DATOS;
  if (input.deliveries == null) {
    return {
      sent: SIN_DATOS,
      viewed: SIN_DATOS,
      purchases: SIN_DATOS,
      buyRate: SIN_DATOS,
      revenueCents: SIN_DATOS,
      createdBy,
    };
  }
  const sentRows = input.deliveries.filter((row) => row.status === "enviado");
  const sent = sentRows.length;
  const viewed = countFlag(sentRows, "viewed");
  const purchases = countFlag(sentRows, "purchased");
  const buyRate =
    typeof purchases === "number" && sent > 0 ? purchases / sent : SIN_DATOS;
  const revenueCents = revenueOf(sentRows, purchases);
  return { sent, viewed, purchases, buyRate, revenueCents, createdBy };
}

export function followUpRecipients(
  deliveries: readonly MassDelivery[] | null,
): string[] | SinDatos {
  if (deliveries == null) return SIN_DATOS;
  const sentRows = deliveries.filter((row) => row.status === "enviado");
  if (sentRows.some((row) => typeof row.purchased !== "boolean"))
    return SIN_DATOS;
  return sentRows
    .filter((row) => row.purchased === false)
    .map((row) => row.fanKey);
}

export function textoIngresos(cents: Metric): string {
  return cents === SIN_DATOS ? SIN_DATOS : formatCents(cents);
}

function countFlag(
  rows: readonly MassDelivery[],
  key: "viewed" | "purchased",
): Metric {
  if (rows.length === 0) return 0;
  if (rows.some((row) => typeof row[key] !== "boolean")) return SIN_DATOS;
  return rows.filter((row) => row[key] === true).length;
}

function revenueOf(rows: readonly MassDelivery[], purchases: Metric): Metric {
  if (purchases === SIN_DATOS) return SIN_DATOS;
  if (purchases === 0) return 0;
  const bought = rows.filter((row) => row.purchased === true);
  if (
    bought.some(
      (row) => row.priceCents == null || !Number.isFinite(row.priceCents),
    )
  )
    return SIN_DATOS;
  return bought.reduce((sum, row) => sum + (row.priceCents ?? 0), 0);
}
