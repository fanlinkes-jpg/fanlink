/** La dueña semilla no tiene mensajes ni ventas de OnlyFans. Se reconoce por rol o id, no por el nombre. */
export function seedEmployeeStat(person: { role?: string; id?: string }, computed: string): string {
  if (person.role === "Dueña" || person.role === "owner" || person.id === "e-yo") return "Sin datos";
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
    row.grossCents == null ? "Sin datos" : `${(row.grossCents / 100).toFixed(2)} USD`,
    row.ppvSent == null ? "Sin datos" : String(row.ppvSent),
    row.firstReplyMinutes == null ? "Sin datos" : `${row.firstReplyMinutes} min`,
    row.threads == null ? "Sin datos" : String(row.threads),
  ];
}
