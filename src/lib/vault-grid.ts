/** Columnas de la cuadrícula. Nunca salen de 5 a 8, ni en un viewport ancho. */
export function vaultGridColumns(width: number): number {
  if (width >= 1900) return 8;
  if (width >= 1700) return 7;
  if (width >= 1500) return 6;
  return 5;
}

export const VAULT_GRID_CLASS = [
  "grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 pb-4",
  "grid-cols-5",
  "min-[1500px]:grid-cols-6",
  "min-[1700px]:grid-cols-7",
  "min-[1900px]:grid-cols-8",
].join(" ");
