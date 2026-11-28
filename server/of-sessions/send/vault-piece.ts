export type VaultSendPiece = {
  id: string;
  title: string;
  folder: string | null;
  /** Vista previa gratis cuando el mensaje lleva precio. */
  free?: boolean;
};

export type VaultPlanItem = {
  id: string;
  title: string | null;
  folder: string | null;
  listName: string | null;
  listId: string | null;
};

export type ShownVaultPiece = {
  id: string | null;
  title: string;
  folder: string | null;
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** El placeholder de la UI no es un título. No se usa para señalar la pieza. */
export function vaultTitleForMatch(value: string | null | undefined): string {
  const title = (value ?? "").replace(/\s+/g, " ").trim();
  if (!title || title.toLowerCase() === "sin datos") return "";
  return title;
}

/**
 * Se adjunta por el id de OnlyFans. El título y la carpeta solo sirven de reserva
 * si la página no enseña el id. Un título vacío o repetido no frena el envío.
 */
export function planVaultPieces(items: readonly VaultPlanItem[], ids: readonly string[]): { ok: true; pieces: VaultSendPiece[] } | { ok: false; reason: "Sin datos" } {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (ids.length === 0 || ids.some((id) => !byId.has(id)) || new Set(ids).size !== ids.length) {
    return { ok: false, reason: "Sin datos" };
  }
  const pieces: VaultSendPiece[] = ids.map((id) => {
    const item = byId.get(id);
    const folder = (item?.folder ?? item?.listName ?? "").trim() || null;
    return { id, title: vaultTitleForMatch(item?.title), folder };
  });
  return { ok: true, pieces };
}

/** Id que enseña OnlyFans, o título junto con la carpeta. El título solo no basta. */
export function vaultPieceMatch(wanted: VaultSendPiece, shown: readonly ShownVaultPiece[]): "id" | "folder" | null {
  const byId = shown.filter((item) => item.id === wanted.id);
  if (byId.length === 1) return "id";
  if (byId.length > 1) return null;
  const title = vaultTitleForMatch(wanted.title);
  if (!wanted.folder || !title) return null;
  const hits = shown.filter((item) => vaultTitleForMatch(item.title) === title && fold(item.folder ?? "") === fold(wanted.folder ?? ""));
  if (hits.length !== 1) return null;
  const only = hits[0];
  if (only && only.id != null && only.id !== wanted.id) return null;
  return "folder";
}

export function vaultPieceReady(wanted: VaultSendPiece, shown: readonly ShownVaultPiece[]): boolean {
  return vaultPieceMatch(wanted, shown) != null;
}

export function attachmentsConfirmed(shown: number, wanted: number): boolean {
  return wanted === 0 || (shown === wanted && shown > 0);
}
