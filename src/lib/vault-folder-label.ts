/** Aviso cuando el catálogo tiene medios y la lectura de la carpeta acaba en cero. */
export const VAULT_FOLDER_READ_ERROR = "No se ha podido leer la carpeta";
/** El espejo sigue en pantalla, pero la última lectura no pudo actualizarlo. */
export const VAULT_FOLDER_STALE = "No se ha podido actualizar";

export type VaultFolderCounts = {
  photos: number | null;
  videos: number | null;
  gifs: number | null;
  audios: number | null;
  /** null si el JSON de la lista no trae hasMedia. */
  hasMedia: boolean | null;
  /** Total suelto, si no hay desglose. */
  count?: number | null;
};

export type FolderCover = { id: string; kind: string | null };

/** El texto de la carpeta. Un conteo ausente no se pinta como 0. */
export function vaultFolderLabel(counts: VaultFolderCounts, loaded: { photos: number; videos: number; gifs: number }): string {
  const known = folderCountsKnown(counts);
  if (!known && counts.count != null && counts.count > 0) return `${counts.count} medios`;
  const photos = shownCount(counts.photos, known ? 0 : loaded.photos);
  const videos = shownCount(counts.videos, known ? 0 : loaded.videos);
  const gifs = shownCount(counts.gifs, known ? 0 : loaded.gifs);
  const audios = shownCount(counts.audios, 0);
  const total = (photos ?? 0) + (videos ?? 0) + (gifs ?? 0) + (audios ?? 0);
  if (total === 0 && counts.hasMedia === false) return "vacío";
  const parts: string[] = [];
  if (photos != null) parts.push(piece(photos, "foto", "fotos"));
  if (videos != null) parts.push(piece(videos, "vídeo", "vídeos"));
  if (gifs != null && gifs > 0) parts.push(piece(gifs, "GIF", "GIF"));
  if (audios != null && audios > 0) parts.push(piece(audios, "audio", "audios"));
  if (parts.length === 0) return "Sin datos";
  return parts.join(" · ");
}

/**
 * Columna de una carpeta. Los conteos y las portadas son los de esa lista.
 * `loadedLibrary` es la bóveda entera y no rellena ni el texto ni las miniaturas.
 */
export function folderColumnView(input: {
  counts: VaultFolderCounts;
  covers: readonly FolderCover[];
  ownItems: readonly FolderCover[];
}): { label: string; coverIds: string[] } {
  const known = folderCountsKnown(input.counts);
  const own = {
    photos: input.ownItems.filter((item) => item.kind === "foto").length,
    videos: input.ownItems.filter((item) => item.kind === "video").length,
    gifs: input.ownItems.filter((item) => item.kind === "gif").length,
  };
  const label = vaultFolderLabel(input.counts, known ? { photos: 0, videos: 0, gifs: 0 } : own);
  const source = input.covers.length > 0 ? input.covers : input.ownItems;
  const coverIds = source.filter((item) => item.id && item.kind !== "audio").slice(0, 4).map((item) => item.id);
  return { label, coverIds };
}

function folderCountsKnown(counts: VaultFolderCounts): boolean {
  return counts.photos != null || counts.videos != null || counts.gifs != null || counts.audios != null;
}

function piece(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function shownCount(reported: number | null, loaded: number): number | null {
  if (reported != null) return reported;
  if (loaded > 0) return loaded;
  return null;
}
