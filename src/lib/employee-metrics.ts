/** La persona semilla no tiene mensajes ni ventas de OnlyFans. */
export function seedEmployeeStat(name: string, computed: string): string {
  if (name === "Tú") return "Sin datos";
  return computed;
}
