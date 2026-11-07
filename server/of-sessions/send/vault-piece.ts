export type VaultSendPiece = {
  id: string;
  title: string;
  folder: string | null;
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

/**
 * Un título vacío o dos piezas del mismo envío con el mismo título no se pueden señalar.
 * Si el título se repite en el espejo, solo sigue si la carpeta lo distingue.
 * Si no, el envío entero no sale.
 */
export function planVaultPieces(items: readonly VaultPlanItem[], ids: readonly string[]): { ok: true; pieces: VaultSendPiece[] } | { ok: false; reason: "Sin datos" } {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (ids.some((id) => !byId.has(id))) return { ok: false, reason: "Sin datos" };
  const pieces: VaultSendPiece[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    const title = (item?.title ?? "").trim();
    if (!title) return { ok: false, reason: "Sin datos" };
    const folder = (item?.folder ?? item?.listName ?? "").trim() || null;
    const twins = items.filter((other) => (other.title ?? "").trim().toLowerCase() === title.toLowerCase());
    if (twins.length > 1) {
      const mine = (folder ?? "").toLowerCase();
      const sameFolder = twins.filter((other) => ((other.folder ?? other.listName ?? "").trim().toLowerCase()) === mine);
      if (!mine || sameFolder.length !== 1) return { ok: false, reason: "Sin datos" };
    }
    pieces.push({ id, title, folder });
  }
  const titles = pieces.map((piece) => piece.title.toLowerCase());
  if (new Set(titles).size !== titles.length) return { ok: false, reason: "Sin datos" };
  return { ok: true, pieces };
}

/** Id que enseña OnlyFans, o título junto con la carpeta. El título solo no basta. */
export function vaultPieceMatch(wanted: VaultSendPiece, shown: readonly ShownVaultPiece[]): "id" | "folder" | null {
  const byId = shown.filter((item) => item.id === wanted.id);
  if (byId.length === 1) return "id";
  if (byId.length > 1) return null;
  if (!wanted.folder) return null;
  const hits = shown.filter((item) => item.title.trim() === wanted.title && fold(item.folder ?? "") === fold(wanted.folder ?? ""));
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
