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

/** La misma cuenta que el servidor: suma de conteos más un margen. */
export function folderGridCap(counts: { photos?: number | null; videos?: number | null; gifs?: number | null; audios?: number | null } | null | undefined): number | null {
  if (!counts) return null;
  const values = [counts.photos, counts.videos, counts.gifs, counts.audios];
  if (values.every((value) => value == null)) return null;
  let sum = 0;
  for (const value of values) sum += typeof value === "number" && Number.isFinite(value) ? value : 0;
  return sum + Math.max(4, Math.ceil(sum * 0.2));
}

/** La rejilla de una carpeta. Si no hay medios de esa carpeta, no devuelve los de Todos. */
export function folderGridItems<T extends { id: string; listId?: string | null; listIds?: readonly string[] | null }>(
  mirror: readonly T[],
  pageItems: readonly T[],
  folderId: unknown,
  pageListId: unknown,
  cap: number | null = null,
): T[] {
  if (folderId == null || String(folderId).trim() === "") return [...mirror];
  const pageFits = sameVaultId(pageListId, folderId) && pageItems.length > 0 && (cap == null || pageItems.length <= cap);
  const own = mirror.filter((item) => sameVaultId(item.listId, folderId) || (item.listIds ?? []).some((id) => sameVaultId(id, folderId)));
  if (pageFits) return [...pageItems];
  if (cap != null && own.length > cap) return [];
  return own;
}

export type VaultFolderMemory = Record<string, string>;

/** Al cambiar de cuenta no se arrastra la carpeta abierta. Vuelve a Toda la bóveda, o a la última de esa cuenta. */
export function vaultFolderOnAccountChange(
  memory: VaultFolderMemory,
  fromCreatorId: string | null,
  toCreatorId: string | null,
  openListId: string,
): { memory: VaultFolderMemory; listId: string } {
  if (fromCreatorId === toCreatorId) return { memory, listId: openListId.trim() || "all" };
  const next = { ...memory };
  if (fromCreatorId) next[fromCreatorId] = openListId.trim() || "all";
  if (!toCreatorId) return { memory: next, listId: "all" };
  const saved = next[toCreatorId]?.trim();
  return { memory: next, listId: saved || "all" };
}

/** La bóveda del chat es la de la creadora del hilo. Sin hilo, la de la creadora activa. */
export function chatVaultCreator(thread: { creatorId: string } | null, activeCreatorId?: string | null): string | null {
  const id = thread?.creatorId.trim() ?? "";
  if (id && id !== "all") return id;
  const active = activeCreatorId?.trim() ?? "";
  if (!active || active === "all") return null;
  return active;
}

/** Si el hilo cambia, la lectura anterior no vale y la bóveda pasa a la creadora nueva. */
export function chatVaultOnThreadChange(input: {
  previousThreadId: string | null;
  nextThreadId: string | null;
  generation: number;
}): { generation: number; reset: boolean } {
  if (input.previousThreadId === input.nextThreadId) return { generation: input.generation, reset: false };
  return { generation: input.generation + 1, reset: true };
}

/** No se adjunta un medio que no sea de la creadora del hilo. */
export function chatVaultCanAttach(threadCreatorId: string | null, itemCreatorId: string | null): boolean {
  return threadCreatorId != null && itemCreatorId === threadCreatorId;
}

/** Cada pieza se mira sola. Una de otra creadora no entra, aunque las demás sí. */
export function acceptedVaultPieces<T extends { creatorId?: string | null }>(
  threadCreatorId: string | null,
  items: readonly T[],
): T[] {
  return items.filter((item) => chatVaultCanAttach(threadCreatorId, item.creatorId ?? null));
}

/** Una respuesta de otra cuenta o de una lectura ya sustituida no se pinta, ni en miniaturas ni en «más». */
export function vaultReadApplies(input: {
  generation: number;
  currentGeneration: number;
  requestCreatorId: string;
  activeCreatorId: string | null;
}): boolean {
  return input.generation === input.currentGeneration
    && input.activeCreatorId != null
    && input.requestCreatorId === input.activeCreatorId;
}

/** La página de bóveda no conserva la carpeta de la creadora anterior. */
export function vaultQueryFolderOnCreatorChange(fromCreatorId: string, toCreatorId: string, folderId: string | null): string | null {
  if (fromCreatorId === toCreatorId) return folderId;
  return null;
}

/** La respuesta de Todos no pinta si ya se abrió otra carpeta. */
export function ignoreStaleVaultView(wanted: unknown, ticket: unknown): boolean {
  const left = wanted == null ? "" : String(wanted).trim();
  const right = ticket == null ? "" : String(ticket).trim();
  return left !== right;
}

/** Las portadas de Todos no se sustituyen por los medios de la carpeta abierta. */
export function nextVaultLibrary<T>(openFolderId: unknown, library: readonly T[], incoming: readonly T[]): T[] {
  if (openFolderId != null && String(openFolderId).trim() !== "") return [...library];
  return [...incoming];
}
