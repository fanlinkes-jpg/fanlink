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
