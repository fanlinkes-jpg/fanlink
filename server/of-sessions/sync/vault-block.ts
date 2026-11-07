export type SaleFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export function foldSale(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** «NO VENDER», «No-vender», «no vender», «SIN EDITAR» y lo mismo sin tilde. */
export function textSaleBlocked(text: string): boolean {
  const folded = foldSale(text);
  return /no[\s-]*vender/.test(folded) || /sin[\s-]*editar/.test(folded);
}

/**
 * El bloqueo se hereda de las carpetas padre.
 * Si falta una carpeta de la cadena o hay un ciclo, también está bloqueado.
 */
export function chainSaleBlocked(folders: readonly SaleFolder[], startId: string | null): boolean {
  if (!startId) return false;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current: string | null = startId;
  let guard = 0;
  while (current) {
    if (seen.has(current) || guard > 64) return true;
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) return true;
    if (textSaleBlocked(folder.name)) return true;
    current = folder.parentId;
    guard += 1;
  }
  return false;
}

export function itemSaleBlocked(input: {
  folderId: string | null;
  folderName: string | null;
  title: string | null;
  folders: readonly SaleFolder[];
}): boolean {
  if (textSaleBlocked(`${input.folderName ?? ""} ${input.title ?? ""}`)) return true;
  const named = input.folderName
    ? input.folders.find((folder) => foldSale(folder.name) === foldSale(input.folderName ?? ""))
    : undefined;
  const start = input.folderId ?? named?.id ?? null;
  if ((input.folderId || input.folderName) && start == null) return true;
  return chainSaleBlocked(input.folders, start);
}
