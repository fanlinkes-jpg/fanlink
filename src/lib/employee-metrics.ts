/** La persona semilla no tiene mensajes ni ventas de OnlyFans. */
export function seedEmployeeStat(name: string, computed: string): string {
  if (name === "Tú") return "Sin datos";
  return computed;
}

/** Una métrica que no ha llegado de la sincronización no es un cero. */
export function employeeMetricCells(row: {
  grossCents: number | null;
  ppvSent: number | null;
  firstReplyMinutes: number | null;
  threads: number | null;
} | null): string[] {
  if (!row) return ["Sin datos", "Sin datos", "Sin datos", "Sin datos"];
  return [
    row.grossCents == null ? "Sin datos" : String(row.grossCents),
    row.ppvSent == null ? "Sin datos" : String(row.ppvSent),
    row.firstReplyMinutes == null ? "Sin datos" : `${row.firstReplyMinutes} min`,
    row.threads == null ? "Sin datos" : String(row.threads),
  ];
}
