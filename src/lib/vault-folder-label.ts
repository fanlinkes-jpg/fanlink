export type VaultFolderCounts = {
  photos: number | null;
  videos: number | null;
  gifs: number | null;
  audios: number | null;
  /** null si el JSON de la lista no trae hasMedia. */
  hasMedia: boolean | null;
};

/** El texto de la carpeta. «vacío» solo si OnlyFans dice que no hay medios. */
export function vaultFolderLabel(counts: VaultFolderCounts, loaded: { photos: number; videos: number; gifs: number }): string {
  const known = counts.photos != null || counts.videos != null || counts.gifs != null || counts.audios != null;
  const photos = counts.photos ?? loaded.photos;
  const videos = counts.videos ?? loaded.videos;
  const gifs = counts.gifs ?? loaded.gifs;
  const audios = counts.audios ?? 0;
  const total = photos + videos + gifs + audios;
  if (total > 0) {
    const parts = [`${photos} fotos`, `${videos} vídeos`];
    if (gifs > 0) parts.push(`${gifs} GIF`);
    if (audios > 0) parts.push(`${audios} audios`);
    return parts.join(" · ");
  }
  if (counts.hasMedia === false) return "vacío";
  if (known && counts.hasMedia !== true) return "vacío";
  return "Sin datos";
}
