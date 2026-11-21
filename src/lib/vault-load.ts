export type VaultLoadState = { busy: boolean; listId: string };

/** Otra carpeta puede salir aunque Todos siga paginando. La misma lista espera. */
export function vaultLoadAllowed(state: VaultLoadState, next: { listId: string; offset: number }): boolean {
  if (next.offset < 0) return false;
  if (!state.busy) return true;
  return next.listId !== state.listId;
}

export function mergeVaultPage<T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

/** Los ids de OnlyFans llegan como número en la lista y como texto en la UI. */
export function sameVaultId(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return false;
  const a = String(left).trim();
  const b = String(right).trim();
  return a.length > 0 && a === b;
}

/** La rejilla de una carpeta. Si no hay medios de esa carpeta, no devuelve los de Todos. */
export function folderGridItems<T extends { id: string; listId?: string | null }>(
  mirror: readonly T[],
  pageItems: readonly T[],
  folderId: unknown,
  pageListId: unknown,
): T[] {
  if (folderId == null || String(folderId).trim() === "") return [...mirror];
  if (sameVaultId(pageListId, folderId) && pageItems.length > 0) return [...pageItems];
  return mirror.filter((item) => sameVaultId(item.listId, folderId));
}
